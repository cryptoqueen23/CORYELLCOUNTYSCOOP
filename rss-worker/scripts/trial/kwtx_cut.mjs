import { parseFeed } from "file:///C:/Users/insur/CORYELLCOUNTYSCOOP/rss-worker/lib/parse.js";
import { ingest, hashText, prepareItem } from "file:///C:/Users/insur/CORYELLCOUNTYSCOOP/rss-worker/lib/ingest.js";
import { SOURCES } from "file:///C:/Users/insur/CORYELLCOUNTYSCOOP/rss-worker/lib/sources.js";
const src = SOURCES.find((s) => s.id === "kwtx");
const r = await fetch(src.url, { headers: { "User-Agent": "Mozilla/5.0 (compatible; CoryellCountyMessengerBot/2.0)" } });
const full = await r.text();
const now = Date.now();
console.log("full feed chars", full.length, "items in full feed", (full.match(/<item[\s>]/g) || []).length);
const run = (xml, label) => {
  const items = parseFeed(xml, { maxItems: src.cap + 5, now, summaries: true });
  const res = ingest(null, { ok: true, items }, src, now);
  const rec = JSON.parse(res.text);
  return { label, parsed: items.length, kept: rec.items.length, rec };
};
const A = run(full.slice(0, 45000), "45000 (current)");
const B = run(full.slice(0, 30000), "30000");
const C = run(full, "full feed");
for (const x of [A, B, C]) console.log(x.label.padEnd(16), "parsed", x.parsed, "kept after filters", x.kept, "record hash", x.rec.h);
// partial items?
const cutTail = full.slice(0, 30000); const opens = (cutTail.match(/<item[\s>]/g) || []).length, closes = (cutTail.match(/<\/item>/g) || []).length;
console.log("30000 cut: <item> opens", opens, "closes", closes, "=> partial item at tail:", opens > closes, "(parser requires </item>, so a partial item is never emitted)");
// item-level equality: first K items of cut vs the same items in full
const kB = B.rec.items, kC = C.rec.items;
let same = 0; const mism = [];
kB.forEach((it, i) => { const o = kC.find((x) => x.link === it.link); if (o && JSON.stringify(o) === JSON.stringify(it)) same++; else mism.push(it.link); });
console.log("30000 items identical (id/link, pubDate, location, categories, summary) to the same item in the full feed:", same, "of", kB.length, mism.length ? "MISMATCH " + mism : "");
// ordering and top-of-feed identical to what 45000 gives
const linksA = A.rec.items.map((x) => x.link), linksB = B.rec.items.map((x) => x.link);
console.log("45000 items", linksA.length, "30000 items", linksB.length, "30000 is a prefix of 45000:", linksB.every((l, i) => l === linksA[i]));
console.log("items lost by 30000 vs 45000 (these are the OLDEST):");
A.rec.items.slice(linksB.length).forEach((x) => console.log("   ", x.pubDate, x.location, x.title.slice(0, 60)));
const localA = A.rec.items.filter((x) => x.location !== "texas").length, localB = B.rec.items.filter((x) => x.location !== "texas").length;
console.log("local-or-regional items in 45000:", localA, "in 30000:", localB);
// KV write behavior: unchanged re-fetch against saved record
const again = ingest(B.rec ? JSON.stringify(B.rec) : null, { ok: true, items: parseFeed(full.slice(0, 30000), { maxItems: src.cap + 5, now: now + 120000, summaries: true }) }, src, now + 120000);
console.log("re-fetch 2 min later with same content -> write?", again.write);
// the key stability concern: does the CUT point change which items are included between fetches? (feed grows at the top)
