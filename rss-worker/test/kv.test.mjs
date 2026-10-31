import assert from "node:assert/strict";
import { test } from "node:test";

import { buildSchedule, sourceIdForTime, CYCLE_SLOTS } from "../lib/schedule.js";
import { SOURCES } from "../lib/sources.js";

function fakeKv() {
  const data = new Map();
  return {
    reads: 0,
    writes: 0,
    async get(key) {
      this.reads += 1;
      return data.has(key) ? data.get(key) : null;
    },
    async put(key, value) {
      this.writes += 1;
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
globalThis.fetch = async () => new Response(rssFor());

const { refreshSource } = await import("../worker.js");
const rssSource = SOURCES.find((s) => s.type === "rss" || (!s.type && s.url));

test("the fixed schedule gives every source its slots and never two sources one tick", () => {
  const schedule = buildSchedule(SOURCES);
  assert.equal(schedule.length, CYCLE_SLOTS);
  for (const source of SOURCES) {
    const slots = schedule.filter((id) => id === source.id).length;
    assert.equal(slots, (CYCLE_SLOTS * 2) / source.refreshMinutes, `${source.id} runs on its interval`);
  }
});

test("the schedule is decided by the clock alone, so a tick reads no saved state", () => {
  const schedule = buildSchedule(SOURCES);
  const base = Date.UTC(2026, 9, 30, 12, 0, 0);
  const seen = new Set();
  for (let i = 0; i < CYCLE_SLOTS; i += 1) seen.add(sourceIdForTime(schedule, base + i * 120_000));
  seen.delete(null);
  assert.equal(seen.size, SOURCES.length, "every source comes up within one 4-hour cycle");
});

test("unchanged content costs one read and no write within the hour; changed content writes", async () => {
  const kv = fakeKv();
  const env = { NEWS_KV: kv };
  const t = Date.now();

  let result = await refreshSource(env, rssSource, t);
  assert.equal(result.write, true, "first fetch is saved");

  result = await refreshSource(env, rssSource, t + 120_000);
  assert.equal(result.write, false, "nothing changed, nothing written");
  assert.equal(kv.writes, 1);

  feedItems = [...feedItems, { title: "Gatesville ISD names new superintendent", link: "https://www.copperascovetx.gov/b" }];
  result = await refreshSource(env, rssSource, t + 240_000);
  assert.equal(result.write, true, "a new story is saved at once");
  assert.equal(kv.writes, 2);
});

test("a failed fetch keeps the last good items and is recorded", async () => {
  const kv = fakeKv();
  const env = { NEWS_KV: kv };
  const t = Date.now();
  await refreshSource(env, rssSource, t);
  const good = globalThis.fetch;
  globalThis.fetch = async () => new Response("nope", { status: 500 });
  try {
    const result = await refreshSource(env, rssSource, t + 3_600_000 * 2);
    assert.equal(result.status, "stale");
    const saved = JSON.parse(await kv.get(`src:${rssSource.id}`));
    assert.equal(saved.f, 1);
    assert.ok(saved.items.length > 0, "last good items survive");
    assert.ok(saved.t, "last confirmed time is kept");
  } finally {
    globalThis.fetch = good;
  }
});

// ---- conditional requests (CONDITIONAL_FETCH) ----

test("with CONDITIONAL_FETCH on, a 304 skips parsing, writes nothing, and keeps the saved stories", async () => {
  const kv = fakeKv();
  const env = { NEWS_KV: kv, CONDITIONAL_FETCH: "1" };
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push(init.headers);
    if (init.headers["If-None-Match"] === '"v1"') return new Response(null, { status: 304 });
    return new Response(rssFor(), { headers: { ETag: '"v1"', "Last-Modified": "Fri, 30 Oct 2026 12:00:00 GMT" } });
  };
  try {
    const t = Date.now();
    await refreshSource(env, rssSource, t);
    const saved = JSON.parse(await kv.get(`src:${rssSource.id}`));
    assert.equal(saved.et, '"v1"');
    assert.equal(saved.lm, "Fri, 30 Oct 2026 12:00:00 GMT");

    const result = await refreshSource(env, rssSource, t + 120_000);
    assert.equal(seen.at(-1)["If-None-Match"], '"v1"');
    assert.equal(seen.at(-1)["If-Modified-Since"], "Fri, 30 Oct 2026 12:00:00 GMT");
    assert.equal(result.write, false, "not modified, nothing written");
    assert.equal(result.notModified, true);
    assert.equal(kv.writes, 1);

    // The hourly confirmation still happens, with the saved stories and validators intact.
    const hourly = await refreshSource(env, rssSource, t + 3_700_000);
    assert.equal(hourly.write, true);
    const after = JSON.parse(await kv.get(`src:${rssSource.id}`));
    assert.equal(after.items.length, saved.items.length);
    assert.equal(after.et, '"v1"');
    assert.ok(Date.parse(after.t) > Date.parse(saved.t));
  } finally {
    globalThis.fetch = real;
  }
});

test("without CONDITIONAL_FETCH no validators are sent, and a source without ETag still works", async () => {
  const kv = fakeKv();
  const seen = [];
  const real = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push(init.headers);
    return new Response(rssFor());
  };
  try {
    const t = Date.now();
    await refreshSource({ NEWS_KV: kv }, rssSource, t);
    await refreshSource({ NEWS_KV: kv }, rssSource, t + 120_000);
    assert.ok(seen.every((h) => !h["If-None-Match"] && !h["If-Modified-Since"]));
    seen.length = 0;
    await refreshSource({ NEWS_KV: kv, CONDITIONAL_FETCH: "1" }, rssSource, t + 240_000);
    assert.ok(seen.every((h) => !h["If-None-Match"]), "no saved ETag, so nothing to send");
  } finally {
    globalThis.fetch = real;
  }
});

test("a 304 after a failure counts as a recovery and clears the failure", async () => {
  const kv = fakeKv();
  const env = { NEWS_KV: kv, CONDITIONAL_FETCH: "1" };
  const real = globalThis.fetch;
  try {
    const t = Date.now();
    globalThis.fetch = async () => new Response(rssFor(), { headers: { ETag: '"v1"' } });
    await refreshSource(env, rssSource, t);
    globalThis.fetch = async () => new Response("x", { status: 500 });
    await refreshSource(env, rssSource, t + 3_000_000);
    assert.equal(JSON.parse(await kv.get(`src:${rssSource.id}`)).f, 1);
  } finally {
    globalThis.fetch = real;
  }
});

test("saved validators round-trip, including quotes, without parsing the record", async () => {
  const { savedValidators } = await import("../lib/ingest.js");
  const text = `{"t":"x","f":0,"e":null,"h":"a","et":"W/\\"abc\\"","lm":"Fri, 30 Oct 2026 12:00:00 GMT","items":[{"title":"\\"et\\":\\"fake\\""}]}`;
  assert.deepEqual(savedValidators(text), { et: 'W/"abc"', lm: "Fri, 30 Oct 2026 12:00:00 GMT" });
  assert.equal(savedValidators(null), null);
  assert.equal(savedValidators('{"t":"x","f":0,"e":null,"h":"a","et":"","lm":"","items":[]}'), null);
});

test("a failed fetch records who answered and a short, number-free snippet, so the same failure reads the same each time", async () => {
  const { describeFailure } = await import("../lib/fetchers.js");
  const a = await describeFailure(new Response("<html><body>Web server returned an unknown error 2026-10-30 18:01</body></html>", { status: 520, headers: { server: "cloudflare" } }));
  const b = await describeFailure(new Response("<html><body>Web server returned an unknown error 2026-10-30 19:44</body></html>", { status: 520, headers: { server: "cloudflare" } }));
  assert.equal(a, b);
  assert.match(a, /^HTTP 520 \[cloudflare\] Web server returned an unknown error/);
  assert.equal(await describeFailure(new Response("", { status: 503 })), "HTTP 503");
});
