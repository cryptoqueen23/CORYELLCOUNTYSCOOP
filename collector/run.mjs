// Core of the GitHub Actions collector. Given the previous published feed (the only saved state), it refreshes
// every source that is due and returns the new feed text, or null when nothing worth publishing changed.
//
// The feed is the same schema 3 the Worker served: one saved record per source (see rss-worker/lib/ingest.js),
// so the site's feed-build.js reads it unchanged. Three different times are kept apart:
//   collector run time      feed.tick.at          when this program last ran (the page's "updated" time)
//   last successful refresh rec.t (per source)    set only when a fetch of that source succeeded
//   article publication     item.pubDate          what the publisher says; never invented (undated items carry `fs`)

import { assembleFeedText, metaPrefixes } from "../rss-worker/lib/feed.js";
import { HEARTBEAT_MS, ingest } from "../rss-worker/lib/ingest.js";

const CONCURRENCY = 5;
const SLACK_MS = 4 * 60_000; // a run that fires a little early still counts a source as due
// Errors that retrying a minute later cannot fix: the server answered "no" (403 blocked, 404 gone...).
// 408 and 429 are the transient 4xx cases.
const PERMANENT = /^HTTP 4(?!08|29)\d\d/;

const recordsOf = (feed) => new Map((feed?.sources || []).map((s) => [s.id, s.rec ? JSON.stringify(s.rec) : null]));
const parseRecord = (text) => (text ? JSON.parse(text) : null);

export function isDue(source, recordText, now, force = false) {
  const rec = parseRecord(recordText);
  if (!rec || force) return true;
  if (rec.f > 0) return true; // a failing source is retried on every run
  return !rec.t || now - Date.parse(rec.t) >= source.refreshMinutes * 60_000 - SLACK_MS;
}

/**
 * @param {object} o
 * @param {object|null} o.previous  the last published feed (parsed) or null on the very first run
 * @param {object[]} o.sources      source registry
 * @param {Function} o.fetchSource  (source, now) => { ok, items } | { ok:false, error }   never throws
 * @param {number} o.now
 * @param {boolean} [o.force]       refresh every source regardless of schedule
 * @param {number} [o.retryDelayMs] wait before the single retry pass for transient failures
 * @param {Function} [o.sleep]
 */
export async function collect({ previous, sources, fetchSource, now, force = false, retryDelayMs = 20_000, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  const records = recordsOf(previous);
  const due = sources.filter((s) => isDue(s, records.get(s.id), now, force));
  const results = new Map();

  async function refresh(source) {
    const outcome = await fetchSource(source, now);
    const result = ingest(records.get(source.id) || null, outcome, source, now, { context: true });
    if (result.write) records.set(source.id, result.text);
    const prior = results.get(source.id);
    results.set(source.id, {
      id: source.id,
      status: result.status,
      wrote: Boolean(result.write) || Boolean(prior?.wrote),
      error: outcome.ok ? null : String(outcome.error || "unknown error"),
      items: outcome.ok ? outcome.items.length : 0,
    });
  }

  for (let i = 0; i < due.length; i += CONCURRENCY) await Promise.all(due.slice(i, i + CONCURRENCY).map(refresh));

  // One retry pass for transient failures. Cheap here: a run has no CPU or subrequest limit.
  const retry = due.filter((s) => {
    const r = results.get(s.id);
    return r.error && !PERMANENT.test(r.error);
  });
  if (retry.length) {
    await sleep(retryDelayMs);
    for (const source of retry) await refresh(source);
  }

  const wrote = [...results.values()].some((r) => r.wrote);
  const lastRun = previous?.tick?.at ? Date.parse(previous.tick.at) : 0;
  const markerDue = now - lastRun >= HEARTBEAT_MS - SLACK_MS; // the hourly "the collector ran" marker
  const withData = sources.filter((s) => parseRecord(records.get(s.id))?.t).length; // sources that have succeeded at least once
  const attempted = [...results.values()];
  const okCount = attempted.filter((r) => !r.error).length;

  // Nothing was reachable at all (the runner's network is down, say): do not publish an empty feed over good data.
  const outage = attempted.length >= 3 && okCount === 0;
  const publish = !outage && withData > 0 && (wrote || markerDue || force);

  let text = null;
  if (publish) {
    const tick = { t: new Date(now).toISOString(), at: new Date().toISOString(), run: "completed", src: null, result: `${attempted.length} due, ${attempted.length - okCount} not ok` };
    const body = Object.fromEntries(sources.map((s) => [s.id, records.get(s.id) || null]));
    text = assembleFeedText(body, sources, metaPrefixes(sources), now, JSON.stringify(tick));
    JSON.parse(text); // never publish anything that is not valid JSON
  }
  return { text, publish, outage, results: attempted, due: due.length, okCount, withData, retried: retry.length };
}

export function summaryMarkdown(run, sources, feedText) {
  const byId = new Map((feedText ? JSON.parse(feedText).sources : []).map((s) => [s.id, s.rec]));
  const lines = ["| source | this run | consecutive failures | last good refresh (UTC) |", "|---|---|---|---|"];
  for (const s of sources) {
    const r = run.results.find((x) => x.id === s.id);
    const rec = byId.get(s.id);
    lines.push(`| ${s.id} | ${r ? (r.error ? `FAILED: ${r.error.slice(0, 60)}` : `ok (${r.items} items)`) : "not due"} | ${rec ? rec.f : "-"} | ${rec?.t ? rec.t.slice(0, 16).replace("T", " ") : "never"} |`);
  }
  return `${lines.join("\n")}\n\n${run.due} due, ${run.okCount} ok, ${run.retried} retried. ${run.publish ? "Published a new file." : run.outage ? "OUTAGE: nothing reachable, nothing published." : "Nothing to publish."}\n`;
}
