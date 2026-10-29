// Turns per-source fetch results into the public snapshot. Pure: no network,
// no clock (callers pass `now`), so it is fully unit-testable.

import { categorize, isBlocked, locate, LOCATION_ORDER } from "./classify.js";
import { dedupe } from "./dedupe.js";
import { stripPublisherSuffix } from "./parse.js";

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const UNDATED_MAX_AGE_DAYS = 3;
const MAX_STORIES = 150;
const FAILING_AFTER = 3;

const LOCATION_WEIGHT = {
  "copperas-cove": 100,
  gatesville: 100,
  "coryell-county": 100,
  "central-texas": 50,
  texas: 10,
};

// Free-plan Workers get ~10 ms of CPU per invocation, so one run only fetches
// the few most overdue sources; the rest wait for the next cron run.
// A run fetches overdue sources until this many cost units are used (see `cost` in
// sources.js). Light sources batch together; heavy ones run nearly alone.
export const RUN_BUDGET = 5;

export function emptyState() {
  return { sources: {}, firstSeen: {} };
}

// Items only get older, so anything past its age limit is dropped at ingest;
// this keeps the stored state (and every later run's CPU) small.
function tooOld(item, source, now) {
  return Boolean(item.pubDate) && now - Date.parse(item.pubDate) > source.maxAgeDays * DAY;
}

function overdueRatio(source, sourceState, now) {
  if (!sourceState || !sourceState.lastAttempt) return Infinity;
  const elapsed = (now - Date.parse(sourceState.lastAttempt)) / 60_000;
  return elapsed / Math.max(source.refreshMinutes, backoffMinutes(sourceState.consecutiveFailures || 0));
}

// Sources that are due are not fetched the instant they come due. A run only starts
// when enough work has piled up to fill the budget, or when some source has waited
// 25% longer than its interval. Batching means fewer runs and fewer KV writes, and
// the longest extra wait is a quarter of a source's own interval.
export const PATIENCE = 1.25;

// The most overdue due sources (never-fetched first), within the run's cost budget.
export function pickDue(sources, state, now, budget = RUN_BUDGET) {
  const ordered = sources
    .filter((source) => isDue(source, state.sources[source.id], now))
    .map((source) => ({ source, overdue: overdueRatio(source, state.sources[source.id], now) }))
    .sort((a, b) => (a.overdue === b.overdue ? 0 : a.overdue > b.overdue ? -1 : 1));

  const dueCost = ordered.reduce((sum, entry) => sum + (entry.source.cost || 1), 0);
  const urgent = ordered.some((entry) => entry.overdue >= PATIENCE);
  if (!ordered.length || (!urgent && dueCost < budget)) return [];

  const picked = [];
  let used = 0;
  for (const { source } of ordered) {
    const cost = source.cost || 1;
    // Always take the most overdue source, even if it alone exceeds the budget.
    if (picked.length && used + cost > budget) continue;
    picked.push(source);
    used += cost;
  }
  return picked;
}

// Everything about an item that does not change with time (place, topics,
// cleaned title) is worked out once, when the item is fetched, and stored.
export function prepareItem(raw, source) {
  const publisher = raw.publisher || source.name;
  const title = stripPublisherSuffix(raw.title, raw.publisher);
  if (isBlocked(title, publisher)) return null;

  const location = locate(title, source, raw.publisher);
  return {
    title,
    link: raw.link,
    publisher,
    pubDate: raw.pubDate || null,
    expires: raw.expires || null,
    summary: raw.summary && !/^https?:/.test(raw.summary) ? raw.summary : "",
    location: location.locations[0],
    locations: location.locations,
    locationBasis: location.basis,
    categories: raw.alert ? ["public-safety"] : categorize(title, source, location),
  };
}

// Minutes to wait before retrying a failing source: 5, 10, 20 ... capped at 2h.
export function backoffMinutes(consecutiveFailures) {
  if (consecutiveFailures <= 0) return 0;
  return Math.min(5 * 2 ** (consecutiveFailures - 1), 120);
}

// Should this source be fetched in this run?
export function isDue(source, sourceState, now) {
  if (!sourceState || !sourceState.lastAttempt) return true;
  const sinceAttempt = (now - Date.parse(sourceState.lastAttempt)) / 60_000;
  const wait = Math.max(source.refreshMinutes, backoffMinutes(sourceState.consecutiveFailures || 0));
  // Small tolerance so a 15-minute cron isn't skipped by seconds of jitter.
  return sinceAttempt >= wait - 1;
}

// Folds fetch outcomes into the persistent state. `outcomes` maps source id to
// { ok: true, items } | { ok: false, error }. Sources absent from `outcomes`
// were not due and keep their previous data untouched.
export function applyOutcomes(state, sources, outcomes, now) {
  const nowIso = new Date(now).toISOString();
  const next = { sources: { ...state.sources }, firstSeen: { ...state.firstSeen } };

  for (const source of sources) {
    const outcome = outcomes[source.id];
    if (!outcome) continue;
    const previous = next.sources[source.id] || { items: [], consecutiveFailures: 0 };

    next.sources[source.id] = outcome.ok
      ? {
          items: outcome.items.map((raw) => prepareItem(raw, source)).filter((item) => item && !tooOld(item, source, now)),
          lastAttempt: nowIso,
          lastSuccess: nowIso,
          consecutiveFailures: 0,
          lastError: null,
        }
      : {
          // Last-known-good: keep the old items, record the failure.
          items: previous.items || [],
          lastAttempt: nowIso,
          lastSuccess: previous.lastSuccess || null,
          consecutiveFailures: (previous.consecutiveFailures || 0) + 1,
          lastError: String(outcome.error || "unknown error").slice(0, 160),
        };
  }

  // Remember when we first saw each undated item, then forget links that have
  // left every source so the map can't grow without bound.
  const live = new Set();
  for (const source of sources) {
    for (const item of next.sources[source.id]?.items || []) {
      live.add(item.link);
      if (!item.pubDate && !next.firstSeen[item.link]) next.firstSeen[item.link] = nowIso;
    }
  }
  for (const link of Object.keys(next.firstSeen)) if (!live.has(link)) delete next.firstSeen[link];

  return next;
}

function recencyPoints(timeMs, now) {
  if (!timeMs) return 0;
  const hours = Math.max(0, (now - timeMs) / HOUR);
  return Math.max(0, 40 - hours / 6);
}

function scoreStory(story, source, now) {
  let score = LOCATION_WEIGHT[story.location] ?? 0;
  if (story.locationBasis === "title") score += 10;
  if (story.locationBasis === "search") score -= 10;
  if (story.locationBasis === "publisher") score += 6;
  if (story.kind === "official") score += 8;
  score += recencyPoints(story.pubDate ? Date.parse(story.pubDate) : 0, now);
  return Math.round(score * 10) / 10;
}

// Only the time-dependent parts happen here: expiry, age, recency score.
function toStory(raw, source, sourceState, state, now) {
  const publisher = raw.publisher;
  const title = raw.title;

  // An item with an explicit expiry (weather alerts) disappears once past it.
  if (raw.expires && Date.parse(raw.expires) < now) return null;

  const published = raw.pubDate ? Date.parse(raw.pubDate) : null;
  const firstSeen = !published ? state.firstSeen[raw.link] || null : null;
  const reference = published ?? (firstSeen ? Date.parse(firstSeen) : null);
  if (reference === null) return null;

  const maxAgeDays = published ? source.maxAgeDays : Math.min(source.maxAgeDays, UNDATED_MAX_AGE_DAYS);
  if (now - reference > maxAgeDays * DAY) return null;

  const story = {
    id: shortHash(raw.link),
    title,
    link: raw.link,
    source: publisher,
    sourceId: source.id,
    publisher,
    kind: source.kind,
    pubDate: raw.pubDate || null,
    firstSeen,
    location: raw.location,
    locations: raw.locations,
    locationBasis: raw.locationBasis,
    categories: raw.categories,
    summary: raw.summary,
    stale: sourceState.consecutiveFailures > 0,
    fetchedAt: sourceState.lastSuccess,
  };
  story.score = scoreStory(story, source, now);
  return story;
}

function shortHash(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function timeOf(story) {
  return Date.parse(story.pubDate || story.firstSeen || 0) || 0;
}

export function buildStories(state, sources, now) {
  const candidates = [];

  for (const source of sources) {
    const sourceState = state.sources[source.id];
    if (!sourceState) continue;

    const stories = sourceState.items.map((raw) => toStory(raw, source, sourceState, state, now)).filter(Boolean);
    stories.sort((a, b) => timeOf(b) - timeOf(a));
    candidates.push(...stories.slice(0, source.cap));
  }

  // Best-first so duplicate clusters keep the strongest version.
  candidates.sort((a, b) => b.score - a.score || timeOf(b) - timeOf(a));
  return dedupe(candidates).slice(0, MAX_STORIES);
}

export function buildHealth(state, sources, stories, now) {
  return sources.map((source) => {
    const sourceState = state.sources[source.id];
    const published = stories.filter((story) => story.sourceId === source.id).length;

    if (!sourceState) {
      return { id: source.id, name: source.name, kind: source.kind, status: "pending", itemsFetched: 0, itemsShown: 0 };
    }

    const failures = sourceState.consecutiveFailures || 0;
    const status = failures >= FAILING_AFTER ? "failing" : failures > 0 ? "stale" : "ok";

    return {
      id: source.id,
      name: source.name,
      kind: source.kind,
      status,
      lastSuccess: sourceState.lastSuccess,
      lastAttempt: sourceState.lastAttempt,
      consecutiveFailures: failures,
      lastError: sourceState.lastError,
      itemsFetched: sourceState.items.length,
      itemsShown: published,
      ageMinutes: sourceState.lastSuccess ? Math.round((now - Date.parse(sourceState.lastSuccess)) / 60_000) : null,
    };
  });
}

// Short hash of what visitors can actually see change: which stories exist, whether
// each is a saved copy, and each source's status. Used to skip pointless KV writes.
export function fingerprint(stories, health) {
  let hash = 2166136261;
  const feed = (text) => {
    for (let i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
  };
  for (const story of stories) feed(`${story.id}${story.stale ? "s" : ""}|`);
  for (const entry of health) feed(`${entry.id}:${entry.status}|`);
  return (hash >>> 0).toString(36);
}

export function buildSnapshot(state, sources, now) {
  const stories = buildStories(state, sources, now);
  const health = buildHealth(state, sources, stories, now);
  const electionStories = stories.filter((story) => story.categories.includes("elections")).slice(0, 12);

  return {
    schema: 2,
    generatedAt: new Date(now).toISOString(),
    fingerprint: fingerprint(stories, health),
    stories,
    health,
    sourcesOk: health.filter((entry) => entry.status === "ok").length,
    sourcesTotal: health.length,
    // Kept for the previous version of the site during a staggered deploy.
    electionStories,
    locations: LOCATION_ORDER,
  };
}
