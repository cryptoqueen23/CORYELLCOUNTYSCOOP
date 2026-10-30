// The visitor-facing feed is the saved per-source records joined together as TEXT.
// Nothing is parsed, sorted or rebuilt on the server: the browser applies freshness
// limits, ranking and de-duplication to the records it receives (news-logic.js).

import { summarize } from "./health.js";

// Static per-source metadata, serialized once when the Worker starts.
export function metaPrefixes(sources) {
  const prefixes = {};
  for (const source of sources) {
    prefixes[source.id] = JSON.stringify({
      id: source.id,
      name: source.name,
      kind: source.kind,
      scope: source.scope,
      maxAgeDays: source.maxAgeDays,
      cap: source.cap,
      refreshMinutes: source.refreshMinutes,
    }).slice(0, -1); // drop the closing brace so the record can be appended
  }
  return prefixes;
}

// records: { sourceId: recordText | null }
// `tickText` is the saved hourly scheduler marker (JSON text) or null; it rides along so the page can tell
// when the cron stopped, instead of trusting `generatedAt`, which is only when this response was assembled.
export function assembleFeedText(records, sources, prefixes, now, tickText = null) {
  const parts = sources.map((source) => `${prefixes[source.id]},"rec":${records[source.id] || "null"}}`);
  return `{"schema":3,"generatedAt":"${new Date(now).toISOString()}","tick":${tickText || "null"},"sources":[${parts.join(",")}]}`;
}

// Health summary for /health (parses the feed, so it is only used on demand). See lib/health.js.
export function healthFromFeed(feed, now = Date.now()) {
  return summarize(feed, now);
}
