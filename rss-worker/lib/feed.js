// The visitor-facing feed is the saved per-source records joined together as TEXT.
// Nothing is parsed, sorted or rebuilt on the server: the browser applies freshness
// limits, ranking and de-duplication to the records it receives (news-logic.js).

import { statusOf } from "./ingest.js";

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
export function assembleFeedText(records, sources, prefixes, now) {
  const parts = sources.map((source) => `${prefixes[source.id]},"rec":${records[source.id] || "null"}}`);
  return `{"schema":3,"generatedAt":"${new Date(now).toISOString()}","sources":[${parts.join(",")}]}`;
}

// Compact health summary for /health (parses the feed, so it is only used on demand).
export function healthFromFeed(feed) {
  const health = feed.sources.map((source) => {
    const rec = source.rec;
    if (!rec) return { id: source.id, name: source.name, kind: source.kind, status: "pending", items: 0 };
    return {
      id: source.id,
      name: source.name,
      kind: source.kind,
      status: statusOf(rec.f),
      lastConfirmed: rec.t,
      consecutiveFailures: rec.f,
      lastError: rec.e,
      items: rec.items.length,
    };
  });
  return {
    generatedAt: feed.generatedAt,
    sourcesOk: health.filter((entry) => entry.status === "ok").length,
    sourcesTotal: health.length,
    health,
  };
}
