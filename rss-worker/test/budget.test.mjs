import assert from "node:assert/strict";
import { test } from "node:test";

import { applyOutcomes, buildSnapshot, emptyState, MAX_SOURCES_PER_RUN, pickDue } from "../lib/aggregate.js";
import { dedupe } from "../lib/dedupe.js";
import { parseDate } from "../lib/parse.js";
import { SOURCES } from "../lib/sources.js";

const NOW = Date.parse("2026-10-29T18:00:00Z");

test("a run fetches at most a few sources, never-fetched ones first", () => {
  const picked = pickDue(SOURCES, emptyState(), NOW);
  assert.equal(picked.length, MAX_SOURCES_PER_RUN);
  assert.ok(SOURCES.length > MAX_SOURCES_PER_RUN, "the cap actually matters");
});

test("over successive runs every source gets fetched, most overdue first", () => {
  let state = emptyState();
  const seen = new Set();
  let now = NOW;
  for (let run = 0; run < 12; run += 1) {
    const picked = pickDue(SOURCES, state, now);
    const outcomes = Object.fromEntries(picked.map((source) => [source.id, { ok: true, items: [] }]));
    picked.forEach((source) => seen.add(source.id));
    state = applyOutcomes(state, SOURCES, outcomes, now);
    now += 3 * 60_000;
  }
  assert.equal(seen.size, SOURCES.length);
});

test("nothing is picked while every source is fresh", () => {
  const outcomes = Object.fromEntries(SOURCES.map((source) => [source.id, { ok: true, items: [] }]));
  const state = applyOutcomes(emptyState(), SOURCES, outcomes, NOW);
  assert.deepEqual(pickDue(SOURCES, state, NOW + 60_000), []);
});

test("a feed that stamps current items with the year 2001 is treated as undated, not trusted", () => {
  assert.equal(parseDate("Tue, 27 Oct 2001 15:00:00 GMT", NOW), null);
  assert.equal(parseDate("Tue, 27 Oct 2026 15:00:00 GMT", NOW), "2026-10-27T15:00:00.000Z");
});

test("indexed duplicate detection still catches reworded headlines and keeps distinct ones", () => {
  const make = (publisher, title, link) => ({ publisher, title, link });
  const out = dedupe([
    make("KCEN", "Copperas Cove ISD to resume paid meals at two campuses due to change in federal law", "https://a/1"),
    make("Leader Press", "Copperas Cove ISD resumes paid meals at two campuses due to federal law change", "https://b/2"),
    make("KWTX", "Missing Copperas Cove teen found", "https://c/3"),
    make("KDH", "Amber Alert issued for missing 15-year-old girl from Copperas Cove", "https://d/4"),
  ]);
  assert.equal(out.length, 3);
  assert.deepEqual(out[0].alsoReportedBy, ["Leader Press"]);
});

test("classification is stored with each item so later runs do no regex work on old items", () => {
  const source = SOURCES.find((entry) => entry.id === "cove-city");
  const state = applyOutcomes(
    emptyState(),
    [source],
    { "cove-city": { ok: true, items: [{ title: "Trick or Treating hours", link: "https://x/1", pubDate: "2026-10-28T12:00:00.000Z" }] } },
    NOW,
  );
  const stored = state.sources["cove-city"].items[0];
  assert.equal(stored.location, "copperas-cove");
  assert.ok(Array.isArray(stored.categories));
  const snapshot = buildSnapshot(state, [source], NOW);
  assert.equal(snapshot.stories[0].location, "copperas-cove");
});
