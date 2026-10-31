const { chromium } = require("C:/Users/insur/hg-verify/node_modules/playwright-core");
const axeSrc = require("fs").readFileSync("C:/Users/insur/chronium/node_modules/axe-core/axe.min.js", "utf8");
const http = require("http"), fs = require("fs"), path = require("path");
const root = "C:/Users/insur/CORYELLCOUNTYSCOOP";
const body = fs.readFileSync(process.argv[2], "utf8");
const srv = http.createServer((q, r) => { let p = path.join(root, q.url === "/" ? "index.html" : q.url.split("?")[0]); fs.readFile(p, (e, d) => { if (e) { r.statusCode = 404; return r.end(); } r.setHeader("Content-Type", p.endsWith(".js") ? "text/javascript" : p.endsWith(".css") ? "text/css" : p.endsWith(".json") ? "application/json" : p.endsWith(".mp4") ? "video/mp4" : "text/html"); r.end(d); }); }).listen(8767);
const WORKER = "https://coryell-county-rss.truewolfflix777.workers.dev";
async function page(b, width, height, extra = {}) {
  const ctx = await b.newContext({ viewport: { width, height }, ...extra });
  const pg = await ctx.newPage();
  await pg.route(WORKER + "**", (rt) => rt.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body }));
  await pg.goto("http://localhost:8767/", { waitUntil: "networkidle" });
  return pg;
}
(async () => {
  const b = await chromium.launch();
  // 1. Keyboard
  let pg = await page(b, 1280, 900);
  const seq = [];
  for (let i = 0; i < 14; i++) { await pg.keyboard.press("Tab"); seq.push(await pg.evaluate(() => { const e = document.activeElement; const cs = getComputedStyle(e); const vis = cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0 || cs.boxShadow !== "none"; return (e.tagName + " " + (e.textContent || e.getAttribute("aria-label") || "").trim().slice(0, 28) + " | focusRing=" + vis); })); }
  console.log("KEYBOARD first 14 tab stops:\n  " + seq.join("\n  "));
  await pg.close();
  // mobile menu by keyboard
  pg = await page(b, 375, 800);
  await pg.focus("#menu-toggle"); await pg.keyboard.press("Enter");
  const open1 = await pg.getAttribute("#menu-toggle", "aria-expanded");
  await pg.keyboard.press("Escape");
  const open2 = await pg.getAttribute("#menu-toggle", "aria-expanded");
  const focusBack = await pg.evaluate(() => document.activeElement.id);
  await pg.keyboard.press("Space"); const open3 = await pg.getAttribute("#menu-toggle", "aria-expanded");
  console.log("MENU keyboard: Enter->", open1, "| Escape->", open2, "focus returns to", focusBack, "| Space->", open3);
  // skip link
  await pg.reload({ waitUntil: "networkidle" }); await pg.keyboard.press("Tab");
  console.log("FIRST tab stop:", await pg.evaluate(() => document.activeElement.textContent.trim().slice(0, 40) + " href=" + document.activeElement.getAttribute("href")));
  await pg.keyboard.press("Enter"); console.log("after skip link, focus in:", await pg.evaluate(() => document.activeElement.tagName + "#" + document.activeElement.id));
  await pg.close();
  // 2. Zoom 200% / 400% (CSS px at 1280 wide: 640 / 320)
  for (const [label, w] of [["200%", 640], ["400%", 320]]) {
    pg = await page(b, w, 800);
    const r = await pg.evaluate(() => { let clipped = []; document.querySelectorAll("h1,h2,h3,p,a,button,label,li").forEach((e) => { const cs = getComputedStyle(e); if (cs.overflow !== "visible" && e.scrollWidth > e.clientWidth + 1) clipped.push(e.tagName + ":" + (e.textContent || "").trim().slice(0, 20)); }); return { hOverflow: document.documentElement.scrollWidth - innerWidth, clipped: clipped.slice(0, 5), minTarget: Math.min(...[...document.querySelectorAll("a,button,input,select")].filter((e) => e.offsetParent && e.getBoundingClientRect().width > 0).map((e) => Math.round(e.getBoundingClientRect().height))) }; });
    console.log("ZOOM", label, "(" + w + " css px):", JSON.stringify(r));
    await pg.close();
  }
  // 3. Accessibility tree (screen-reader proxy)
  pg = await page(b, 1280, 900);
  const info = await pg.evaluate(() => ({
    lang: document.documentElement.lang, title: document.title,
    landmarks: [...document.querySelectorAll("header,nav,main,footer,[role=banner],[role=navigation],[role=main],[role=contentinfo],[role=search],aside")].map((e) => e.tagName.toLowerCase() + (e.getAttribute("aria-label") ? "[" + e.getAttribute("aria-label") + "]" : "")),
    headings: [...document.querySelectorAll("h1,h2,h3")].map((e) => e.tagName + ":" + e.textContent.trim().slice(0, 30)).slice(0, 14),
    h1count: document.querySelectorAll("h1").length,
    unlabeledInputs: [...document.querySelectorAll("input,select,textarea")].filter((e) => !e.labels?.length && !e.getAttribute("aria-label") && !e.getAttribute("aria-labelledby") && e.type !== "hidden").length,
    imgsNoAlt: [...document.querySelectorAll("img")].filter((e) => e.getAttribute("alt") === null).length,
    liveRegions: [...document.querySelectorAll("[aria-live],[role=status],[role=alert]")].map((e) => e.id || e.className),
    newTabLinksAnnounced: [...document.querySelectorAll('a[target=_blank]')].filter((a) => !a.querySelector(".visually-hidden")&&!a.getAttribute("aria-label")).length,
    labelsOnPage: [...new Set([...document.querySelectorAll(".story-kind")].map((e) => e.textContent))],
    officialNotes: document.querySelectorAll(".story-kind-note").length,
  }));
  console.log("A11Y TREE:", JSON.stringify(info, null, 1));
  await pg.evaluate(axeSrc);
  const ax = await pg.evaluate(async () => { const r = await axe.run(document, { runOnly: { type: "tag", values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"] } }); return r.violations.map((v) => v.id + " x" + v.nodes.length); });
  console.log("AXE violations (1280):", JSON.stringify(ax));
  // reduced motion + forced colors sanity
  const ctx2 = await b.newContext({ viewport: { width: 375, height: 800 }, reducedMotion: "reduce", forcedColors: "active" }); const p2 = await ctx2.newPage();
  await p2.route(WORKER + "**", (rt) => rt.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body })); await p2.goto("http://localhost:8767/", { waitUntil: "networkidle" });
  console.log("forced-colors/reduced-motion: overflow", await p2.evaluate(() => document.documentElement.scrollWidth - innerWidth), "cards", await p2.evaluate(() => document.querySelectorAll("[data-section] article").length));
  await b.close(); srv.close();
})();
