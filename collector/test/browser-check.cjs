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

  await browser.close();
  server.close();
  console.log(results.every(Boolean) ? "\nALL PASS" : "\nFAILURES");
  process.exit(results.every(Boolean) ? 0 : 1);
})();
