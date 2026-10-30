const assert = require("node:assert/strict");
const { test } = require("node:test");
const { build } = require("../feed-build.js");

const NOW = Date.parse("2026-10-30T18:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();

const source = (id, extra) => Object.assign({ id, name: id, kind: "news", scope: "texas", maxAgeDays: 7, cap: 10, refreshMinutes: 30 }, extra);
const item = (title, extra) =>
  Object.assign(
    { title, link: "https://x.example/" + encodeURIComponent(title), publisher: "P", pubDate: hoursAgo(1), location: "texas", locations: ["texas"], locationBasis: "source", categories: ["general"], summary: "" },
    extra
  );
const rec = (items, f) => ({ t: hoursAgo(0.1), f: f || 0, e: null, h: "x", items: items });
const feed = (sources) => ({ schema: 3, generatedAt: new Date(NOW).toISOString(), sources: sources });

test("a story dated years in the future is dropped (a 2028 item once topped the page)", () => {
  const s = source("sos");
  const out = build(feed([Object.assign({}, s, { rec: rec([item("Bad date", { pubDate: "2028-07-28T19:37:00Z" })]) })]), NOW);
  assert.equal(out.stories.length, 0);
});

test("stories older than the source limit are dropped", () => {
  const s = source("sos", { maxAgeDays: 7 });
  const out = build(feed([Object.assign({}, s, { rec: rec([item("Old", { pubDate: hoursAgo(24 * 30) })]) })]), NOW);
  assert.equal(out.stories.length, 0);
});

test("a local story outranks a statewide story that is a little newer", () => {
  const local = Object.assign(source("cc", { scope: "local" }), {
    rec: rec([item("Cove council vote", { location: "copperas-cove", locations: ["copperas-cove"], pubDate: hoursAgo(10) })]),
  });
  const state = Object.assign(source("tx"), { rec: rec([item("Statewide news", { pubDate: hoursAgo(1) })]) });
  const out = build(feed([state, local]), NOW);
  assert.equal(out.stories[0].title, "Cove council vote");
});

test("duplicate headlines from two sources collapse and credit both publishers", () => {
  const a = Object.assign(source("a"), { rec: rec([item("Fire closes Highway 190 in Copperas Cove", { link: "https://a.example/1", publisher: "A" })]) });
  const b = Object.assign(source("b"), { rec: rec([item("Fire closes Highway 190 in Copperas Cove", { link: "https://b.example/1", publisher: "B" })]) });
  const out = build(feed([a, b]), NOW);
  assert.equal(out.stories.length, 1);
  assert.deepEqual(out.stories[0].alsoReportedBy.length, 1);
});

test("an undated item is labelled with first-seen time and expires after 3 days", () => {
  const s = source("u");
  const fresh = item("Fresh undated", { pubDate: null, fs: hoursAgo(5) });
  const stale = item("Stale undated", { pubDate: null, fs: hoursAgo(24 * 4) });
  const out = build(feed([Object.assign({}, s, { rec: rec([fresh, stale]) })]), NOW);
  assert.deepEqual(out.stories.map((x) => x.title), ["Fresh undated"]);
  assert.equal(out.stories[0].pubDate, null);
});

test("a failing source's stories are marked saved copies and health shows it", () => {
  const s = Object.assign(source("f"), { rec: rec([item("Kept")], 3) });
  const out = build(feed([s, Object.assign(source("n"), { rec: null })]), NOW);
  assert.equal(out.stories[0].stale, true);
  assert.deepEqual(out.health.map((h) => h.status), ["failing", "pending"]);
  assert.equal(out.sourcesOk, 0);
});

test("expired weather alerts disappear", () => {
  const s = source("nws");
  const out = build(feed([Object.assign({}, s, { rec: rec([item("Flood warning", { expires: hoursAgo(1) })]) })]), NOW);
  assert.equal(out.stories.length, 0);
});

test("'updated' is when the service last ran, not when the response was assembled (an outage must show)", () => {
  const s = Object.assign(source("a"), { rec: Object.assign(rec([item("Story")]), { t: hoursAgo(6) }) });
  const out = build(Object.assign(feed([s]), { tick: { t: hoursAgo(5), status: "ok" } }), NOW);
  assert.equal(out.generatedAt, hoursAgo(5), "scheduler marker wins");
  assert.equal(out.staleAfterMinutes, 150);
  const noTick = build(feed([s]), NOW);
  assert.equal(noTick.generatedAt, hoursAgo(6), "falls back to the newest source confirmation");
  assert.notEqual(noTick.generatedAt, feed([s]).generatedAt, "never the assembly time while a confirmation exists");
});

test("during an outage the last good stories keep their original dates and are not made to look new", () => {
  const s = Object.assign(source("a"), { rec: Object.assign(rec([item("Story", { pubDate: hoursAgo(30) })]), { t: hoursAgo(20) }) });
  const out = build(Object.assign(feed([s]), { tick: { t: hoursAgo(20), status: "ok" } }), NOW);
  assert.equal(out.stories[0].pubDate, hoursAgo(30));
  assert.equal(out.stories[0].title, "Story");
});
