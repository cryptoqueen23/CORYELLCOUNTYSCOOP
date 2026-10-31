// usage: node variant.cjs <label> <file1,file2,...> [--json out.json]
// Classifies every fetching run, then reports CPU by response class and by source, with sample sizes.
const fs = require("fs");
const [label, files] = [process.argv[2], process.argv[3]];
const text = files.split(",").map((f) => fs.readFileSync(f, "utf8")).join(" ");
const objs = [];
let d = 0, st = -1, q = false, e = false;
for (let i = 0; i < text.length; i++) {
  const c = text[i];
  if (q) { if (e) e = false; else if (c === "\\") e = true; else if (c === '"') q = false; continue; }
  if (c === '"') q = true;
  else if (c === "{") { if (d++ === 0) st = i; }
  else if (c === "}") { if (--d === 0) try { objs.push(JSON.parse(text.slice(st, i + 1))); } catch {} }
}
const seen = new Set();
const ticks = objs.filter((o) => o.event && o.event.cron).filter((o) => !seen.has(o.event.scheduledTime) && seen.add(o.event.scheduledTime)).sort((a, b) => a.event.scheduledTime - b.event.scheduledTime);
const firstOf = new Set();
const runs = [];
for (const o of ticks) {
  let log = null;
  for (const l of o.logs || []) { try { const j = JSON.parse(l.message[0]); if (j.src) log = j; } catch {} }
  if (!log) continue;
  let cls;
  if (log.status !== "ok") cls = "failed";
  else if (!firstOf.has(log.src)) cls = "first-save";
  else if (log.notModified) cls = "http-304";
  else if (log.wrote) cls = "changed-save";
  else cls = "unchanged-200";
  if (log.status === "ok" || !firstOf.has(log.src)) firstOf.add(log.src);
  runs.push({ src: log.src, cpu: o.cpuTime, wall: o.wallTime, cls, err: log.error, t: o.event.scheduledTime, wrote: !!log.wrote });
}
const pct = (a, p) => { if (!a.length) return "-"; a = [...a].sort((x, y) => x - y); return a[Math.min(a.length - 1, Math.ceil(p * a.length) - 1)]; };
const stat = (a) => (a.length ? `n=${String(a.length).padStart(2)} median ${String(pct(a, .5)).padStart(2)} p95 ${String(pct(a, .95)).padStart(2)} max ${String(Math.max(...a)).padStart(2)} >=10: ${a.filter((x) => x >= 10).length}` : "n= 0");
console.log(`=== ${label}: ${runs.length} fetching runs, ${ticks.length} scheduled ticks seen, ${ticks.reduce((s, o) => s + (o.exceptions || []).length, 0)} exceptions, non-ok ${ticks.filter((o) => o.outcome !== "ok").length}`);
console.log("ALL          ", stat(runs.map((r) => r.cpu)));
for (const cls of ["first-save", "changed-save", "unchanged-200", "http-304", "failed"]) console.log(cls.padEnd(13), stat(runs.filter((r) => r.cls === cls).map((r) => r.cpu)));
console.log("KV writes", runs.filter((r) => r.wrote).length, "of", runs.length, "runs; reads", runs.length);
console.log("\nby source (cpu ms per run, class initial: F first-save, C changed, U unchanged-200, 3 http-304, X failed):");
const by = {};
for (const r of runs) (by[r.src] = by[r.src] || []).push(r);
const code = { "first-save": "F", "changed-save": "C", "unchanged-200": "U", "http-304": "3", failed: "X" };
for (const [src, rs] of Object.entries(by).sort()) console.log(" ", src.padEnd(22), `n=${rs.length}`.padEnd(5), rs.map((r) => `${r.cpu}${code[r.cls]}`).join(" "), "| max", Math.max(...rs.map((r) => r.cpu)));
const errs = runs.filter((r) => r.cls === "failed").map((r) => `${r.src}: ${r.err}`);
if (errs.length) console.log("\nfailures:", errs.join(" | "));
const i = process.argv.indexOf("--json");
if (i > 0) fs.writeFileSync(process.argv[i + 1], JSON.stringify(runs));
