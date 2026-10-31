import assert from "node:assert/strict";
import { test } from "node:test";

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
globalThis.fetch = async () => new Response(FEED);

const { default: worker, refreshSource } = await import("../worker.js");
const { SOURCES } = await import("../lib/sources.js");

const kvData = new Map();
const env = {
  NEWS_KV: {
    async get(key) {
      return kvData.has(key) ? kvData.get(key) : null;
    },
    async put(key, value) {
      kvData.set(key, value);
    },
  },
};
const ctx = { waitUntil: (promise) => promise };
const request = (path, origin, method = "GET") =>
  new Request(`https://worker.example${path}`, { method, headers: origin ? { Origin: origin } : {} });

test("serves the feed and echoes CORS only for approved origins", async () => {
  await refreshSource(env, SOURCES.find((s) => s.id === "cove-city") || SOURCES[0]);
  cacheStore.clear();
  const ok = await worker.fetch(request("/", "https://www.coryellcountyhub.xyz"), env, ctx);
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get("Access-Control-Allow-Origin"), "https://www.coryellcountyhub.xyz");
  const body = await ok.json();
  assert.equal(body.schema, 3);
  assert.equal(body.sources.length, SOURCES.length);
  assert.ok(body.sources.some((s) => s.rec && s.rec.items.length));

  const denied = await worker.fetch(request("/", "https://evil.example"), env, ctx);
  assert.equal(denied.headers.get("Access-Control-Allow-Origin"), null);
});

test("preflight, unknown paths and non-GET methods", async () => {
  const preflight = await worker.fetch(request("/", "https://coryellcountyscoop.vercel.app", "OPTIONS"), env, ctx);
  assert.equal(preflight.status, 204);
  assert.equal((await worker.fetch(request("/nope"), env, ctx)).status, 404);
  assert.equal((await worker.fetch(request("/", null, "POST"), env, ctx)).status, 405);
});

test("/health reports each source, with pending ones named", async () => {
  cacheStore.clear();
  const body = await (await worker.fetch(request("/health"), env, ctx)).json();
  assert.equal(body.sourcesTotal, SOURCES.length);
  assert.ok(body.health.every((entry) => entry.id && entry.status));
  assert.ok(body.health.some((entry) => entry.status === "pending"));
  assert.ok(body.health.some((entry) => entry.status === "ok" && entry.lastConfirmed));
});
