import fs from "node:fs";
import { SOURCES } from "file:///C:/Users/insur/CORYELLCOUNTYSCOOP/rss-worker/lib/sources.js";
import { buildSchedule, sourceIdForTime } from "file:///C:/Users/insur/CORYELLCOUNTYSCOOP/rss-worker/lib/schedule.js";
const fast = buildSchedule(SOURCES.map((s) => ({ ...s, refreshMinutes: 30 })));
const real = buildSchedule(SOURCES);
const t = fs.readFileSync(process.argv[2], "utf8");
const objs = []; let d = 0, st = -1, q = false, e = false;
for (let i = 0; i < t.length; i++) { const c = t[i]; if (q) { if (e) e = false; else if (c === "\\") e = true; else if (c === '"') q = false; continue; } if (c === '"') q = true; else if (c === "{") { if (d++ === 0) st = i; } else if (c === "}") { if (--d === 0) try { objs.push(JSON.parse(t.slice(st, i + 1))); } catch {} } }
const ev = objs.filter((o) => o.event && o.event.cron).map((o) => ({ t: o.event.scheduledTime, o })).sort((a, b) => a.t - b.t);
let prev = null, missing = [];
for (const { t, o } of ev) { if (prev && t - prev > 120000) for (let m = prev + 120000; m < t; m += 120000) missing.push(m); prev = t; }
console.log("ticks seen", ev.length, "| missing ticks:", missing.map((m) => new Date(m).toISOString().slice(11, 19) + " expected=" + sourceIdForTime(fast, m)));
let mism = 0; for (const { t, o } of ev) { let got = null; for (const l of o.logs || []) { try { got = JSON.parse(l.message[0]).src; } catch {} } if ((sourceIdForTime(fast, t) || null) !== (got || null)) { mism++; console.log("MISMATCH", new Date(t).toISOString().slice(11, 19), sourceIdForTime(fast, t), got); } }
console.log("fast-schedule mismatches", mism, "| fast busy slots", fast.filter(Boolean).length, "/120");
const ex = ev.flatMap(({ o }) => (o.exceptions || []).map((x) => x.name + ": " + x.message));
console.log("exceptions", ex);
console.log("outcomes", [...new Set(ev.map(({ o }) => o.outcome))]);
