import assert from "node:assert/strict";
import { test } from "node:test";

import { expectedMaxAgeMs, overdueAfterMs, schedulerHealth, sourceHealth, TICK_LATE_MS, TICK_MISSING_MS } from "../lib/health.js";
import { HEARTBEAT_MS, ingest } from "../lib/ingest.js";
import { SOURCES } from "../lib/sources.js";

const MIN = 60_000;
const NOW = Date.parse("2026-10-30T18:00:00Z");
const ago = (minutes) => new Date(NOW - minutes * MIN).toISOString();
const source = (extra = {}) => ({ id: "s", name: "S", kind: "news", refreshMinutes: 30, maxAgeDays: 7, ...extra });
const rec = (extra = {}) => ({ t: ago(10), f: 0, e: null, h: "x", items: [{ title: "a", link: "https://x/a", pubDate: ago(60) }], ...extra });

globalThis.caches = { default: { async match() {}, async put() {} } };
const { default: worker, runTick } = await import("../worker.js");

function fakeKv() {
  const data = new Map();
  return {
    data,
    writes: 0,
    writesByKey: {},
    async get(k) {
      return data.has(k) ? data.get(k) : null;
    },
    async put(k, v) {
      this.writes += 1;
      this.writesByKey[k] = (this.writesByKey[k] || 0) + 1;
      data.set(k, v);
    },
  };
}

test("thresholds follow each source's own polling interval and the hourly confirmation write", () => {
  assert.equal(expectedMaxAgeMs(30), HEARTBEAT_MS + 30 * MIN, "short interval: re-saved at the first fetch after the heartbeat");
  assert.equal(expectedMaxAgeMs(60), HEARTBEAT_MS + 60 * MIN);
  assert.equal(expectedMaxAgeMs(120), 120 * MIN, "long interval: re-saved on every fetch");
  assert.equal(expectedMaxAgeMs(240), 240 * MIN);
  for (const m of [20, 30, 60, 120, 240]) {
    assert.ok(overdueAfterMs(m) > expectedMaxAgeMs(m), "a whole missed fetch is needed before 'overdue'");
  }
});

test("an unchanged source at its real cadence is never reported overdue or failing, for two days", () => {
  for (const s of SOURCES) {
    const interval = s.refreshMinutes * MIN;
    let saved = null;
    const t0 = NOW;
    const items = [{ title: "Steady story", link: "https://x/steady", pubDate: new Date(t0 - 2 * 3600_000).toISOString(), publisher: "P" }];
    for (let at = t0; at <= t0 + 48 * 3600_000; at += interval) {
      const result = ingest(saved, { ok: true, items }, { ...s, kind: "news", cap: 5, maxAgeDays: 30 }, at);
      if (result.write) saved = result.text;
      for (let probe = at; probe < at + interval; probe += 5 * MIN) {
        const h = sourceHealth(s, JSON.parse(saved), probe);
        assert.equal(h.fetch, "ok", `${s.id} at +${Math.round((probe - t0) / MIN)} min`);
      }
    }
  }
});

test("a source that skips fetches becomes overdue, and a failing one is failing, not quiet", () => {
  const s = source({ refreshMinutes: 30 });
  assert.equal(sourceHealth(s, rec({ t: ago(100) }), NOW).fetch, "ok");
  assert.equal(sourceHealth(s, rec({ t: ago(overdueAfterMs(30) / MIN + 1) }), NOW).fetch, "overdue");
  assert.equal(sourceHealth(s, rec({ f: 1, e: "HTTP 520" }), NOW).fetch, "retrying");
  assert.equal(sourceHealth(s, rec({ f: 3, e: "timeout" }), NOW).fetch, "failing");
  assert.equal(sourceHealth(s, null, NOW).fetch, "pending");
});

test("a healthy source with no news is quiet, never failing (agencies that rarely post)", () => {
  const s = source({ refreshMinutes: 60, maxAgeDays: 7 });
  const quiet = sourceHealth(s, rec({ items: [] }), NOW);
  assert.equal(quiet.fetch, "ok");
  assert.equal(quiet.content, "quiet");
  const oldOnly = sourceHealth(s, rec({ items: [{ title: "old", link: "https://x/o", pubDate: ago(60 * 24 * 30) }] }), NOW);
  assert.equal(oldOnly.fetch, "ok");
  assert.equal(oldOnly.content, "quiet");
  assert.equal(sourceHealth(s, rec({ f: 3, items: [] }), NOW).content, "none", "a failing source is not called quiet");
});

test("scheduler health: ok, late and missing from the hourly marker; unknown before the first one", () => {
  assert.equal(schedulerHealth({ t: ago(50), at: ago(50), run: "completed" }, NOW).status, "ok");
  assert.equal(schedulerHealth({ t: ago(TICK_LATE_MS / MIN + 1) }, NOW).status, "late");
  assert.equal(schedulerHealth({ t: ago(TICK_MISSING_MS / MIN + 1) }, NOW).status, "missing");
  assert.equal(schedulerHealth(null, NOW).status, "unknown");
  assert.match(schedulerHealth({ t: ago(5) }, NOW).note, /does not show that every source was fetched/);
});

test("scheduled time and actual execution time are kept apart: a late run is 'delayed', a missing one is not", () => {
  // Scheduled 55 min ago but only ran 30 min ago (25 min late): the scheduler is alive, and the age counts from when it ran.
  const delayed = schedulerHealth({ t: ago(55), at: ago(30), run: "completed" }, NOW);
  assert.equal(delayed.status, "delayed");
  assert.equal(delayed.executionDelayMinutes, 25);
  assert.equal(delayed.ageMinutes, 30);
  assert.equal(delayed.lastScheduled, ago(55));
  assert.equal(delayed.lastExecuted, ago(30));
  // A small delay is normal.
  assert.equal(schedulerHealth({ t: ago(35), at: ago(30), run: "completed" }, NOW).status, "ok");
  // Scheduled long ago and never ran until recently is still judged by when it actually ran...
  assert.equal(schedulerHealth({ t: ago(400), at: ago(20), run: "completed" }, NOW).status, "delayed");
  // ...and a marker whose execution is old is late/missing regardless of how on-time it was.
  assert.equal(schedulerHealth({ t: ago(200), at: ago(199), run: "completed" }, NOW).status, "missing");
});

test("a marker recording an error never looks fully healthy, and says nothing about other sources", () => {
  const h = schedulerHealth({ t: ago(10), at: ago(10), run: "error", src: "cove-city", result: "error", error: "boom" }, NOW);
  assert.equal(h.status, "degraded");
  assert.equal(h.lastTickSource, "cove-city");
  assert.equal(h.lastError, "boom");
  // A completed run whose single source failed is a source problem, not a scheduler problem.
  const sourceFailed = schedulerHealth({ t: ago(10), at: ago(10), run: "completed", src: "cove-city", result: "stale" }, NOW);
  assert.equal(sourceFailed.status, "ok");
  assert.equal(sourceFailed.lastTickResult, "stale");
  // Error beyond the late threshold is reported as late/missing, the worse state.
  assert.equal(schedulerHealth({ t: ago(200), at: ago(200), run: "error" }, NOW).status, "missing");
});

test("the hourly marker costs 24 writes a day, only on the hour, and never claims other sources succeeded", async () => {
  const kv = fakeKv();
  const env = { NEWS_KV: kv };
  const day = Date.parse("2026-10-30T00:00:00Z");
  for (let tick = 0; tick < 720; tick += 1) await runTick(env, null, day + tick * 2 * MIN);
  assert.equal(kv.writesByKey["meta:lastTick"], 24);
  const marker = JSON.parse(kv.data.get("meta:lastTick"));
  assert.deepEqual(Object.keys(marker).sort(), ["at", "result", "run", "src", "t"], "scheduled, actual, run outcome, this tick's source and result");
  assert.equal(marker.result, "idle");
  assert.equal(marker.run, "completed");
  assert.equal(kv.writes, 24, "idle ticks that are not on the hour write nothing");
});

test("a tick whose source throws is recorded as an error and the marker is still written", async () => {
  const kv = fakeKv();
  kv.data.set("src:cove-city", "{not json");
  const onTheHour = Math.ceil(Date.parse("2026-10-30T00:30:00Z") / (60 * MIN)) * 60 * MIN;
  await runTick({ NEWS_KV: kv }, "cove-city", onTheHour);
  const marker = JSON.parse(kv.data.get("meta:lastTick"));
  assert.equal(marker.run, "error");
  assert.equal(marker.result, "error");
  assert.ok(marker.error);
  assert.equal(schedulerHealth(marker, Date.parse(marker.at) + 5 * MIN).status, "degraded");
});

test("HEARTBEAT=0 turns the marker off (used while other costs are measured)", async () => {
  const kv = fakeKv();
  await runTick({ NEWS_KV: kv, HEARTBEAT: "0" }, null, Date.parse("2026-10-30T01:00:00Z"));
  assert.equal(kv.writes, 0);
});

test("overnight outage: the cron stops, visitors still get the last stories with true dates, and it recovers by itself", async () => {
  const kv = fakeKv();
  const env = { NEWS_KV: kv };
  const ctx = { waitUntil: (p) => p };
  const request = (path) => new Request(`https://worker.example${path}`, { headers: { Origin: "https://coryellcountyscoop.vercel.app" } });

  const savedAt = new Date(Date.now() - 9 * 3600_000).toISOString();
  const story = {
    title: "Council approves budget",
    link: "https://x/budget",
    publisher: "City",
    pubDate: new Date(Date.now() - 10 * 3600_000).toISOString(),
    location: "copperas-cove",
    locations: ["copperas-cove"],
    locationBasis: "source",
    categories: ["government"],
    summary: "",
  };
  kv.data.set("src:cove-city", JSON.stringify({ t: savedAt, f: 0, e: null, h: "h", items: [story] }));
  kv.data.set("meta:lastTick", JSON.stringify({ t: savedAt, src: null, status: "idle" }));

  const health = await (await worker.fetch(request("/health"), env, ctx)).json();
  assert.equal(health.scheduler.status, "missing");
  assert.ok(health.scheduler.ageMinutes >= 540);

  const feed = await (await worker.fetch(request("/"), env, ctx)).json();
  const served = feed.sources.find((s) => s.id === "cove-city").rec.items[0];
  assert.equal(served.title, "Council approves budget");
  assert.equal(served.pubDate, story.pubDate, "original publication date, not a fetch time");
  assert.equal(feed.tick.t, savedAt, "the page can see the last run was 9 hours ago");

  const real = globalThis.fetch;
  globalThis.fetch = async () =>
    new Response(`<rss><channel><item><title>Copperas Cove adopts new rules</title><link>https://x/new</link><pubDate>${new Date().toUTCString()}</pubDate></item></channel></rss>`);
  try {
    const onTheHour = Math.ceil(Date.now() / (60 * MIN)) * 60 * MIN;
    await runTick(env, "cove-city", onTheHour);
  } finally {
    globalThis.fetch = real;
  }
  assert.equal(JSON.parse(kv.data.get("meta:lastTick")).run, "completed");
  assert.equal(JSON.parse(kv.data.get("src:cove-city")).f, 0);
});

test("the marker records when the tick actually ran, separately from when it was scheduled", async () => {
  const kv = fakeKv();
  const scheduled = Date.parse("2026-10-30T05:00:00Z");
  await runTick({ NEWS_KV: kv }, null, scheduled, scheduled + 17 * MIN);
  const marker = JSON.parse(kv.data.get("meta:lastTick"));
  assert.equal(marker.t, "2026-10-30T05:00:00.000Z");
  assert.equal(marker.at, "2026-10-30T05:17:00.000Z");
  assert.equal(schedulerHealth(marker, scheduled + 20 * MIN).status, "delayed");
});
