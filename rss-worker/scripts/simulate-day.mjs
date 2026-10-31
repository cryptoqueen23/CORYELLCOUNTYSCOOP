// Estimates a day of cron runs and KV writes from the real source registry,
// refresh intervals and run budget. Story arrival is an assumption (printed below).
// Usage: node scripts/simulate-day.mjs [newStoriesPerDay=80]
import { applyOutcomes, emptyState, pickDue, RUN_BUDGET } from "../lib/aggregate.js";
import { SOURCES } from "../lib/sources.js";

const newStoriesPerDay = Number(process.argv[2] || 80);
const CRON_MIN = 2;
const HEARTBEAT_MIN = 20;
let state = emptyState();
let now = Date.parse("2026-11-01T00:00:00Z");
const end = now + 24 * 3_600_000;
let runs = 0, workRuns = 0, fetches = 0, stateWrites = 0, snapshotWrites = 0, lastSnapshot = -Infinity;
const maxCost = { value: 0 };
const changeChance = newStoriesPerDay / (24 * 60 / CRON_MIN) / 2; // per work run, rough

// Warm-up: the first cycle after deploy publishes on every run (not counted in the steady-state day).
while (now < end) {
  runs += 1;
  const picked = pickDue(SOURCES, state, now);
  if (picked.length) {
    workRuns += 1;
    fetches += picked.length;
    maxCost.value = Math.max(maxCost.value, picked.reduce((s, x) => s + (x.cost || 1), 0));
    state = applyOutcomes(state, SOURCES, Object.fromEntries(picked.map((s) => [s.id, { ok: true, items: [] }])), now);
    stateWrites += 1;
    const changed = Math.random() < changeChance * picked.length;
    if (changed || now - lastSnapshot > HEARTBEAT_MIN * 60_000) {
      snapshotWrites += 1;
      lastSnapshot = now;
    }
  } else if (now - lastSnapshot > HEARTBEAT_MIN * 60_000) {
    // No source due, so no run output; the staleness check on a page view would refresh instead.
  }
  now += CRON_MIN * 60_000;
}
console.log(JSON.stringify({ runBudget: RUN_BUDGET, cronEveryMin: CRON_MIN, cronRunsPerDay: runs, runsWithWork: workRuns, sourceFetchesPerDay: fetches, avgSourcesPerWorkRun: +(fetches / workRuns).toFixed(2), maxCostInOneRun: maxCost.value, kvWritesState: stateWrites, kvWritesSnapshot: snapshotWrites, kvWritesTotal: stateWrites + snapshotWrites, freeLimit: 1000, assumedNewStoriesPerDay: newStoriesPerDay }, null, 2));
