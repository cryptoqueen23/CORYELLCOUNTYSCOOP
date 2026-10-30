// Health, reported as three separate questions so a quiet news day is never mistaken for a failure:
//
//   scheduler  Is the cron trigger running at all?  (hourly `meta:lastTick` marker)
//              It proves one scheduled execution ran. It does NOT prove any source was fetched.
//   fetch      Is each source being retrieved successfully?  (saved failure count and last confirmation)
//   content    Does a healthy source have current stories?  ("quiet" is normal, not a fault)
//
// Pure functions: the caller passes `now`.

import { FAILING_AFTER, HEARTBEAT_MS } from "./ingest.js";

const MINUTE = 60_000;
const DAY = 86_400_000;

// The marker is written once an hour; allow for a late tick before calling it late or missing.
export const TICK_LATE_MS = 90 * MINUTE;
export const TICK_MISSING_MS = 3 * 60 * MINUTE;
// A tick that ran this long after its scheduled time is "delayed" (late execution, not a missed one).
export const EXECUTION_DELAY_MS = 10 * MINUTE;

// An unchanged source is only re-saved once its last confirmation is older than HEARTBEAT_MS, and
// fetches happen every `refreshMinutes`, so a healthy source's confirmation can be this old:
//   interval longer than the heartbeat: re-saved on every fetch  -> interval
//   otherwise: re-saved at the first fetch after the heartbeat   -> heartbeat + interval
export function expectedMaxAgeMs(refreshMinutes) {
  const interval = refreshMinutes * MINUTE;
  return interval > HEARTBEAT_MS ? interval : HEARTBEAT_MS + interval;
}

// Past this age with no recorded failure, a fetch was missed (one whole extra interval plus 5 minutes of slack is tolerated).
export function overdueAfterMs(refreshMinutes) {
  return expectedMaxAgeMs(refreshMinutes) + refreshMinutes * MINUTE + 5 * MINUTE;
}

// Statuses, worst first: missing (no execution for 3 h) > late (none for 90 min) > degraded (the last
// execution itself errored) > delayed (it ran, but well after its scheduled time) > ok.
// `lastTickResult` is how that one tick's own source went; it never stands for any other source.
export function schedulerHealth(tick, now) {
  if (!tick || !tick.t) {
    return { status: "unknown", lastScheduled: null, lastExecuted: null, ageMinutes: null, note: "No scheduler marker has been written yet." };
  }
  const executed = tick.at || tick.t; // markers from before 'at' existed only had the scheduled time
  const age = now - Date.parse(executed);
  const delay = tick.at ? Date.parse(tick.at) - Date.parse(tick.t) : 0;
  let status = "ok";
  if (age > TICK_MISSING_MS) status = "missing";
  else if (age > TICK_LATE_MS) status = "late";
  else if (tick.run === "error") status = "degraded";
  else if (delay > EXECUTION_DELAY_MS) status = "delayed";
  return {
    status,
    lastScheduled: tick.t,
    lastExecuted: executed,
    executionDelayMinutes: Math.round(delay / MINUTE),
    ageMinutes: Math.round(age / MINUTE),
    lastRun: tick.run || "completed",
    lastTickSource: tick.src || null,
    lastTickResult: tick.result || tick.status || null,
    lastError: tick.error || null,
    note: "Shows that a scheduled run executed, and when. It does not show that every source was fetched; see each source's own fetch status.",
  };
}

const itemTime = (item) => Date.parse(item.pubDate || item.fs || 0) || 0;

export function sourceHealth(source, rec, now) {
  const base = { id: source.id, name: source.name, kind: source.kind, refreshMinutes: source.refreshMinutes };
  if (!rec) return { ...base, status: "pending", fetch: "pending", content: "none", items: 0 };

  const failures = rec.f || 0;
  const confirmedAge = rec.t ? now - Date.parse(rec.t) : null;
  const overdueAfter = overdueAfterMs(source.refreshMinutes);

  let fetch = "ok";
  if (failures >= FAILING_AFTER) fetch = "failing";
  else if (failures > 0) fetch = "retrying";
  else if (confirmedAge !== null && confirmedAge > overdueAfter) fetch = "overdue";

  const limit = source.maxAgeDays * DAY;
  const current = rec.items.filter((item) => {
    const time = itemTime(item);
    return time && now - time <= limit && !(item.expires && Date.parse(item.expires) < now);
  });
  const newest = current.reduce((max, item) => Math.max(max, itemTime(item)), 0);
  // A healthy source with nothing current is "quiet" (an agency that rarely posts), never a fault.
  const content = current.length ? "current" : fetch === "ok" ? "quiet" : "none";

  return {
    ...base,
    // Legacy field the earlier /health and the page used: ok | stale | failing | pending.
    status: failures >= FAILING_AFTER ? "failing" : failures > 0 ? "stale" : "ok",
    fetch,
    content,
    lastConfirmed: rec.t,
    confirmedAgeMinutes: confirmedAge === null ? null : Math.round(confirmedAge / MINUTE),
    overdueAfterMinutes: Math.round(overdueAfter / MINUTE),
    consecutiveFailures: failures,
    lastError: rec.e,
    items: rec.items.length,
    currentItems: current.length,
    newestItem: newest ? new Date(newest).toISOString() : null,
  };
}

export function summarize(feed, now) {
  const health = feed.sources.map((source) => sourceHealth(source, source.rec, now));
  const count = (key, value) => health.filter((entry) => entry[key] === value).length;
  return {
    generatedAt: feed.generatedAt,
    scheduler: schedulerHealth(feed.tick, now),
    counts: {
      total: health.length,
      fetchOk: count("fetch", "ok"),
      retrying: count("fetch", "retrying"),
      failing: count("fetch", "failing"),
      overdue: count("fetch", "overdue"),
      pending: count("fetch", "pending"),
      quiet: count("content", "quiet"),
    },
    // Kept for the earlier shape of /health.
    sourcesOk: count("fetch", "ok"),
    sourcesTotal: health.length,
    health,
  };
}
