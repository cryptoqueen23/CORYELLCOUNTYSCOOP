import assert from "node:assert/strict";
import { test } from "node:test";

import { PATIENCE, applyOutcomes, emptyState, pickDue } from "../lib/aggregate.js";
import { SOURCES } from "../lib/sources.js";

const NOW = Date.parse("2026-10-29T18:00:00Z");
const MIN = 60_000;

// Every source fetched `minutesAgo` minutes ago, except those overridden.
function stateWith(minutesAgo, overrides = {}) {
  const outcomes = Object.fromEntries(SOURCES.map((source) => [source.id, { ok: true, items: [] }]));
  let state = emptyState();
  for (const source of SOURCES) {
    const ago = overrides[source.id] ?? minutesAgo;
    state = applyOutcomes(state, [source], { [source.id]: outcomes[source.id] }, NOW - ago * MIN);
  }
  return state;
}

test("a single source that has just come due waits so it can be batched", () => {
  const gnCove = SOURCES.find((s) => s.id === "gn-copperas-cove"); // 20 min interval
  const state = stateWith(1, { [gnCove.id]: gnCove.refreshMinutes + 1 }); // 1 minute overdue
  assert.deepEqual(pickDue(SOURCES, state, NOW), []);
});

test("it is fetched once it has waited the extra quarter of its interval", () => {
  const gnCove = SOURCES.find((s) => s.id === "gn-copperas-cove");
  const state = stateWith(1, { [gnCove.id]: Math.ceil(gnCove.refreshMinutes * PATIENCE) + 1 });
  assert.deepEqual(pickDue(SOURCES, state, NOW).map((s) => s.id), [gnCove.id]);
});

test("enough due work triggers a run immediately, without waiting", () => {
  // Five cost-1 sources just due: fills the budget.
  const light = SOURCES.filter((s) => (s.cost || 1) === 1).slice(0, 6);
  const overrides = Object.fromEntries(light.map((s) => [s.id, s.refreshMinutes + 1]));
  const picked = pickDue(SOURCES, stateWith(0, overrides), NOW);
  assert.ok(picked.length >= 3);
  assert.ok(picked.every((s) => light.some((l) => l.id === s.id)));
});

test("the longest extra wait is a quarter of a source's own interval", () => {
  for (const source of SOURCES) {
    const extra = source.refreshMinutes * (PATIENCE - 1);
    assert.ok(extra <= 30, `${source.id} waits at most ${extra} extra minutes`);
  }
  const local = SOURCES.filter((s) => s.id.startsWith("gn-") || s.id === "kwtx" || s.id === "kcen");
  assert.ok(local.every((s) => s.refreshMinutes * (PATIENCE - 1) <= 7.5), "local news stays within about 7 extra minutes");
});
