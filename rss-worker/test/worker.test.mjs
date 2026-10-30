import assert from "node:assert/strict";
import { test } from "node:test";

import { applyOutcomes, backoffMinutes, buildSnapshot, emptyState, isDue } from "../lib/aggregate.js";
import { categorize, isBlocked, locate } from "../lib/classify.js";
import { dedupe } from "../lib/dedupe.js";
import { cleanText, parseDate, parseFeed, safeUrl } from "../lib/parse.js";
import { SOURCES, isAllowedHost } from "../lib/sources.js";

const NOW = Date.parse("2026-10-29T18:00:00Z");

const rss = (items) =>
  `<?xml version="1.0"?><rss version="2.0"><channel><title>x</title>${items
    .map(
      (i) =>
        `<item><title>${i.title}</title><link>${i.link}</link>${i.date ? `<pubDate>${i.date}</pubDate>` : ""}${
          i.extra || ""
        }</item>`,
    )
    .join("")}</channel></rss>`;

const cityLike = { name: "City", localOfficial: true, scope: "copperas-cove", kind: "official" };
const stateMedia = { name: "Texas Scorecard", scope: "texas", texasFocused: true, kind: "news" };
const regionalMedia = { name: "KCEN", scope: "central-texas", kind: "news" };

// ---- Parsing -------------------------------------------------------------

test("parses RSS items, CDATA titles, and entities", () => {
  const xml = rss([
    { title: "<![CDATA[Council &amp; Mayor meet]]>", link: "https://a.example/1", date: "Wed, 28 Oct 2026 09:37:28 -0600" },
  ]);
  const [item] = parseFeed(xml, { now: NOW });
  assert.equal(item.title, "Council & Mayor meet");
  assert.equal(item.pubDate, "2026-10-28T15:37:28.000Z");
});

test("parses Atom entries and prefers the alternate link", () => {
  const xml = `<feed xmlns="http://www.w3.org/2005/Atom"><entry><title>Atom story</title>
    <link rel="self" href="https://a.example/self"/><link rel="alternate" href="https://a.example/real"/>
    <published>2026-10-28T10:00:00Z</published></entry></feed>`;
  const [item] = parseFeed(xml, { now: NOW });
  assert.equal(item.link, "https://a.example/real");
  assert.equal(item.pubDate, "2026-10-28T10:00:00.000Z");
});

test("empty and malformed feeds yield no items instead of throwing", () => {
  assert.deepEqual(parseFeed("", { now: NOW }), []);
  assert.deepEqual(parseFeed("<rss><channel></channel></rss>", { now: NOW }), []);
  assert.deepEqual(parseFeed("<html>not a feed</html>", { now: NOW }), []);
  assert.deepEqual(parseFeed("<rss><item><title>no link</title></item></rss>", { now: NOW }), []);
});

test("maxItems bounds work on huge feeds", () => {
  const items = Array.from({ length: 500 }, (_, i) => ({ title: `Story ${i}`, link: `https://a.example/${i}` }));
  assert.equal(parseFeed(rss(items), { maxItems: 60, now: NOW }).length, 60);
});

test("untrusted markup is reduced to plain text", () => {
  assert.equal(cleanText("<script>alert(1)</script>Hello <b>world</b>"), "alert(1) Hello world");
  assert.equal(cleanText("&lt;img src=x onerror=alert(1)&gt;Hi"), "Hi");
  assert.equal(cleanText("Attor­ney Gen­er­al"), "Attorney General");
});

test("only http(s) links without credentials are accepted", () => {
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,x"), "");
  assert.equal(safeUrl("https://user:pw@evil.example/"), "");
  assert.equal(safeUrl("/CivicAlerts.aspx?aid=1", "https://www.copperascovetx.gov"), "https://www.copperascovetx.gov/CivicAlerts.aspx?aid=1");
});

test("date handling rejects missing, garbage, ancient, and future dates", () => {
  assert.equal(parseDate("", NOW), null);
  assert.equal(parseDate("not a date", NOW), null);
  assert.equal(parseDate("07/28/2028 19:37:00", NOW), null, "future date from a bad feed clock");
  assert.equal(parseDate("1970-01-01", NOW), null);
  assert.equal(parseDate("October 28, 2026", NOW), "2026-10-28T00:00:00.000Z");
});

// ---- Geographic filtering -------------------------------------------------

test("place names are matched on word boundaries", () => {
  assert.equal(locate("Copperas Cove council meets", regionalMedia).locations[0], "copperas-cove");
  assert.equal(locate("Coryell County burn ban lifted", regionalMedia).locations[0], "coryell-county");
  assert.equal(locate("Templeton wins title", regionalMedia).basis, "source", "Templeton is not Temple");
  assert.equal(locate("Killeen police report", regionalMedia).locations[0], "central-texas");
});

test("statewide stories stay statewide and local-official stories stay local", () => {
  assert.equal(locate("Governor signs bill", stateMedia).locations[0], "texas");
  assert.equal(locate("Trick or treating hours", cityLike).locations[0], "copperas-cove");
});

test("a search hint alone is a weak signal, a local publisher is stronger", () => {
  const search = { ...regionalMedia, hint: "gatesville" };
  assert.equal(locate("Something vague happened", search, "Some Outlet").basis, "search");
  assert.equal(locate("Something vague happened", search, "The Gatesville Messenger").basis, "publisher");
});

// ---- Category classification ---------------------------------------------

test('"Selection" does not trigger the elections category', () => {
  const title = "Phase II Selection Process opens for troopers";
  const cats = categorize(title, { name: "Texas Department of Public Safety", texasFocused: true }, locate(title, stateMedia));
  assert.ok(!cats.includes("elections"));
});

test("plural and local election headlines are elections", () => {
  const loc = locate("Early voting sees brisk turnout in Copperas Cove", regionalMedia);
  assert.ok(categorize("Early voting sees brisk turnout in Copperas Cove", regionalMedia, loc).includes("elections"));
  const t = "Notices of General Election and Special Election";
  assert.ok(categorize(t, cityLike, locate(t, cityLike)).includes("elections"));
});

test("another state's race on a regional feed is not Texas election news", () => {
  const t = "Georgia Senate race tightens before the runoff";
  assert.ok(!categorize(t, regionalMedia, locate(t, regionalMedia)).includes("elections"));
});

test("a candidate's own press office needs a real election term", () => {
  const ag = { name: "Texas Attorney General", texasFocused: true };
  const routine = "Attorney General Ken Paxton Secures Settlement with Lululemon";
  assert.ok(!categorize(routine, ag, locate(routine, ag)).includes("elections"));
  const election = "Paxton sues county over voter rolls";
  assert.ok(categorize(election, ag, locate(election, ag)).includes("elections"));
});

test("government, schools, public safety, infrastructure categories", () => {
  const c = (t) => categorize(t, regionalMedia, locate(t, regionalMedia));
  assert.ok(c("Copperas Cove adopts tax rate and budget").includes("government"));
  assert.ok(c("CCISD trustees approve calendar").includes("schools") === false, "no keyword: ISD spelled CCISD");
  assert.ok(c("Gatesville ISD names new superintendent").includes("schools"));
  assert.ok(c("Man arrested after Coryell County crash").includes("public-safety"));
  assert.ok(c("US 190 bridge closures begin").includes("infrastructure"));
  assert.deepEqual(c("A quiet afternoon"), ["general"]);
});

test("listings and obituaries are filtered out", () => {
  assert.ok(isBlocked("Douglas Conner Obituary Oct 27, 2026", "Scott's Funeral Home"));
  assert.ok(isBlocked("108 Golf Course Rd [Updated 10/24]", "Realtor.com"));
  assert.ok(!isBlocked("Council approves drainage agreement", "Copperas Cove Leader Press"));
});

// ---- Duplicates -------------------------------------------------------------

test("near-identical headlines from different outlets collapse into one", () => {
  const base = { link: "x", alsoReportedBy: [] };
  const stories = [
    { ...base, link: "https://a/1", publisher: "KCEN", title: "Copperas Cove announces new Assistant City Manager, new Director of Public Works" },
    { ...base, link: "https://b/2", publisher: "Yahoo", title: "Copperas Cove announces new Assistant City Manager and new Director of Public Works" },
    { ...base, link: "https://c/3", publisher: "KWTX", title: "Totally different story about a school board" },
  ];
  const result = dedupe(stories);
  assert.equal(result.length, 2);
  assert.deepEqual(result[0].alsoReportedBy, ["Yahoo"]);
});

test("same link twice is a duplicate even with different titles", () => {
  const result = dedupe([
    { link: "https://a/1", publisher: "A", title: "One title" },
    { link: "https://a/1", publisher: "B", title: "Completely other words here" },
  ]);
  assert.equal(result.length, 1);
});

// ---- Aggregation, expiry, failures, caching ---------------------------------

const miniSources = [
  { id: "city", name: "City", kind: "official", scope: "copperas-cove", localOfficial: true, refreshMinutes: 15, maxAgeDays: 45, cap: 10 },
  { id: "media", name: "KCEN", kind: "news", scope: "central-texas", refreshMinutes: 15, maxAgeDays: 7, cap: 10 },
];

const raw = (title, link, pubDate, extra = {}) => ({ title, link, pubDate, publisher: "", summary: "", ...extra });

test("outdated items never appear (old boil-water notice stays hidden)", () => {
  const state = applyOutcomes(
    emptyState(),
    miniSources,
    {
      city: { ok: true, items: [raw("Fresh notice", "https://c/1", "2026-10-28T12:00:00Z"), raw("Boil water notice", "https://c/2", "2026-04-14T12:00:00Z")] },
      media: { ok: true, items: [raw("Last week's TV story", "https://m/1", "2026-10-15T12:00:00Z")] },
    },
    NOW,
  );
  assert.deepEqual(buildSnapshot(state, miniSources, NOW).stories.map((s) => s.title), ["Fresh notice"]);
});

test("a future publish date is discarded rather than pinning the story to the top", () => {
  const [item] = parseFeed(rss([{ title: "Bogus clock", link: "https://a/1", date: "Fri, 28 Jul 2028 19:37:00 GMT" }]), { now: NOW });
  assert.equal(item.pubDate, null);
});

test("undated items are labelled with first-seen time, never a fake publish date", () => {
  const state = applyOutcomes(emptyState(), miniSources, { media: { ok: true, items: [raw("Undated road news", "https://m/9", null)] } }, NOW);
  const [story] = buildSnapshot(state, miniSources, NOW).stories;
  assert.equal(story.pubDate, null);
  assert.equal(story.firstSeen, new Date(NOW).toISOString());
});

test("a failing source keeps last-known-good items and is reported stale", () => {
  const first = applyOutcomes(emptyState(), miniSources, { city: { ok: true, items: [raw("Water main repair", "https://c/5", "2026-10-29T10:00:00Z")] } }, NOW - 3_600_000);
  const second = applyOutcomes(first, miniSources, { city: { ok: false, error: "HTTP 503" } }, NOW);
  const snap = buildSnapshot(second, miniSources, NOW);
  assert.equal(snap.stories.length, 1);
  assert.equal(snap.stories[0].stale, true);
  assert.equal(snap.stories[0].fetchedAt, new Date(NOW - 3_600_000).toISOString(), "fetchedAt stays the last real fetch");
  const health = snap.health.find((h) => h.id === "city");
  assert.equal(health.status, "stale");
  assert.equal(health.lastError, "HTTP 503");
});

test("one failing source never blocks another", () => {
  const state = applyOutcomes(
    emptyState(),
    miniSources,
    { city: { ok: false, error: "timeout" }, media: { ok: true, items: [raw("KCEN story about Killeen", "https://m/2", "2026-10-29T12:00:00Z")] } },
    NOW,
  );
  const snap = buildSnapshot(state, miniSources, NOW);
  assert.equal(snap.stories.length, 1);
  assert.equal(snap.health.find((h) => h.id === "media").status, "ok");
});

test("three consecutive failures mark the source failing; success resets it", () => {
  let state = emptyState();
  for (let i = 0; i < 3; i += 1) state = applyOutcomes(state, miniSources, { city: { ok: false, error: "x" } }, NOW + i);
  assert.equal(buildSnapshot(state, miniSources, NOW).health[0].status, "failing");
  state = applyOutcomes(state, miniSources, { city: { ok: true, items: [] } }, NOW);
  assert.equal(buildSnapshot(state, miniSources, NOW).health[0].status, "ok");
});

test("empty feeds are healthy and produce no stories", () => {
  const state = applyOutcomes(emptyState(), miniSources, { city: { ok: true, items: [] }, media: { ok: true, items: [] } }, NOW);
  const snap = buildSnapshot(state, miniSources, NOW);
  assert.equal(snap.stories.length, 0);
  assert.equal(snap.sourcesOk, 2);
});

test("expired weather alerts disappear", () => {
  const nws = { id: "nws", name: "National Weather Service", kind: "official", scope: "coryell-county", localOfficial: true, refreshMinutes: 15, maxAgeDays: 2, cap: 5 };
  const alerts = [
    raw("Flood Watch", "https://w/1", "2026-10-29T10:00:00Z", { alert: true, expires: "2026-10-29T12:00:00Z" }),
    raw("Wind Advisory", "https://w/2", "2026-10-29T10:00:00Z", { alert: true, expires: "2026-10-30T12:00:00Z" }),
  ];
  const state = applyOutcomes(emptyState(), [nws], { nws: { ok: true, items: alerts } }, NOW);
  assert.deepEqual(buildSnapshot(state, [nws], NOW).stories.map((s) => s.title), ["Wind Advisory"]);
});

test("local stories outrank equally fresh statewide stories", () => {
  const sources = [
    { id: "tx", name: "Texas Scorecard", kind: "news", scope: "texas", texasFocused: true, refreshMinutes: 15, maxAgeDays: 5, cap: 10 },
    miniSources[0],
  ];
  const state = applyOutcomes(
    emptyState(),
    sources,
    { tx: { ok: true, items: [raw("Statewide budget fight", "https://t/1", "2026-10-29T17:30:00Z")] }, city: { ok: true, items: [raw("Road crew update", "https://c/8", "2026-10-29T12:00:00Z")] } },
    NOW,
  );
  assert.equal(buildSnapshot(state, sources, NOW).stories[0].title, "Road crew update");
});

// ---- Refresh scheduling / cache behaviour ------------------------------------

test("sources are skipped until their refresh interval passes", () => {
  const source = miniSources[0];
  const state = { lastAttempt: new Date(NOW - 5 * 60_000).toISOString(), consecutiveFailures: 0 };
  assert.equal(isDue(source, state, NOW), false);
  assert.equal(isDue(source, { ...state, lastAttempt: new Date(NOW - 16 * 60_000).toISOString() }, NOW), true);
  assert.equal(isDue(source, undefined, NOW), true);
});

test("failing sources back off exponentially, capped at two hours", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 10].map(backoffMinutes), [0, 5, 10, 20, 40, 120]);
  const source = miniSources[0];
  const failing = { lastAttempt: new Date(NOW - 30 * 60_000).toISOString(), consecutiveFailures: 5 };
  assert.equal(isDue(source, failing, NOW), false, "5 failures = 80 min wait");
});

// ---- Source registry / security ---------------------------------------------

test("every source is https and its host is on the allowlist", () => {
  for (const source of SOURCES) {
    const url = new URL(source.url);
    assert.equal(url.protocol, "https:", source.id);
    assert.ok(isAllowedHost(url.hostname), source.id);
  }
  assert.equal(isAllowedHost("evil.example"), false);
  assert.equal(isAllowedHost("169.254.169.254"), false);
});

test("source ids are unique", () => {
  assert.equal(new Set(SOURCES.map((s) => s.id)).size, SOURCES.length);
});

// ---- geographic classification and link normalization (regression) ----

test("a regional outlet's story with no local place in the headline is statewide, not local", async () => {
  const { locate } = await import("../lib/classify.js");
  const fox = { id: "fox44", scope: "central-texas" };
  const result = locate("College Station Animal Control seeking dog in animal cruelty case", fox, "KWKT Fox 44");
  assert.deepEqual(result.locations, ["texas"]);
  assert.equal(result.basis, "source");
});

test("a regional outlet's story that names Copperas Cove or Killeen keeps that place", async () => {
  const { locate } = await import("../lib/classify.js");
  const fox = { id: "fox44", scope: "central-texas" };
  assert.equal(locate("Copperas Cove council votes on budget", fox, "KWKT Fox 44").locations[0], "copperas-cove");
  assert.equal(locate("Killeen police investigate crash", fox, "KWKT Fox 44").locations[0], "central-texas");
});

test("a newspaper whose whole beat is a place stays local without the town in the headline", async () => {
  const { locate } = await import("../lib/classify.js");
  const paper = { id: "leader-press", scope: "copperas-cove", localOutlet: true };
  assert.equal(locate("Council approves new sidewalk plan", paper, "Leader Press").locations[0], "copperas-cove");
});

test("tracking parameters are removed from links so unchanged feeds look unchanged", async () => {
  const { safeUrl } = await import("../lib/parse.js");
  assert.equal(safeUrl("https://www.kwtx.com/a/?utm_source=x&id=7&fbclid=abc"), "https://www.kwtx.com/a/?id=7");
  assert.equal(safeUrl("https://www.kwtx.com/a/?utm_source=x"), "https://www.kwtx.com/a/");
});

test("a regional story whose headline omits the town but whose description names it is local", async () => {
  const { prepareItem } = await import("../lib/ingest.js");
  const fox = { id: "fox44", name: "KWKT Fox 44", kind: "news", scope: "central-texas" };
  const item = prepareItem(
    { title: "Council approves new sidewalk plan", link: "https://www.fox44news.com/news/a", summary: "The Copperas Cove City Council voted Tuesday to fund sidewalks.", pubDate: "2026-10-30T12:00:00.000Z" },
    fox,
  );
  assert.equal(item.location, "copperas-cove");
  assert.equal(item.locationBasis, "context");
});

test("a place in the link path alone never makes a story local", async () => {
  const { prepareItem } = await import("../lib/ingest.js");
  const fox = { id: "fox44", name: "KWKT Fox 44", kind: "news", scope: "central-texas" };
  const item = prepareItem({ title: "Water main break closes road", link: "https://www.fox44news.com/news/gatesville/water-main-break", summary: "", pubDate: null }, fox);
  assert.equal(item.location, "texas");
});

test("a bare description mention is not enough: hometowns and incidental places stay statewide", async () => {
  const { prepareItem } = await import("../lib/ingest.js");
  const fox = { id: "fox44", name: "KWKT Fox 44", kind: "news", scope: "central-texas" };
  const cases = [
    "Sgt. Lee, a Temple native, was promoted to colonel in Austin on Friday.",
    "The suspect, originally from Killeen, was arrested in Houston.",
    "Gatesville is among the cities that applied for the state grant.",
  ];
  for (const summary of cases) {
    const item = prepareItem({ title: "State announces new program", link: "https://www.fox44news.com/news/x", summary, pubDate: null }, fox);
    assert.equal(item.location, "texas", summary);
  }
});

test("a dateline or an institution or a location preposition shows the story is about the place", async () => {
  const { prepareItem } = await import("../lib/ingest.js");
  const fox = { id: "fox44", name: "KWKT Fox 44", kind: "news", scope: "central-texas" };
  const cases = [
    ["GATESVILLE, Texas - The county jail will close Friday.", "gatesville"],
    ["Harker Heights police are asking for help finding the driver.", "central-texas"],
    ["Crews are working on a water main in Copperas Cove.", "copperas-cove"],
  ];
  for (const [summary, place] of cases) {
    const item = prepareItem({ title: "Road closure announced", link: "https://www.fox44news.com/news/x", summary, pubDate: null }, fox);
    assert.equal(item.location, place, summary);
    assert.equal(item.locationBasis, "context");
  }
});

test("link path corroborates a description mention", async () => {
  const { prepareItem } = await import("../lib/ingest.js");
  const fox = { id: "fox44", name: "KWKT Fox 44", kind: "news", scope: "central-texas" };
  const item = prepareItem({ title: "Budget talks continue", link: "https://www.fox44news.com/news/gatesville/budget", summary: "Gatesville leaders met again Monday.", pubDate: null }, fox);
  assert.equal(item.location, "gatesville");
});

test("a regional story with no local place anywhere stays statewide, and a headline place outranks context", async () => {
  const { prepareItem } = await import("../lib/ingest.js");
  const fox = { id: "fox44", name: "KWKT Fox 44", kind: "news", scope: "central-texas" };
  const none = prepareItem({ title: "College Station Animal Control seeking dog", link: "https://www.fox44news.com/news/a", summary: "Brazos County deputies say the dog was found Monday.", pubDate: null }, fox);
  assert.equal(none.location, "texas");
  const both = prepareItem({ title: "Killeen crash closes highway", link: "https://www.fox44news.com/news/b", summary: "Near Copperas Cove.", pubDate: null }, fox);
  assert.equal(both.locationBasis, "title");
});
