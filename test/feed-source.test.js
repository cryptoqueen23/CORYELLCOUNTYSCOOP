const assert = require("node:assert/strict");
const { test } = require("node:test");
const { loadFeed, normalizeFeed } = require("../feed-source.js");
const { build } = require("../feed-build.js");
const logic = require("../news-logic.js");

const NOW = Date.parse("2026-10-31T12:00:00Z");
const deps = { build: (raw) => ({ schema: 2, generatedAt: raw.g, stories: [] }), adaptLegacy: logic.adaptLegacySnapshot };
const feed3 = (minAgo, withData = 12) => ({ schema: 3, g: new Date(NOW - minAgo * 60000).toISOString(), sources: Array.from({ length: 15 }, (_, i) => ({ rec: i < withData ? {} : null })) });
const legacy = (minAgo) => ({ updated: new Date(NOW - minAgo * 60000).toISOString(), stories: [{ title: "T", link: "https://x.example/t", source: "S", pubDate: null }] });
const fetcher = (map, log = []) => async (url) => {
  log.push(url);
  const v = map[url];
  if (v instanceof Error) throw v;
  if (v === "hang") return new Promise(() => {});
  return v;
};
const S = "static";
const W = "worker";

test("fresh static file wins and the fallback is not called", async () => {
  const log = [];
  const r = await loadFeed([S, W], fetcher({ [S]: feed3(20), [W]: legacy(1) }, log), deps, NOW);
  assert.equal(r.url, S);
  assert.deepEqual(log, [S]);
});

test("static file missing: the Worker's legacy format is accepted as the fallback", async () => {
  const r = await loadFeed([S, W], fetcher({ [S]: new Error("HTTP 404"), [W]: legacy(10) }, []), deps, NOW);
  assert.equal(r.url, W);
  assert.equal(r.snapshot.legacy, true);
  assert.match(r.errors[0], /404/);
});

test("a hanging static request is bounded by the timeout, then the fallback is used", async () => {
  const started = Date.now();
  const r = await loadFeed([S, W], fetcher({ [S]: "hang", [W]: legacy(10) }), deps, NOW, { timeoutMs: 50 });
  assert.equal(r.url, W);
  assert.match(r.errors[0], /timed out/);
  assert.ok(Date.now() - started < 1500);
});

test("stale static file (collector stopped) and a fresher fallback: the fresher wins", async () => {
  assert.equal((await loadFeed([S, W], fetcher({ [S]: feed3(600), [W]: legacy(5) }), deps, NOW)).url, W);
});

test("both stale: the FRESHER is shown, whichever order they answer", async () => {
  assert.equal((await loadFeed([S, W], fetcher({ [S]: feed3(400), [W]: legacy(900) }), deps, NOW)).url, S);
  assert.equal((await loadFeed([S, W], fetcher({ [S]: feed3(900), [W]: legacy(400) }), deps, NOW)).url, W);
});

test("invalid copies are rejected: wrong shape, nearly empty, future-dated, no gathered time", async () => {
  const bad = [{ schema: 3 }, feed3(1, 3), feed3(-120), { schema: 3, g: "nonsense", sources: feed3(1).sources }, "not json"];
  for (const b of bad) assert.equal((await loadFeed([S, W], fetcher({ [S]: b, [W]: legacy(5) }), deps, NOW)).url, W);
});

test("both unavailable: throws, so the page keeps showing its saved copy", async () => {
  await assert.rejects(loadFeed([S, W], fetcher({ [S]: new Error("x"), [W]: "hang" }), deps, NOW, { timeoutMs: 50 }), /no valid feed/);
});

test("the gathered time is the collector's run time, not the newest article date", () => {
  const raw = {
    schema: 3,
    generatedAt: "2026-10-31T11:59:00Z",
    tick: { at: "2026-10-31T11:30:00Z", t: "2026-10-31T11:30:00Z" },
    sources: Array.from({ length: 10 }, (_, i) => ({ id: "s" + i, name: "S", kind: "news", scope: "texas", maxAgeDays: 7, cap: 5, refreshMinutes: 30, rec: { t: "2026-10-31T11:00:00Z", f: 0, e: null, h: "", items: [] } })),
  };
  const { snapshot } = normalizeFeed(raw, { build, adaptLegacy: logic.adaptLegacySnapshot }, NOW);
  assert.equal(snapshot.generatedAt, "2026-10-31T11:30:00.000Z");
});

test("fallback end to end: the legacy Worker's 2028 story never reaches the page", async () => {
  const bad = { updated: new Date(NOW - 5 * 60000).toISOString(), stories: [{ title: "Old release", link: "http://sos.example/2014", source: "SOS", pubDate: "2028-07-28T19:37:00.000Z" }, { title: "Real", link: "https://x.example/r", source: "S", pubDate: new Date(NOW - 3600000).toISOString() }] };
  const r = await loadFeed([S, W], fetcher({ [S]: new Error("HTTP 404"), [W]: bad }), deps, NOW);
  assert.deepEqual(r.snapshot.stories.map((s) => s.title), ["Real"]);
});

test("workflow disabled: the last static file keeps being used until it is 150 minutes old, then the fallback takes over", async () => {
  for (const [age, expected, workerCalls] of [[10, S, 0], [149, S, 0], [151, W, 1]]) {
    const log = [];
    const r = await loadFeed([S, W], fetcher({ [S]: feed3(age), [W]: legacy(1) }, log), deps, NOW);
    assert.equal(r.url, expected, `static file ${age} min old`);
    assert.equal(log.filter((u) => u === W).length, workerCalls);
  }
});

test("workflow disabled and the Worker retired: the stale static file is still shown (the page's own stale warning covers it)", async () => {
  const r = await loadFeed([S], fetcher({ [S]: feed3(60 * 24) }), deps, NOW);
  assert.equal(r.url, S);
});
