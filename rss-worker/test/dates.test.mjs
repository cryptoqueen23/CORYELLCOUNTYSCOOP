import assert from "node:assert/strict";
import { test } from "node:test";
import { ingest } from "../lib/ingest.js";
import { isFarFutureDate, parseDate, parseFeed } from "../lib/parse.js";

const NOW = Date.parse("2026-10-31T12:00:00Z");
const HOUR = 3_600_000;
const source = { id: "s", name: "S", kind: "news", scope: "texas", maxAgeDays: 30, cap: 10, refreshMinutes: 30 };
const rss = (items) => `<rss><channel>${items.map((i) => `<item><title>${i.title}</title><link>${i.link}</link><pubDate>${i.date}</pubDate></item>`).join("")}</channel></rss>`;
const savedItems = (result) => JSON.parse(result.text).items;

test("a date more than a day ahead is flagged; a small clock skew is not", () => {
  assert.equal(isFarFutureDate("Fri, 28 Jul 2028 19:37:00 GMT", NOW), true);
  assert.equal(isFarFutureDate(new Date(NOW + 2 * 24 * HOUR).toISOString(), NOW), true);
  assert.equal(isFarFutureDate(new Date(NOW + 3 * HOUR).toISOString(), NOW), false);
  assert.equal(isFarFutureDate(new Date(NOW - 5 * HOUR).toISOString(), NOW), false);
  assert.equal(isFarFutureDate("", NOW), false);
  assert.equal(isFarFutureDate("garbage", NOW), false);
});

test("a far-future story is dropped by ingest; stories with real dates keep exactly the publisher's date", () => {
  const legit = "Fri, 30 Oct 2026 15:04:48 GMT";
  const items = parseFeed(
    rss([
      { title: "Real story", link: "https://a.example/1", date: legit },
      { title: "Bogus clock", link: "https://a.example/2", date: "Fri, 28 Jul 2028 19:37:00 GMT" },
    ]),
    { now: NOW },
  );
  const result = ingest(null, { ok: true, items }, source, NOW);
  const saved = savedItems(result);
  assert.deepEqual(saved.map((i) => i.title), ["Real story"]);
  assert.equal(saved[0].pubDate, "2026-10-30T15:04:48.000Z"); // the publisher's date, not the collection time
});

test("a date only a few hours ahead (clock skew) is not shown as a date, and is not replaced by the collection time", () => {
  const items = parseFeed(rss([{ title: "Skewed clock", link: "https://a.example/3", date: new Date(NOW + 3 * HOUR).toUTCString() }]), { now: NOW });
  const [saved] = savedItems(ingest(null, { ok: true, items }, source, NOW));
  assert.equal(saved.pubDate, null);
  assert.equal(saved.fs, new Date(NOW).toISOString()); // labelled with when it was first seen, kept apart from pubDate
});

test("pre-2010 dates are still treated as missing, not dropped (the SOS feed stamps 2001)", () => {
  assert.equal(parseDate("Sat, 01 Dec 2001 00:00:00 GMT", NOW), null);
  assert.equal(isFarFutureDate("Sat, 01 Dec 2001 00:00:00 GMT", NOW), false);
});
