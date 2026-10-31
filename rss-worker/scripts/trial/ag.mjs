import fs from "node:fs";
const h=()=>Number(process.hrtime.bigint())/1e6;
const { cleanText, decodeEntities, parseDate, safeUrl } = await import("file:///C:/Users/insur/CORYELLCOUNTYSCOOP/rss-worker/lib/parse.js");
const { ingest } = await import("file:///C:/Users/insur/CORYELLCOUNTYSCOOP/rss-worker/lib/ingest.js");
const { SOURCES } = await import("file:///C:/Users/insur/CORYELLCOUNTYSCOOP/rss-worker/lib/sources.js");
const src = SOURCES.find((s) => s.id === "tx-ag");
const html = fs.readFileSync(process.argv[2], "utf8").slice(0, src.headChars);
const now = Date.now();
function extract() {
  const blocks = html.match(/<div class="m-b-3">[\s\S]*?<\/div>/g) || [];
  const items = [];
  for (const block of blocks) {
    const t = block.match(/<h4[^>]*><a href="([^"]+)">([^<]+)<\/a><\/h4>/); if (!t) continue;
    const d = block.match(/<p class="meta m-b-0">\s*([^|<]+)\|/);
    const link = safeUrl(t[1], "https://www.texasattorneygeneral.gov"); const title = cleanText(decodeEntities(t[2]));
    if (link && title) items.push({ title, link, pubDate: parseDate(d?.[1], now), publisher: "", summary: "" });
  }
  return items;
}
let a = h(); const items = extract(); const e1 = h() - a;
a = h(); const r1 = ingest(null, { ok: true, items }, src, now); const i1 = h() - a;
a = h(); const e2 = (extract(), h() - a);
a = h(); ingest(r1.text, { ok: true, items }, src, now + 1); const i2 = h() - a;
console.log("html chars", html.length, "blocks", (html.match(/<div class="m-b-3">/g)||[]).length, "items", items.length);
console.log("cold: extract", e1.toFixed(2), "ms | ingest(new)", i1.toFixed(2), "ms   warm: extract", e2.toFixed(2), "| ingest(unchanged)", i2.toFixed(2));
// worst-case regex cost: lazy match scanning
a = h(); for (let i = 0; i < 200; i++) extract(); console.log("avg warm extract over 200:", ((h() - a) / 200).toFixed(3), "ms");
