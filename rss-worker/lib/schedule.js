// Fixed fetch schedule: one source per 2-minute cron tick, decided by the clock
// alone. No saved state has to be read to find out what to fetch, which is what
// keeps an ordinary run cheap. The pattern repeats every 4 hours (120 ticks).

export const TICK_MINUTES = 2;
export const CYCLE_SLOTS = 120;

// Returns an array of CYCLE_SLOTS entries: a source id, or null for an idle tick.
// A source with refreshMinutes M occupies every (M / 2)th slot; sources are placed
// most-frequent first at the first offset where all of their slots are free.
export function buildSchedule(sources) {
  const slots = new Array(CYCLE_SLOTS).fill(null);
  const order = [...sources].sort((a, b) => a.refreshMinutes - b.refreshMinutes || a.id.localeCompare(b.id));

  for (const source of order) {
    const period = source.refreshMinutes / TICK_MINUTES;
    if (!Number.isInteger(period) || CYCLE_SLOTS % period !== 0) {
      throw new Error(`${source.id}: refreshMinutes ${source.refreshMinutes} must be an even divisor of ${CYCLE_SLOTS * TICK_MINUTES}`);
    }

    let placed = false;
    for (let offset = 0; offset < period && !placed; offset += 1) {
      let free = true;
      for (let slot = offset; slot < CYCLE_SLOTS; slot += period) {
        if (slots[slot]) {
          free = false;
          break;
        }
      }
      if (free) {
        for (let slot = offset; slot < CYCLE_SLOTS; slot += period) slots[slot] = source.id;
        placed = true;
      }
    }
    if (!placed) throw new Error(`no free slots for ${source.id}; lengthen some refresh intervals`);
  }
  return slots;
}

export function sourceIdForTime(schedule, timeMs) {
  const tick = Math.floor(timeMs / (TICK_MINUTES * 60_000));
  return schedule[tick % CYCLE_SLOTS];
}
