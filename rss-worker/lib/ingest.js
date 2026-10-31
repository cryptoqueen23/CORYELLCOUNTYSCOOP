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

function linkWords(link) {
  try {
    return new URL(link).pathname.replace(/[-_/]+/g, " ");
  } catch {
    return "";
  }
}

// Everything about an item that does not change with time (place, topics,
// cleaned title) is worked out once, here.
export function prepareItem(raw, source, options = {}) {
  const publisher = raw.publisher || source.name;
  const title = stripPublisherSuffix(raw.title, raw.publisher);
  if (isBlocked(title, publisher)) return null;

  // When the headline names no place, the description (and link path, as corroboration only)
  // may show the story is about one; see aboutPlace() in classify.js.
  const context = options.context === false ? {} : { summary: raw.summary || "", linkText: linkWords(raw.link) };
  const location = locate(title, source, raw.publisher, context);
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

// Validators (ETag / Last-Modified) sit before the items so they can be read without parsing the record.
function serialize(nowIso, hash, items, et, lm, itemsText = JSON.stringify(items)) {
  const valid = (value) => (value ? JSON.stringify(String(value).slice(0, 200)) : '""');
  return `{"t":"${nowIso}","f":0,"e":null,"h":"${hash}","et":${valid(et)},"lm":${valid(lm)},"items":${itemsText}}`;
}

// Cheap read of the saved validators without parsing the whole record.
export function savedValidators(recordText) {
  if (!recordText) return null;
  const head = recordText.slice(0, 600);
  const et = (head.match(/"et":"((?:[^"\\]|\\.)*)"/) || [])[1];
  const lm = (head.match(/"lm":"((?:[^"\\]|\\.)*)"/) || [])[1];
  return et || lm ? { et: et ? JSON.parse(`"${et}"`) : "", lm: lm ? JSON.parse(`"${lm}"`) : "" } : null;
}

// `previousText` is the saved record (JSON text) or null. Returns
// { write, text, status } where `text` is only meaningful when `write` is true.
export function ingest(previousText, outcome, source, now, options = {}) {
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

  if (outcome.notModified && previous) {
    // The server says nothing changed: keep the saved items, and only rewrite for the hourly confirmation
    // (or to clear an earlier failure).
    const recovered = previous.f > 0;
    const heartbeat = !previous.t || now - Date.parse(previous.t) > HEARTBEAT_MS;
    const write = recovered || heartbeat;
    return { write, text: write ? serialize(nowIso, previous.h, previous.items, previous.et, previous.lm) : "", status: "ok", notModified: true };
  }

  const firstSeen = new Map(previous ? previous.items.map((item) => [item.link, item.fs]) : []);
  const items = outcome.items
    .filter((raw) => !raw.futureDated) // a publisher date more than a day ahead means a bad feed clock: not news
    .map((raw) => prepareItem(raw, source, options))
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

  const validators = outcome.validators || {};
  return {
    write,
    text: write ? serialize(nowIso, hash, null, validators.et, validators.lm, itemsText) : "",
    status: "ok",
  };
}
