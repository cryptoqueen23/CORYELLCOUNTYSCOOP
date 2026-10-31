const { chromium } = require("C:/Users/insur/hg-verify/node_modules/playwright-core");
const axeSrc = require("fs").readFileSync("C:/Users/insur/chronium/node_modules/axe-core/axe.min.js", "utf8");
const http = require("http"), fs = require("fs"), path = require("path");
const root = "C:/Users/insur/CORYELLCOUNTYSCOOP";
const srv = http.createServer((q, r) => { let p = path.join(root, q.url === "/" ? "index.html" : q.url.split("?")[0]); fs.readFile(p, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader("Content-Type", p.endsWith(".js") ? "text/javascript" : p.endsWith(".css") ? "text/css" : p.endsWith(".json") ? "application/json" : "text/html"); r.end(d); }); }).listen(8766);
const WORKER = "https://coryell-county-rss.truewolfflix777.workers.dev";
async function run(label, url, width) {
  const body = await (await fetch(url, { headers: { Origin: "https://coryellcountyscoop.vercel.app" } })).text();
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width, height: 900 } });
  const errors = []; pg.on("pageerror", (e) => errors.push(e.message));
  await pg.route(WORKER + "/**", (rt) => rt.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body }));
  await pg.route(WORKER, (rt) => rt.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body }));
  await pg.goto("http://localhost:8766/", { waitUntil: "networkidle" });
  const out = await pg.evaluate(() => ({
    cards: document.querySelectorAll("[data-section] article, [data-section] li").length,
    status: document.querySelector("#feed-status")?.textContent,
    notice: document.querySelector("#feed-notice")?.textContent,
    first: [...document.querySelectorAll('[data-section="latest-local"] h3, [data-section="latest-local"] h4')].slice(0, 3).map((e) => e.textContent.trim()),
    overflow: document.documentElement.scrollWidth - innerWidth,
  }));
  await pg.evaluate(axeSrc);
  const ax = await pg.evaluate(async () => { const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"] } }); return r.violations.map((v) => v.id + " x" + v.nodes.length); });
  console.log(label, width, JSON.stringify({ ...out, axe: ax, errors }));
  await b.close();
}
(async () => {
  const test = "https://coryell-county-rss-test.truewolfflix777.workers.dev/";
  for (const w of [320, 768, 1440]) await run("NEW worker->new site", test, w);
  await run("OLD prod worker (legacy)->new site", WORKER + "/", 375);
  srv.close();
})();
