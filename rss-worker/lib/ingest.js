// Turns one source's fetch result into its saved record. Only this one source is
// touched: nothing else is read, parsed or sorted. The record is only written back
// to KV when something visitors can see has changed (see `write`).
//
// Record: { t: last confirmed (ISO), f: consecutive failures, e: last error,
//           h: hash of items, items: [ prepared items, newest first, at most cap ] }

import { categorize, isBlocked, locate } from "./classify.js";
import { stripPublisherSuffix } from "./parse.js";

const DAY = 86_400_000;
// An unchanged source is still re-saved this often, so its "last confirmed" time stays honest.
export const HEARTBEAT_MS = 60 * 60 * 1000;
export const FAILING_AFTER = 3;

export function statusOf(failures) {
  return failures >= FAILING_AFTER ? "failing" : failures > 0 ? "stale" : "ok";
}

// Everything about an item that does not change with time (place, topics,
// cleaned title) is worked out once, here.
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
    // Summaries are only shown for official announcements.
    summary: source.kind === "official" && raw.summary && !/^https?:/.test(raw.summary) ? raw.summary : "",
    location: location.locations[0],
    locations: location.locations,
    locationBasis: location.basis,
    categories: raw.alert ? ["public-safety"] : categorize(title, source, location),
  };
}

export function hashText(text) {
  let hash = 2166136261;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

const publishedTime = (item) => (item.pubDate ? Date.parse(item.pubDate) : 0);

// `previousText` is the saved record (JSON text) or null. Returns
// { write, text, status } where `text` is only meaningful when `write` is true.
export function ingest(previousText, outcome, source, now) {
  const previous = previousText ? JSON.parse(previousText) : null;
  const nowIso = new Date(now).toISOString();

  if (!outcome.ok) {
    // Keep the last good items; just record the failure.
    const failures = (previous ? previous.f : 0) + 1;
    const error = String(outcome.error || "unknown error").slice(0, 160);
    const record = { t: previous ? previous.t : null, f: failures, e: error, h: previous ? previous.h : "", items: previous ? previous.items : [] };
    // Only worth a write when the visible status changes or the reason does.
    const write = !previous || statusOf(previous.f) !== statusOf(failures) || previous.e !== error;
    return { write, text: write ? JSON.stringify(record) : "", status: statusOf(failures) };
  }

  const firstSeen = new Map(previous ? previous.items.map((item) => [item.link, item.fs]) : []);
  const items = outcome.items
    .map((raw) => prepareItem(raw, source))
    .filter((item) => item && !(item.pubDate && now - Date.parse(item.pubDate) > source.maxAgeDays * DAY))
    // An item whose source gave no date is labelled with when we first saw it, never a made-up date.
    .map((item) => (item.pubDate ? item : { ...item, fs: firstSeen.get(item.link) || nowIso }))
    .sort((a, b) => publishedTime(b) - publishedTime(a))
    .slice(0, source.cap);

  const itemsText = JSON.stringify(items);
  const hash = hashText(itemsText);
  const changed = !previous || previous.h !== hash;
  const recovered = Boolean(previous && previous.f > 0);
  const heartbeat = !previous || !previous.t || now - Date.parse(previous.t) > HEARTBEAT_MS;
  const write = changed || recovered || heartbeat;

  return {
    write,
    text: write ? `{"t":"${nowIso}","f":0,"e":null,"h":"${hash}","items":${itemsText}}` : "",
    status: "ok",
  };
}
