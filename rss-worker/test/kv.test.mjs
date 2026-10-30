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
