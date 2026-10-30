// Cloudflare Worker: collects approved local and Texas news sources for The
// Coryell County Messenger. Built to fit the Workers Free plan (10 ms CPU per
// invocation, 1,000 KV writes per day):
//
// - A cron trigger fires every 2 minutes. A fixed schedule (lib/schedule.js) names
//   the ONE source to fetch on each tick, so no saved state is read to decide.
// - The run reads that source's own saved record, fetches, cleans and classifies its
//   items, and writes the record back only if something visitors can see changed.
//   Other sources are never read, parsed or rewritten during a scheduled run.
// - Visitors get the saved records joined together as text and cached at the edge for
//   5 minutes. The server does no sorting or de-duplicating; the browser does
//   (news-logic.js), which is cheap and was measured.
// - Sources fail independently: a failed fetch only updates that source's own record.
//
// GET /         the feed (schema 3)
// GET /health   per-source status

import { runSource } from "./lib/fetchers.js";
import { assembleFeedText, healthFromFeed, metaPrefixes } from "./lib/feed.js";
import { ingest, savedValidators } from "./lib/ingest.js";
import { buildSchedule, sourceIdForTime } from "./lib/schedule.js";
import { SOURCES } from "./lib/sources.js";

const ALLOWED_ORIGINS = new Set([
  "https://www.coryellcountyhub.xyz",
  "https://coryellcountyhub.xyz",
  "https://coryellcountyscoop.vercel.app",
]);

const SCHEDULE = buildSchedule(SOURCES);
// TEST_SAMPLING="fast" (test Worker only): every source on a 30-minute period, so a short trial
// samples each source several times. Per-run CPU is unaffected; daily totals are projected from the real schedule.
const FAST_SCHEDULE = buildSchedule(SOURCES.map((source) => ({ ...source, refreshMinutes: 30 })));
const SOURCE_BY_ID = new Map(SOURCES.map((source) => [source.id, source]));
const PREFIXES = metaPrefixes(SOURCES);
const RECORD_KEY = (id) => `src:${id}`;
const FEED_CACHE_SECONDS = 300;
const feedCacheKey = () => new Request("https://cache.invalid/feed-v3");

// Fetch one source and save its record if it changed. Never throws.
export async function refreshSource(env, source, now = Date.now()) {
  // CLASSIFY_CONTEXT="0" (test Worker only) turns off description/link location evidence.
  const options = { context: env.CLASSIFY_CONTEXT !== "0" };
  const previousText = await env.NEWS_KV.get(RECORD_KEY(source.id), "text");
  // CONDITIONAL_FETCH="1" asks the server whether the page changed (ETag / Last-Modified) before downloading it.
  const validators = env.CONDITIONAL_FETCH === "1" ? savedValidators(previousText) || { et: "", lm: "" } : null;
  const outcome = await runSource(source, now, { summaries: options.context, validators });
  const result = ingest(previousText, outcome, source, now, options);
  if (result.write) await env.NEWS_KV.put(RECORD_KEY(source.id), result.text);
  console.log(JSON.stringify({ src: source.id, status: result.status, wrote: result.write, notModified: result.notModified || undefined, error: outcome.ok ? undefined : outcome.error }));
  return result;
}

function corsHeaders(origin) {
  const headers = {
    Vary: "Origin",
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
  };
  if (ALLOWED_ORIGINS.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

function respond(body, origin, status = 200) {
  return new Response(body, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(origin),
    },
  });
}

const json = (value, origin, status = 200) => respond(JSON.stringify(value), origin, status);

async function loadFeedText(env, ctx) {
  const cache = caches.default;
  const hit = await cache.match(feedCacheKey());
  if (hit) return hit.text();

  const texts = await Promise.all(SOURCES.map((source) => env.NEWS_KV.get(RECORD_KEY(source.id), "text")));
  const records = Object.fromEntries(SOURCES.map((source, index) => [source.id, texts[index]]));
  const text = assembleFeedText(records, SOURCES, PREFIXES, Date.now());

  ctx.waitUntil(
    cache.put(
      feedCacheKey(),
      new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": `public, max-age=${FEED_CACHE_SECONDS}` } }),
    ),
  );
  return text;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(origin) });
    if (request.method !== "GET") return json({ error: "Method not allowed" }, origin, 405);

    const path = new URL(request.url).pathname;
    if (path !== "/" && path !== "/health") return json({ error: "Not found" }, origin, 404);
    if (!env.NEWS_KV) return json({ error: "Storage is not configured" }, origin, 503);

    const text = await loadFeedText(env, ctx);
    if (path === "/health") return json(healthFromFeed(JSON.parse(text)), origin);
    return respond(text, origin);
  },

  async scheduled(event, env, ctx) {
    if (!env.NEWS_KV) {
      console.log(JSON.stringify({ error: "NEWS_KV is not bound" }));
      return;
    }
    const id = sourceIdForTime(env.TEST_SAMPLING === "fast" ? FAST_SCHEDULE : SCHEDULE, event.scheduledTime);
    if (!id) return; // idle tick
    ctx.waitUntil(refreshSource(env, SOURCE_BY_ID.get(id), event.scheduledTime));
  },
};
