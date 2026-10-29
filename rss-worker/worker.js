// Cloudflare Worker: aggregates approved local and Texas news sources into one
// JSON snapshot for The Coryell County Messenger.
//
// - A cron trigger (every 3 minutes) refreshes the few most overdue sources.
//   Each run is deliberately small so it fits the Workers Free plan's CPU limit.
// - Each source is fetched independently; one failure never blocks the rest and
//   the last known good items are kept (see lib/aggregate.js).
// - State and the published snapshot live in the NEWS_KV binding. Without it the
//   Worker falls back to the per-datacenter Cache API, which is NOT shared between
//   the cron's location and visitors' locations, so KV is needed for reliable use.
// - GET /          the public snapshot (stories + feed health)
// - GET /health    feed health only

import { applyOutcomes, buildSnapshot, emptyState, pickDue } from "./lib/aggregate.js";
import { runSource } from "./lib/fetchers.js";
import { SOURCES } from "./lib/sources.js";

const ALLOWED_ORIGINS = new Set([
  "https://www.coryellcountyhub.xyz",
  "https://coryellcountyhub.xyz",
  "https://coryellcountyscoop.vercel.app",
]);

// A snapshot older than this is refreshed on demand (serving the old one
// meanwhile) in case the cron trigger is not set up or has paused.
const STALE_AFTER_MS = 20 * 60 * 1000;
const STATE_KEY = "news-state-v3";
const SNAPSHOT_KEY = "news-snapshot-v3";

function cacheRequest(key) {
  return new Request(`https://cache.invalid/${key}`);
}

// Values are stored as JSON text so serving a snapshot never re-serializes it.
const store = {
  async getText(env, key) {
    if (env.NEWS_KV) return env.NEWS_KV.get(key, "text");
    const hit = await caches.default.match(cacheRequest(key));
    return hit ? hit.text() : null;
  },
  async putText(env, key, text) {
    if (env.NEWS_KV) return env.NEWS_KV.put(key, text);
    return caches.default.put(
      cacheRequest(key),
      new Response(text, { headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=604800" } }),
    );
  },
};

// Concurrent callers in one isolate share a single in-flight refresh, so a
// burst of visitors while the snapshot is stale cannot multiply upstream requests.
let inFlight = null;

export function refresh(env, options = {}) {
  if (!inFlight) {
    inFlight = runRefresh(env, options).finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

// Fetches the most overdue sources (all of them when `force`), merges into saved
// state and publishes a new snapshot. Does nothing when no source is due.
async function runRefresh(env, { force = false } = {}) {
  const now = Date.now();
  const stateText = await store.getText(env, STATE_KEY);
  const state = stateText ? JSON.parse(stateText) : emptyState();

  const due = force ? SOURCES : pickDue(SOURCES, state, now);
  if (!due.length) return null;

  const results = await Promise.all(due.map((source) => runSource(source, now)));
  const outcomes = {};
  due.forEach((source, index) => {
    outcomes[source.id] = results[index];
  });

  const nextState = applyOutcomes(state, SOURCES, outcomes, now);
  const snapshotText = JSON.stringify(buildSnapshot(nextState, SOURCES, now));

  await store.putText(env, STATE_KEY, JSON.stringify(nextState));
  await store.putText(env, SNAPSHOT_KEY, snapshotText);
  return snapshotText;
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

function jsonText(text, origin, status = 200) {
  return new Response(text, {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      // Browsers may reuse this briefly; the snapshot carries its own timestamp.
      "Cache-Control": "public, max-age=60",
      "X-Content-Type-Options": "nosniff",
      ...corsHeaders(origin),
    },
  });
}

const json = (body, origin, status = 200) => jsonText(JSON.stringify(body), origin, status);

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    if (request.method !== "GET") return json({ error: "Method not allowed" }, origin, 405);

    const path = new URL(request.url).pathname;
    if (path !== "/" && path !== "/health") return json({ error: "Not found" }, origin, 404);

    let snapshotText = await store.getText(env, SNAPSHOT_KEY);

    if (!snapshotText) {
      // Nothing published yet (first minutes after deploy). Serve an honest empty
      // snapshot and let the cron fill it in; kick one small refresh now.
      ctx.waitUntil(refresh(env));
      snapshotText = JSON.stringify(buildSnapshot(emptyState(), SOURCES, Date.now()));
    } else {
      // Cheap staleness check without parsing the whole snapshot.
      const generated = Date.parse((snapshotText.match(/"generatedAt":"([^"]+)"/) || [])[1] || "");
      if (!generated || Date.now() - generated > STALE_AFTER_MS) ctx.waitUntil(refresh(env));
    }

    if (path === "/health") {
      const snapshot = JSON.parse(snapshotText);
      return json(
        {
          generatedAt: snapshot.generatedAt,
          sourcesOk: snapshot.sourcesOk,
          sourcesTotal: snapshot.sourcesTotal,
          health: snapshot.health,
        },
        origin,
      );
    }
    return jsonText(snapshotText, origin);
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(refresh(env));
  },
};
