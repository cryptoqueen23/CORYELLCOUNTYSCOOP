// Proof of concept: collect every due source in ONE Node process (e.g. a GitHub Actions run) and write the
// same schema-3 feed the Worker serves, so the existing site (feed-build.js) reads it unchanged.
// State = the previous news.json itself (per-source records), so no KV or database is needed.
//
//   node collect.mjs [--state out/news.json] [--out out/news.json] [--report out/report.json]
//                    [--force] [--block=id,id] [--no-retry] [--retryMs=20000]
//
// Prints CHANGED=true|false (the workflow commits only when the file differs). Never throws on a source failure.
//
// Three different times are kept apart in the report:
//   collector execution time   collectorStartedAt / collectorFinishedAt (when this program ran)
//   last successful refresh    per source: lastSuccessfulRefresh (rec.t, set only when a fetch succeeded)
//   newest article date        per source: newestArticlePubDate (what the publisher says, never invented)

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { runSource } from "../rss-worker/lib/fetchers.js";
import { assembleFeedText, metaPrefixes } from "../rss-worker/lib/feed.js";
import { ingest, HEARTBEAT_MS } from "../rss-worker/lib/ingest.js";
import { SOURCES } from "../rss-worker/lib/sources.js";

const arg = (name, fallback) => (process.argv.find((a) => a.startsWith(`--${name}=`)) || "").split("=")[1] || fallback;
const statePath = arg("state", "out/news.json");
const outPath = arg("out", statePath);
const reportPath = arg("report", "");
const force = process.argv.includes("--force");
const blocked = new Set((arg("block", "") || "").split(",").filter(Boolean)); // test hook: simulate a dead source
const CONCURRENCY = 5;
const SLACK_MS = 4 * 60_000; // a run that fires a little early still counts a source as due

const startedMs = Date.now();
const now = startedMs;
const cpuStart = process.cpuUsage();
let previous = null;
try {
  previous = JSON.parse(readFileSync(statePath, "utf8"));
} catch {
  console.log("no usable previous feed: starting fresh");
}
const recordText = new Map((previous?.sources || []).map((s) => [s.id, s.rec ? JSON.stringify(s.rec) : null]));
const itemsIn = (text) => (text ? JSON.parse(text).items : []);
const newestPub = (items) => items.reduce((best, i) => (i.pubDate && (!best || Date.parse(i.pubDate) > Date.parse(best)) ? i.pubDate : best), null);

const isDue = (source) => {
  const text = recordText.get(source.id);
  if (!text || force) return true;
  const rec = JSON.parse(text);
  if (rec.f > 0) return true; // failing sources are retried on every run
  return !rec.t || now - Date.parse(rec.t) >= source.refreshMinutes * 60_000 - SLACK_MS;
};

async function refresh(source) {
  const t0 = Date.now();
  const before = itemsIn(recordText.get(source.id));
  const outcome = blocked.has(source.id) ? { ok: false, error: "simulated outage" } : await runSource(source, now, { summaries: true });
  const fetchMs = Date.now() - t0;
  const t1 = performance.now();
  const result = ingest(recordText.get(source.id) || null, outcome, source, now, { context: true });
  const processMs = Math.round((performance.now() - t1) * 10) / 10;
  if (result.write) recordText.set(source.id, result.text);
  const after = itemsIn(recordText.get(source.id));
  const raw = outcome.ok ? outcome.items : [];
  return {
    id: source.id,
    status: result.status,
    wrote: result.write,
    error: outcome.ok ? undefined : outcome.error,
    // "HTTP nnn" and "timeout" come from the fetch layer's own error text; a successful fetch is a 200 body.
    fetchResult: outcome.ok ? "ok (HTTP 200)" : String(outcome.error).slice(0, 80),
    fetchMs,
    processMs,
    rawItems: raw.length,
    rawDated: raw.filter((i) => i.pubDate).length,
    rawUndated: raw.filter((i) => !i.pubDate).length,
    savedBefore: before.length,
    savedAfter: after.length,
    savedStoriesKept: before.every((b) => after.some((a) => a.link === b.link)) || (outcome.ok ? "replaced by newer fetch" : false),
    lastSuccessfulRefresh: JSON.parse(recordText.get(source.id) || "{}").t || null,
    newestArticlePubDate: newestPub(after),
    consecutiveFailures: JSON.parse(recordText.get(source.id) || "{}").f ?? 0,
  };
}

const due = SOURCES.filter(isDue);
const results = [];
for (let i = 0; i < due.length; i += CONCURRENCY) results.push(...(await Promise.all(due.slice(i, i + CONCURRENCY).map(refresh))));

// One retry pass for failures, a little later: cheap here because a run has no CPU or subrequest cap.
const failed = results.filter((r) => r.status !== "ok").map((r) => SOURCES.find((s) => s.id === r.id));
if (failed.length && !process.argv.includes("--no-retry")) {
  await new Promise((r) => setTimeout(r, Number(arg("retryMs", 20_000))));
  for (const source of failed) {
    const first = results.find((r) => r.id === source.id);
    const again = await refresh(source);
    Object.assign(first, again, { wrote: first.wrote || again.wrote, firstAttempt: first.fetchResult, retried: true });
  }
}

const wrote = results.some((r) => r.wrote);
const lastTick = previous?.tick?.at ? Date.parse(previous.tick.at) : 0;
const heartbeat = now - lastTick >= HEARTBEAT_MS - SLACK_MS; // hourly "I ran" marker, same as the Worker's
const changed = force || wrote || heartbeat;

if (changed) {
  const tick = { t: new Date(now).toISOString(), at: new Date().toISOString(), run: "completed", src: null, result: `${due.length} due, ${results.filter((r) => r.status !== "ok").length} not ok` };
  const records = Object.fromEntries(SOURCES.map((s) => [s.id, recordText.get(s.id) || null]));
  const text = assembleFeedText(records, SOURCES, metaPrefixes(SOURCES), now, JSON.stringify(tick));
  JSON.parse(text); // refuse to write anything that is not valid JSON
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, text);
}

const finishedMs = Date.now();
const cpu = process.cpuUsage(cpuStart);
if (reportPath) {
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(
    reportPath,
    JSON.stringify(
      {
        collectorStartedAt: new Date(startedMs).toISOString(),
        collectorFinishedAt: new Date(finishedMs).toISOString(),
        collectorWallMs: finishedMs - startedMs,
        collectorCpuMs: Math.round((cpu.user + cpu.system) / 1000),
        node: process.version,
        platform: `${process.platform}-${process.arch}`,
        flags: { force, blocked: [...blocked] },
        sourcesDue: due.length,
        sourcesTotal: SOURCES.length,
        sourcesOk: results.filter((r) => r.status === "ok").length,
        results,
      },
      null,
      1,
    ),
  );
}
for (const r of results) console.log(`${r.id.padEnd(22)} ${r.status.padEnd(7)} ${String(r.fetchMs).padStart(5)}ms ${r.wrote ? "wrote" : "     "} ${r.error || ""}`);
console.log(`due ${due.length}/${SOURCES.length}; CHANGED=${changed}${changed ? ` (${wrote ? "content" : "hourly marker"})` : ""}; wall ${finishedMs - startedMs}ms cpu ${Math.round((cpu.user + cpu.system) / 1000)}ms`);
