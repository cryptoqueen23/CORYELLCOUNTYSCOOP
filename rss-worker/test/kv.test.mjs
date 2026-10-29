import assert from "node:assert/strict";
import { test } from "node:test";

import { RUN_BUDGET, applyOutcomes, emptyState, pickDue } from "../lib/aggregate.js";
import { SOURCES } from "../lib/sources.js";

// A fake KV that counts operations, and a fake network that returns a fixed feed.
function fakeKv() {
  const data = new Map();
  return {
    reads: 0,
    writes: 0,
    writesByKey: {},
    async get(key) {
      this.reads += 1;
      return data.has(key) ? data.get(key) : null;
    },
    async put(key, value) {
      this.writes += 1;
      this.writesByKey[key] = (this.writesByKey[key] || 0) + 1;
      data.set(key, value);
    },
  };
}

let feedItems = [{ title: "Copperas Cove council approves budget", link: "https://www.copperascovetx.gov/a" }];
const rssFor = () =>
  `<rss><channel>${feedItems
    .map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${new Date().toUTCString()}</pubDate></item>`)
    .join("")}</channel></rss>`;

globalThis.caches = { default: { async match() {}, async put() {} } };
globalThis.fetch = async (url) => {
  const text = String(url);
  if (text.includes("gatesvilletx.com")) return new Response("{}");
  if (text.includes("api.weather.gov")) return new Response(JSON.stringify({ features: [] }));
  if (text.includes("texasattorneygeneral.gov"))
    return new Response('<div class="m-b-3"><h4><a href="/news/x">AG release</a></h4><p class="meta m-b-0">October 28, 2026 |</p></div>');
  if (text.includes("txdot.gov"))
    return new Response('<a class="cmp-list__item-link" href="/news/y"><span class="cmp-list__item-title">Road work</span></a>');
  return new Response(rssFor());
};

const { default: worker, refresh } = await import("../worker.js");

test("a run is bounded by the CPU-cost budget and light sources are batched", () => {
  const picked = pickDue(SOURCES, emptyState(), Date.now());
  const cost = picked.reduce((sum, source) => sum + (source.cost || 1), 0);
  assert.ok(picked.length >= 1);
  assert.ok(cost <= RUN_BUDGET || picked.length === 1);
  assert.ok(picked.length < SOURCES.length, "not everything in one run");
  assert.ok(picked.length > 2, "light sources are batched, fewer runs means fewer KV writes");
});

test("the heaviest source can never be starved by the budget", () => {
  const heavy = SOURCES.reduce((a, b) => ((b.cost || 1) > (a.cost || 1) ? b : a));
  const state = applyOutcomes(
    emptyState(),
    SOURCES,
    Object.fromEntries(SOURCES.filter((s) => s.id !== heavy.id).map((s) => [s.id, { ok: true, items: [] }])),
    Date.now(),
  );
  assert.deepEqual(pickDue(SOURCES, state, Date.now()).map((s) => s.id), [heavy.id]);
});

test("unchanged content does not rewrite the snapshot; changed content does", async () => {
  const env = { NEWS_KV: fakeKv() };

  await refresh(env, { force: true });
  assert.equal(env.NEWS_KV.writesByKey["news-snapshot-v3"], 1, "first publish");
  assert.equal(env.NEWS_KV.writesByKey["news-state-v3"], 1);

  // Same feeds again: state is written (scheduling), snapshot is not.
  await refresh(env, { force: true });
  await refresh(env, { force: true });
  assert.equal(env.NEWS_KV.writesByKey["news-snapshot-v3"], 1, "no change, no snapshot write");
  assert.equal(env.NEWS_KV.writesByKey["news-state-v3"], 3);

  // A new local story appears: published immediately (local news stays fast).
  feedItems = [...feedItems, { title: "Gatesville ISD names new superintendent", link: "https://www.copperascovetx.gov/b" }];
  await refresh(env, { force: true });
  assert.equal(env.NEWS_KV.writesByKey["news-snapshot-v3"], 2, "a new story is published at once");
});

test("/health reports today's runs and KV writes", async () => {
  const env = { NEWS_KV: fakeKv() };
  await refresh(env, { force: true });
  await refresh(env, { force: true });
  const response = await worker.fetch(new Request("https://w.example/health"), env, { waitUntil() {} });
  const body = await response.json();
  assert.equal(body.today.runs, 2);
  assert.equal(body.today.kvWrites, 3, "2 state writes + 1 snapshot write");
  assert.equal(body.today.snapshotWrites, 1);
});

test("serving a page view costs one KV read and no writes", async () => {
  const env = { NEWS_KV: fakeKv() };
  await refresh(env, { force: true });
  const reads = env.NEWS_KV.reads;
  const writes = env.NEWS_KV.writes;
  await worker.fetch(new Request("https://w.example/"), env, { waitUntil() {} });
  assert.equal(env.NEWS_KV.reads - reads, 1);
  assert.equal(env.NEWS_KV.writes - writes, 0);
});
