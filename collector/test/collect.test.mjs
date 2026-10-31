import assert from "node:assert/strict";
import { test } from "node:test";
import { collect, isDue } from "../run.mjs";

const DAY = 86_400_000;
const mkSource = (id, extra = {}) => ({ id, name: id, kind: "news", scope: "texas", maxAgeDays: 30, cap: 10, refreshMinutes: 30, ...extra });
const SOURCES = [mkSource("a"), mkSource("b"), mkSource("c"), mkSource("sos", { kind: "official", refreshMinutes: 240 })];
const iso = (ms) => new Date(ms).toISOString();
const item = (title, pubDate) => ({ title, link: `https://x.example/${encodeURIComponent(title)}`, pubDate, publisher: "", summary: "" });

// fetchSource fake: a table of id -> outcome (or function), plus a call log.
function fake(table, calls = []) {
  return async (source) => {
    calls.push(source.id);
    const v = typeof table[source.id] === "function" ? table[source.id](calls.filter((c) => c === source.id).length) : table[source.id];
    return v || { ok: true, items: [] };
  };
}
const ok = (...items) => ({ ok: true, items });
const fail = (error) => ({ ok: false, error });
const run = (o) => collect({ sources: SOURCES, sleep: async () => {}, now: Date.now(), ...o });
const recOf = (text, id) => JSON.parse(text).sources.find((s) => s.id === id).rec;

test("first run publishes a schema 3 feed with every source's items and publisher dates", async () => {
  const now = Date.now();
  const pub = iso(now - 2 * DAY);
  const r = await run({ previous: null, now, fetchSource: fake({ a: ok(item("Story A", pub)), b: ok(item("Story B", pub)), c: ok(item("Story C", pub)), sos: ok(item("Story S", pub)) }) });
  assert.equal(r.publish, true);
  const feed = JSON.parse(r.text);
  assert.equal(feed.schema, 3);
  assert.equal(recOf(r.text, "a").items[0].pubDate, pub);
  assert.ok(feed.tick.at);
});

test("an immediate second run has nothing due and publishes nothing", async () => {
  const now = Date.now();
  const fetchSource = fake({ a: ok(item("A", iso(now - DAY))), b: ok(item("B", iso(now - DAY))), c: ok(item("C", iso(now - DAY))), sos: ok(item("S", iso(now - DAY))) });
  const first = await run({ previous: null, now, fetchSource });
  const calls = [];
  const second = await run({ previous: JSON.parse(first.text), now: now + 60_000, fetchSource: fake({}, calls) });
  assert.deepEqual(calls, []);
  assert.equal(second.publish, false);
});

test("a source is due again after its own refresh interval, not before", async () => {
  const rec = JSON.stringify({ t: iso(Date.now() - 10 * 60_000), f: 0, items: [] });
  assert.equal(isDue(mkSource("a"), rec, Date.now()), false);
  assert.equal(isDue(mkSource("a"), rec, Date.now() + 25 * 60_000), true);
  assert.equal(isDue(mkSource("a"), JSON.stringify({ t: iso(Date.now()), f: 2, items: [] }), Date.now()), true); // failing: every run
});

test("a failed fetch keeps the saved stories, their publication dates and the last good refresh time", async () => {
  const now = Date.now();
  const pub = iso(now - 3 * DAY);
  const first = await run({ previous: null, now, fetchSource: fake({ a: ok(item("Keep me", pub)), b: ok(item("B", pub)), c: ok(item("C", pub)), sos: ok(item("S", pub)) }) });
  const before = recOf(first.text, "a");
  const second = await run({ previous: JSON.parse(first.text), now: now + 2 * 3600_000, force: true, fetchSource: fake({ a: fail("HTTP 520 [nginx]"), b: ok(item("B", pub)), c: ok(item("C", pub)), sos: ok(item("S", pub)) }) });
  const after = recOf(second.text, "a");
  assert.equal(after.f, 1);
  assert.equal(after.e.startsWith("HTTP 520"), true);
  assert.deepEqual(after.items, before.items); // same stories, same dates
  assert.equal(after.t, before.t); // last SUCCESSFUL refresh is not moved by a failure
  assert.equal(after.items[0].pubDate, pub);
});

test("recovery: a later successful fetch clears the failure and updates the refresh time", async () => {
  const now = Date.now();
  const pub = iso(now - DAY);
  const all = (a) => fake({ a, b: ok(item("B", pub)), c: ok(item("C", pub)), sos: ok(item("S", pub)) });
  const first = await run({ previous: null, now, fetchSource: all(ok(item("A1", pub))) });
  const failed = await run({ previous: JSON.parse(first.text), now: now + 3600_000, force: true, fetchSource: all(fail("timeout")) });
  const healed = await run({ previous: JSON.parse(failed.text), now: now + 2 * 3600_000, fetchSource: all(ok(item("A1", pub), item("A2", pub))) });
  const rec = recOf(healed.text, "a");
  assert.equal(rec.f, 0);
  assert.equal(rec.e, null);
  assert.equal(rec.items.length, 2);
  assert.equal(rec.t, iso(now + 2 * 3600_000));
});

test("an HTTP 403 (like the Texas Secretary of State from GitHub) is not retried and does not block other sources", async () => {
  const now = Date.now();
  const calls = [];
  const r = await run({ previous: null, now, fetchSource: fake({ a: ok(item("A", iso(now))), b: ok(item("B", iso(now))), c: ok(item("C", iso(now))), sos: fail("HTTP 403 [AmazonS3]") }, calls) });
  assert.equal(calls.filter((c) => c === "sos").length, 1); // no pointless retry
  assert.equal(r.publish, true);
  assert.equal(r.outage, false);
  assert.equal(r.okCount, 3);
  assert.equal(recOf(r.text, "sos").f, 1);
  assert.equal(recOf(r.text, "a").items.length, 1);
});

test("a transient failure is retried once and can recover within the same run", async () => {
  const now = Date.now();
  const calls = [];
  const r = await run({ previous: null, now, fetchSource: fake({ a: (n) => (n === 1 ? fail("HTTP 503") : ok(item("A", iso(now)))), b: ok(item("B", iso(now))), c: ok(item("C", iso(now))), sos: ok(item("S", iso(now))) }, calls) });
  assert.equal(calls.filter((c) => c === "a").length, 2);
  assert.equal(recOf(r.text, "a").f, 0);
  assert.equal(recOf(r.text, "a").items.length, 1);
});

test("nothing reachable at all is an outage: nothing is published over the good file", async () => {
  const now = Date.now();
  const first = await run({ previous: null, now, fetchSource: fake({ a: ok(item("A", iso(now))), b: ok(item("B", iso(now))), c: ok(item("C", iso(now))), sos: ok(item("S", iso(now))) }) });
  const r = await run({ previous: JSON.parse(first.text), now: now + 3 * 3600_000, force: true, fetchSource: fake({ a: fail("timeout"), b: fail("timeout"), c: fail("timeout"), sos: fail("timeout") }) });
  assert.equal(r.outage, true);
  assert.equal(r.publish, false);
  assert.equal(r.text, null);
});

test("first run with every source failing publishes nothing", async () => {
  const r = await run({ previous: null, fetchSource: fake({ a: fail("HTTP 403"), b: fail("HTTP 403"), c: fail("HTTP 403"), sos: fail("HTTP 403") }) });
  assert.equal(r.publish, false);
});

test("the hourly collector-ran marker publishes even when no story changed; inside the hour it does not", async () => {
  const now = Date.now();
  const fs = fake({ a: ok(item("A", iso(now))), b: ok(item("B", iso(now))), c: ok(item("C", iso(now))), sos: ok(item("S", iso(now))) });
  const first = await run({ previous: null, now, fetchSource: fs });
  const prev = JSON.parse(first.text);
  prev.tick.at = iso(now - 30 * 60_000);
  assert.equal((await run({ previous: prev, now, fetchSource: fake({}) })).publish, false);
  prev.tick.at = iso(now - 61 * 60_000);
  assert.equal((await run({ previous: prev, now, fetchSource: fake({}) })).publish, true);
});

test("an undated item keeps pubDate null and the time it was first seen across reruns", async () => {
  const t1 = Date.now();
  const undated = { title: "No date", link: "https://x.example/nodate", pubDate: null, publisher: "", summary: "" };
  const first = await run({ previous: null, now: t1, fetchSource: fake({ a: ok(undated), b: ok(item("B", iso(t1))), c: ok(item("C", iso(t1))), sos: ok(item("S", iso(t1))) }) });
  const second = await run({ previous: JSON.parse(first.text), now: t1 + 6 * 3600_000, force: true, fetchSource: fake({ a: ok(undated), b: ok(item("B", iso(t1))), c: ok(item("C", iso(t1))), sos: ok(item("S", iso(t1))) }) });
  const a = recOf(second.text, "a").items[0];
  assert.equal(a.pubDate, null);
  assert.equal(a.fs, iso(t1)); // first seen, not rewritten and not presented as a publication date
});
