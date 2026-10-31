const assert = require("node:assert/strict");
const { test } = require("node:test");
const L = require("../news-logic.js");

const NOW = Date.parse("2026-10-29T18:00:00Z");
const hoursAgo = (h) => new Date(NOW - h * 3600000).toISOString();

const story = (over) => ({
  id: String(Math.random()),
  title: "Story",
  link: "https://example.com/a",
  publisher: "KCEN",
  kind: "news",
  pubDate: hoursAgo(2),
  firstSeen: null,
  location: "copperas-cove",
  locations: ["copperas-cove", "texas"],
  categories: ["general"],
  summary: "",
  alsoReportedBy: [],
  ...over,
});

test("search matches every word across title and publisher, case-insensitively", () => {
  const s = story({ title: "Council approves drainage agreement", publisher: "Copperas Cove Leader Press" });
  assert.ok(L.matchesQuery(s, "COUNCIL drainage"));
  assert.ok(L.matchesQuery(s, "leader press"));
  assert.ok(!L.matchesQuery(s, "council budget"));
  assert.ok(L.matchesQuery(s, "   "));
});

test("filters by place, topic and date; undated stories fail a date filter", () => {
  const stories = [
    story({ title: "A", location: "gatesville", locations: ["gatesville", "texas"], categories: ["schools"] }),
    story({ title: "B", location: "texas", locations: ["texas"], categories: ["elections"], pubDate: hoursAgo(80) }),
    story({ title: "C", pubDate: null, firstSeen: hoursAgo(1) }),
  ];
  const titles = (f) => L.filterStories(stories, f, NOW).map((s) => s.title).sort();
  assert.deepEqual(titles({ location: "gatesville" }), ["A"]);
  assert.deepEqual(titles({ location: "texas" }), ["B"], "Texas filter means statewide only");
  assert.deepEqual(titles({ category: "elections" }), ["B"]);
  assert.deepEqual(titles({ days: "1" }), ["A"]);
  assert.deepEqual(titles({ days: "7" }), ["A", "B"]);
  assert.deepEqual(titles({}), ["A", "B", "C"]);
});

test("isFiltering ignores blank input", () => {
  assert.equal(L.isFiltering({ q: "  ", location: "", category: "", days: "" }), false);
  assert.equal(L.isFiltering({ q: "tax" }), true);
});

test("latest local news is local-first and only fills with Central Texas when thin", () => {
  const local = [story({ title: "L1" })];
  const regional = [story({ title: "R1", location: "central-texas", locations: ["central-texas", "texas"] })];
  const statewide = [story({ title: "T1", location: "texas", locations: ["texas"] })];
  const out = L.sectionStories("latest-local", [...local, ...regional, ...statewide]).map((s) => s.title);
  assert.deepEqual(out.sort(), ["L1", "R1"]);
  assert.ok(!out.includes("T1"), "statewide never fills local news");
});

test("Texas headlines list official announcements before news reports", () => {
  const out = L.sectionStories("texas", [
    story({ title: "news-new", kind: "news", location: "texas", locations: ["texas"], pubDate: hoursAgo(1) }),
    story({ title: "official-old", kind: "official", location: "texas", locations: ["texas"], pubDate: hoursAgo(30) }),
  ]).map((s) => s.title);
  assert.deepEqual(out, ["official-old", "news-new"]);
});

test("topic sections exclude statewide stories except Elections", () => {
  const stateGov = story({ location: "texas", locations: ["texas"], categories: ["government", "elections"] });
  assert.equal(L.sectionStories("government", [stateGov]).length, 0);
  assert.equal(L.sectionStories("elections", [stateGov]).length, 1);
});

test("date labels never invent a publication date", () => {
  assert.equal(L.dateLabel(story({ pubDate: hoursAgo(0.5) }), NOW), "30 min ago");
  assert.equal(L.dateLabel(story({ pubDate: hoursAgo(3) }), NOW), "3 hours ago");
  assert.equal(L.dateLabel(story({ pubDate: hoursAgo(50) }), NOW), "2 days ago");
  assert.equal(L.dateLabel(story({ pubDate: null, firstSeen: hoursAgo(1) }), NOW), "Date not provided");
});

test("the top strip expires: only alerts or local news under 24 hours old", () => {
  const old = story({ pubDate: hoursAgo(30) });
  assert.equal(L.latestBar([old], NOW), null);
  const fresh = story({ pubDate: hoursAgo(5) });
  assert.equal(L.latestBar([old, fresh], NOW).label, "Latest local");
  const alert = story({ sourceId: "nws-alerts" });
  assert.equal(L.latestBar([fresh, alert], NOW).label, "Weather alert");
  const statewide = story({ location: "texas", locations: ["texas"] });
  assert.equal(L.latestBar([statewide], NOW), null);
});

test("links with unsafe schemes are rejected", () => {
  assert.equal(L.safeHref("javascript:alert(1)"), "");
  assert.equal(L.safeHref("https://example.com/x"), "https://example.com/x");
  assert.equal(L.safeHref("not a url"), "");
});

test("saved copies never appear in the top strip", () => {
  const savedLocal = story({ pubDate: hoursAgo(1), stale: true });
  const savedAlert = story({ sourceId: "nws-alerts", stale: true });
  assert.equal(L.latestBar([savedLocal, savedAlert], NOW), null);
});

test("undated stories never outrank dated ones, even if first seen just now", () => {
  const dated = story({ title: "dated", location: "texas", locations: ["texas"], kind: "official", pubDate: hoursAgo(60) });
  const undated = story({ title: "undated", location: "texas", locations: ["texas"], kind: "official", pubDate: null, firstSeen: hoursAgo(0.1) });
  assert.deepEqual(L.sectionStories("texas", [undated, dated]).map((s) => s.title), ["dated", "undated"]);
});

test("an old-format Worker response is adapted instead of failing", () => {
  const out = L.adaptLegacySnapshot({ updated: "2026-10-29T10:00:00Z", stories: [{ title: "T", link: "https://x/1", source: "KWTX", pubDate: "2026-10-29T09:00:00Z" }, { title: "", link: "" }] });
  assert.equal(out.schema, 2);
  assert.equal(out.stories.length, 1);
  assert.equal(out.stories[0].location, "texas");
  assert.equal(L.adaptLegacySnapshot({}), null);
});

test("the legacy Worker fallback drops future-dated, pre-2010, unreadable-date and non-http stories and never rewrites a real date", () => {
  const NOW_MS = Date.parse("2026-10-31T12:00:00Z");
  const mk = (title, link, pubDate) => ({ title, link, source: "S", pubDate });
  const out = L.adaptLegacySnapshot(
    {
      updated: "2026-10-31T11:00:00Z",
      stories: [
        mk("Good", "https://x.example/good", "2026-10-30T09:00:00Z"),
        mk("Undated", "https://x.example/undated", null),
        mk("Slightly ahead", "https://x.example/ahead", "2026-10-31T20:00:00Z"),
        mk("Year 2028", "http://www.sos.state.tx.us/about/newsreleases/2014/072414.shtml", "2028-07-28T19:37:00.000Z"),
        mk("Year 2001", "https://x.example/old", "2001-12-01T00:00:00Z"),
        mk("Garbage date", "https://x.example/garbage", "not a date"),
        mk("Script link", "javascript:alert(1)", "2026-10-30T09:00:00Z"),
      ],
    },
    NOW_MS,
  );
  assert.deepEqual(out.stories.map((s) => s.title), ["Good", "Undated", "Slightly ahead"]);
  assert.equal(out.stories[0].pubDate, "2026-10-30T09:00:00Z");
  assert.equal(out.stories[1].pubDate, null);
});
