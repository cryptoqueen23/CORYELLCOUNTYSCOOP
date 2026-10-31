// Manual browser check of the feed switch (not part of `node --test`; needs playwright-core and axe-core,
// which live in other projects on this machine). Usage: node browser-check.cjs <path to a collected news.json>
// Serves the site from the repo folder and intercepts the two feed URLs, so nothing leaves the machine.
const { chromium } = require("C:/Users/insur/hg-verify/node_modules/playwright-core");
const axeSrc = require("fs").readFileSync("C:/Users/insur/chronium/node_modules/axe-core/axe.min.js", "utf8");
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "../..");
const STATIC_URL = "https://raw.githubusercontent.com/cryptoqueen23/CORYELLCOUNTYSCOOP/data/news.json";
const WORKER_URL = "https://coryell-county-rss.truewolfflix777.workers.dev/";
const realFeed = fs.readFileSync(process.argv[2], "utf8");
const legacy = JSON.stringify({ updated: new Date().toISOString(), stories: [{ title: "Legacy Worker headline", link: "https://example.com/legacy", source: "Texas Test", pubDate: new Date().toISOString(), official: true }] });
const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".jpeg": "image/jpeg" };

const server = http.createServer((req, res) => {
  const file = path.join(ROOT, decodeURIComponent(req.url.split("?")[0]).replace(/^\/$/, "/index.html"));
  if (!file.startsWith(ROOT) || !fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" }).end(fs.readFileSync(file));
});

const results = [];
const check = (name, ok, detail = "") => {
  results.push(ok);
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
};

(async () => {
  await new Promise((r) => server.listen(0, r));
  const base = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();

  async function open(context, handlers, waitFor) {
    const hits = { static: 0, worker: 0 };
    const page = await context.newPage();
    await page.route(STATIC_URL, (route) => { hits.static += 1; handlers.static(route); });
    await page.route(WORKER_URL, (route) => { hits.worker += 1; handlers.worker(route); });
    await page.route(/api\.weather\.gov|fonts\.g/, (route) => route.abort());
    const t0 = Date.now();
    await page.goto(base);
    await page.waitForFunction((re) => new RegExp(re, "i").test(document.body.innerText), waitFor, { timeout: 25000 });
    return { page, hits, ms: Date.now() - t0 };
  }
  const json = (body) => (route) => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body });
  const status = (code) => (route) => route.fulfill({ status: code, headers: { "access-control-allow-origin": "*" }, body: "x" });
  const hang = () => {}; // never answers

  // 1. Fresh static file: used, Worker never asked.
  let ctx = await browser.newContext({ viewport: { width: 375, height: 800 } });
  let r = await open(ctx, { static: json(realFeed), worker: json(legacy) }, "Headlines updated");
  const text = await r.page.innerText("body");
  check("fresh static file is shown", /Headlines updated/.test(text) && !/Legacy Worker headline/.test(text));
  check("Worker is not called when the static file is fresh", r.hits.worker === 0, `static ${r.hits.static}, worker ${r.hits.worker}`);
  const scrollW = await r.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  check("no horizontal scroll at 375px", scrollW <= 0, `overflow ${scrollW}px`);
  await r.page.addScriptTag({ content: axeSrc });
  const axe = await r.page.evaluate(() => axe.run(document, { runOnly: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] }));
  check("axe WCAG 2.0-2.2 A/AA violations = 0", axe.violations.length === 0, axe.violations.map((v) => v.id).join(","));
  await r.page.setViewportSize({ width: 320, height: 800 });
  check("no horizontal scroll at 320px", (await r.page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)) <= 0);

  // 2. Both down in the SAME browser profile: the saved copy from scenario 1 is shown.
  r = await open(ctx, { static: status(500), worker: status(500) }, "saved copy|Headlines updated");
  const t2 = await r.page.innerText("body");
  check("both feeds down: saved copy still shown", /saved copy|Headlines updated/.test(t2) && !/Headlines could not be loaded/.test(t2));
  await ctx.close();

  // 3. Static missing: the Worker's legacy format is used.
  ctx = await browser.newContext();
  r = await open(ctx, { static: status(404), worker: json(legacy) }, "Legacy Worker headline");
  check("static 404: Worker fallback is used", /Legacy Worker headline/.test(await r.page.innerText("body")), `worker ${r.hits.worker}`);
  await ctx.close();

  // 4. Static hangs: bounded wait (6 s), then the Worker.
  ctx = await browser.newContext();
  r = await open(ctx, { static: hang, worker: json(legacy) }, "Legacy Worker headline");
  check("static hangs: falls back after the time limit", /Legacy Worker headline/.test(await r.page.innerText("body")) && r.ms >= 5500 && r.ms < 12000, `${r.ms} ms; waited for the 6 s limit, then used the Worker`);
  await ctx.close();

  // 5. Everything down, nothing saved: honest error message.
  ctx = await browser.newContext();
  r = await open(ctx, { static: status(500), worker: status(500) }, "temporarily unavailable|could not be loaded");
  check("everything down and nothing saved: error message", /temporarily unavailable|could not be loaded/i.test(await r.page.innerText("body")));
  await ctx.close();

  // 6. Workflow disabled: the last static file is 30 min old -> still used, Worker never asked.
  const aged = (minutes) => {
    const f = JSON.parse(realFeed);
    f.tick = { ...f.tick, at: new Date(Date.now() - minutes * 60000).toISOString(), t: new Date(Date.now() - minutes * 60000).toISOString() };
    return JSON.stringify(f);
  };
  ctx = await browser.newContext();
  r = await open(ctx, { static: json(aged(30)), worker: json(legacy) }, "Headlines updated");
  check("disabled workflow, file 30 min old: static file still used, Worker not asked", r.hits.worker === 0 && !/Legacy Worker headline/.test(await r.page.innerText("body")), `worker hits ${r.hits.worker}`);
  await ctx.close();

  // 7. File 200 min old (past the 150 min window): the Worker takes over.
  ctx = await browser.newContext();
  r = await open(ctx, { static: json(aged(200)), worker: json(legacy) }, "Legacy Worker headline");
  check("disabled workflow, file 200 min old: Worker takes over", r.hits.worker === 1 && /Legacy Worker headline/.test(await r.page.innerText("body")));
  await ctx.close();

  // 8. Fallback with the old Worker's bad data: the 2028-dated story and a javascript: link never appear.
  const badLegacy = JSON.stringify({ updated: new Date().toISOString(), stories: [
    { title: "Legacy Worker headline", link: "https://example.com/legacy", source: "Texas Test", pubDate: new Date().toISOString(), official: true },
    { title: "Reminder from Secretary of State FUTURE STORY", link: "http://www.sos.state.tx.us/about/newsreleases/2014/072414.shtml", source: "Texas Secretary of State", pubDate: "2028-07-28T19:37:00.000Z", official: true },
    { title: "Script link story", link: "javascript:alert(1)", source: "X", pubDate: new Date().toISOString() }] });
  ctx = await browser.newContext();
  r = await open(ctx, { static: status(404), worker: json(badLegacy) }, "Legacy Worker headline");
  const t8 = await r.page.innerText("body");
  check("fallback hides the 2028-dated story and the script link", !/FUTURE STORY/.test(t8) && !/Script link story/.test(t8));
  await ctx.close();

  await browser.close();
  server.close();
  console.log(results.every(Boolean) ? "\nALL PASS" : "\nFAILURES");
  process.exit(results.every(Boolean) ? 0 : 1);
})();
