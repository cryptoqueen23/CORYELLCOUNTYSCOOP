// Command line for the GitHub Actions workflow (.github/workflows/collect-news.yml).
//
//   node collector/collect.mjs --state=data/news.json --out=data/news.json [--force] [--block=id,id] [--retry-ms=20000]
//
// Exit codes: 0 = ran (some sources may have failed; that is normal and isolated)
//             2 = the run itself failed (state file unreadable, or nothing reachable), so the workflow run is marked failed.
// Only a failed RUN is an alert; a single failing source never fails the workflow.

import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { runSource } from "../rss-worker/lib/fetchers.js";
import { SOURCES } from "../rss-worker/lib/sources.js";
import { collect, summaryMarkdown } from "./run.mjs";

const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k, v.length ? v.join("=") : "true"];
  }),
);
const statePath = args.state || "data/news.json";
const outPath = args.out || statePath;
const blocked = new Set((args.block || "").split(",").filter(Boolean)); // test hook: simulate dead sources

let previous = null;
try {
  previous = JSON.parse(readFileSync(statePath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") {
    // A file that exists but cannot be read must never be overwritten with a fresh start.
    console.error(`::error title=State file unreadable::${statePath}: ${error.message}`);
    process.exit(2);
  }
  console.log("no previous feed: first run");
}

const run = await collect({
  previous,
  sources: SOURCES,
  now: Date.now(),
  force: args.force === "true",
  retryDelayMs: Number(args["retry-ms"] || 20_000),
  fetchSource: async (source, now) => (blocked.has(source.id) ? { ok: false, error: "simulated outage" } : runSource(source, now, { summaries: true })),
});

if (run.publish) {
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, run.text);
}
for (const r of run.results) console.log(`${r.id.padEnd(22)} ${r.error ? `FAILED ${r.error}` : `ok ${r.items} items`}`);
for (const r of run.results.filter((x) => x.status === "failing")) console.log(`::warning title=Source failing::${r.id}: ${r.error}`);
console.log(`due ${run.due}/${SOURCES.length}, ok ${run.okCount}, retried ${run.retried}, ${run.publish ? "PUBLISH" : "no publish"}`);

if (process.env.GITHUB_STEP_SUMMARY) {
  appendFileSync(process.env.GITHUB_STEP_SUMMARY, summaryMarkdown(run, SOURCES, run.text || (previous ? JSON.stringify(previous) : null)));
}
if (run.outage) {
  console.error("::error title=Collector outage::no source could be reached; nothing was published");
  process.exit(2);
}
