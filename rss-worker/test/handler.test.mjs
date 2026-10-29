import assert from "node:assert/strict";
import { test } from "node:test";

// Minimal stand-ins for the Workers runtime: an in-memory Cache API and a
// scripted global fetch.
const cacheStore = new Map();
globalThis.caches = {
  default: {
    async match(request) {
      const hit = cacheStore.get(request.url);
      return hit ? new Response(hit) : undefined;
    },
    async put(request, response) {
      cacheStore.set(request.url, await response.text());
    },
  },
};

const FEED = `<rss><channel><item><title>Copperas Cove council approves budget</title><link>https://www.copperascovetx.gov/a</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`;
let failEverything = false;
globalThis.fetch = async (url) => {
  if (failEverything) return new Response("nope", { status: 500 });
  const text = String(url);
  if (text.includes("gatesvilletx.com")) return new Response("{}");
  if (text.includes("api.weather.gov")) return new Response(JSON.stringify({ features: [] }));
  if (text.includes("txdot.gov") || text.includes("texasattorneygeneral.gov")) return new Response("<html></html>");
  return new Response(FEED);
};

const { default: worker, refresh } = await import("../worker.js");
const ctx = { waitUntil: (promise) => promise };
const request = (path, origin, method = "GET") =>
  new Request(`https://worker.example${path}`, { method, headers: origin ? { Origin: origin } : {} });

test("serves a snapshot and echoes CORS only for approved origins", async () => {
  await refresh({}, { force: true });
  const ok = await worker.fetch(request("/", "https://www.coryellcountyhub.xyz"), {}, ctx);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "https://www.coryellcountyhub.xyz");
  const body = await ok.json();
  assert.equal(body.schema, 2);
  assert.ok(body.stories.some((story) => story.title.includes("Copperas Cove")));

  const denied = await worker.fetch(request("/", "https://evil.example"), {}, ctx);
  assert.equal(denied.status, 200);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
});

test("preflight, unknown paths and non-GET methods", async () => {
  const preflight = await worker.fetch(request("/", "https://coryellcountyscoop.vercel.app", "OPTIONS"), {}, ctx);
  assert.equal(preflight.status, 204);
  assert.equal((await worker.fetch(request("/nope"), {}, ctx)).status, 404);
  assert.equal((await worker.fetch(request("/", null, "POST"), {}, ctx)).status, 405);
});

test("/health reports per-source status", async () => {
  const body = await (await worker.fetch(request("/health"), {}, ctx)).json();
  assert.ok(body.sourcesTotal > 5);
  assert.ok(body.health.every((entry) => entry.id && entry.status));
});

test("when every source fails, the last good snapshot is still served", async () => {
  await refresh({}, { force: true }); // known-good state
  failEverything = true;
  await refresh({}, { force: true }); // all sources now fail
  const body = await (await worker.fetch(request("/"), {}, ctx)).json();
  failEverything = false;
  assert.ok(body.stories.length > 0, "cached stories survive total outage");
  assert.ok(body.stories.every((story) => story.stale === true), "and are marked stale");
  assert.ok(body.health.every((entry) => entry.status !== "ok"));
});
