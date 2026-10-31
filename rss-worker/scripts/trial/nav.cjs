const { chromium } = require("C:/Users/insur/hg-verify/node_modules/playwright-core");
const http = require("http"), fs = require("fs"), path = require("path");
const root = "C:/Users/insur/CORYELLCOUNTYSCOOP";
const srv = http.createServer((q, r) => { let p = path.join(root, q.url === "/" ? "index.html" : q.url.split("?")[0]); fs.readFile(p, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader("Content-Type", p.endsWith(".js") ? "text/javascript" : p.endsWith(".css") ? "text/css" : p.endsWith(".json") ? "application/json" : "text/html"); r.end(d); }); }).listen(8765);
(async () => {
  const b = await chromium.launch();
  for (const w of [320, 375, 768, 1024, 1440]) {
    const pg = await b.newPage({ viewport: { width: w, height: 800 } });
    await pg.goto("http://localhost:8765/", { waitUntil: "load" });
    const toggle = pg.locator("#menu-toggle");
    const vis = await toggle.isVisible();
    let opened = null, linksVisible = null;
    if (vis) { await toggle.click(); opened = await toggle.getAttribute("aria-expanded"); linksVisible = await pg.locator("#primary-menu a").first().isVisible(); }
    else linksVisible = await pg.locator("#primary-menu a").first().isVisible();
    const scroll = await pg.evaluate(() => document.documentElement.scrollWidth - innerWidth);
    const box = vis ? await toggle.boundingBox() : null;
    console.log(w, { toggleVisible: vis, expanded: opened, linksVisible, hOverflowPx: scroll, toggleH: box && Math.round(box.height) });
    await pg.close();
  }
  await b.close(); srv.close();
})();
