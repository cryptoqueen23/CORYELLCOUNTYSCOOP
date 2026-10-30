// Turns the Worker's raw feed (schema 3: one saved record per source) into the list of
// stories the page shows: expiry, age limits, ranking and duplicate removal. This runs in
// the browser so the free-plan Worker does not have to; see rss-worker/lib/feed.js.
(function (root) {
  "use strict";

  var HOUR = 3600000;
  var DAY = 24 * HOUR;
  var UNDATED_MAX_AGE_DAYS = 3;
  var MAX_STORIES = 150;
  var FAILING_AFTER = 3;
  var DUPLICATE_THRESHOLD = 0.75;
  var LOCATION_WEIGHT = { "copperas-cove": 100, gatesville: 100, "coryell-county": 100, "central-texas": 50, texas: 10 };
  var STOPWORDS = "the a an of to in on for and at by with as is are from its new".split(" ");

  function shortHash(text) {
    var hash = 2166136261;
    for (var i = 0; i < text.length; i += 1) {
      hash ^= text.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(36);
  }

  function titleTokens(title) {
    var set = new Set();
    String(title)
      .toLowerCase()
      .replace(/[‘’']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .forEach(function (word) {
        if (word && STOPWORDS.indexOf(word) === -1) set.add(word);
      });
    return set;
  }

  function similarity(a, b) {
    if (!a.size || !b.size) return 0;
    var shared = 0;
    a.forEach(function (token) {
      if (b.has(token)) shared += 1;
    });
    var jaccard = shared / (a.size + b.size - shared);
    var containment = shared / Math.min(a.size, b.size);
    return Math.max(jaccard, Math.min(a.size, b.size) >= 5 ? containment * 0.9 : 0);
  }

  // `stories` must be best-first; the first of each cluster wins.
  function dedupe(stories) {
    var kept = [];
    var byLink = new Map();
    stories.forEach(function (story) {
      var tokens = titleTokens(story.title);
      var existing = byLink.get(story.link);
      if (!existing) {
        for (var i = 0; i < kept.length; i += 1) {
          if (similarity(kept[i]._tokens, tokens) >= DUPLICATE_THRESHOLD) {
            existing = kept[i];
            break;
          }
        }
      }
      if (existing) {
        var name = story.publisher;
        if (name && name !== existing.publisher && existing.alsoReportedBy.indexOf(name) === -1) existing.alsoReportedBy.push(name);
        return;
      }
      var entry = Object.assign({}, story, { _tokens: tokens, alsoReportedBy: [] });
      kept.push(entry);
      byLink.set(story.link, entry);
    });
    return kept.map(function (entry) {
      delete entry._tokens;
      return entry;
    });
  }

  function timeOf(story) {
    return Date.parse(story.pubDate || story.firstSeen || 0) || 0;
  }

  function score(story, now) {
    var points = LOCATION_WEIGHT[story.location] || 0;
    if (story.locationBasis === "title") points += 10;
    if (story.locationBasis === "search") points -= 10;
    if (story.locationBasis === "publisher") points += 6;
    if (story.locationBasis === "context") points += 4;
    if (story.kind === "official") points += 8;
    var time = story.pubDate ? Date.parse(story.pubDate) : 0;
    if (time) points += Math.max(0, 40 - Math.max(0, (now - time) / HOUR) / 6);
    return Math.round(points * 10) / 10;
  }

  function statusOf(failures) {
    return failures >= FAILING_AFTER ? "failing" : failures > 0 ? "stale" : "ok";
  }

  function toStory(item, source, rec, now) {
    if (item.expires && Date.parse(item.expires) < now) return null;
    var published = item.pubDate ? Date.parse(item.pubDate) : null;
    if (published !== null && isNaN(published)) return null;
    // Items with no date are labelled with when we first saw them (item.fs), never invented.
    var reference = published !== null ? published : item.fs ? Date.parse(item.fs) : null;
    if (reference === null || isNaN(reference)) return null;
    // A date in the future is a data error (a 2028 story once topped the page).
    if (reference - now > DAY) return null;
    var maxAgeDays = published !== null ? source.maxAgeDays : Math.min(source.maxAgeDays, UNDATED_MAX_AGE_DAYS);
    if (now - reference > maxAgeDays * DAY) return null;

    var story = {
      id: shortHash(item.link),
      title: item.title,
      link: item.link,
      source: item.publisher,
      sourceId: source.id,
      publisher: item.publisher,
      kind: source.kind,
      pubDate: item.pubDate || null,
      firstSeen: published === null ? item.fs || null : null,
      location: item.location,
      locations: item.locations,
      locationBasis: item.locationBasis,
      categories: item.categories,
      summary: item.summary || "",
      stale: rec.f > 0,
      fetchedAt: rec.t,
    };
    story.score = score(story, now);
    return story;
  }

  function build(feed, now) {
    var candidates = [];
    var health = [];
    feed.sources.forEach(function (source) {
      var rec = source.rec;
      if (!rec) {
        health.push({ id: source.id, name: source.name, kind: source.kind, status: "pending", itemsShown: 0 });
        return;
      }
      var stories = rec.items
        .map(function (item) {
          return toStory(item, source, rec, now);
        })
        .filter(Boolean)
        .sort(function (a, b) {
          return timeOf(b) - timeOf(a);
        })
        .slice(0, source.cap);
      candidates.push.apply(candidates, stories);
      health.push({
        id: source.id,
        name: source.name,
        kind: source.kind,
        status: statusOf(rec.f),
        lastSuccess: rec.t,
        consecutiveFailures: rec.f,
        lastError: rec.e,
        itemsShown: stories.length,
        ageMinutes: rec.t ? Math.round((now - Date.parse(rec.t)) / 60000) : null,
      });
    });
    candidates.sort(function (a, b) {
      return b.score - a.score || timeOf(b) - timeOf(a);
    });
    return {
      schema: 2,
      generatedAt: feed.generatedAt,
      stories: dedupe(candidates).slice(0, MAX_STORIES),
      health: health,
      sourcesOk: health.filter(function (h) {
        return h.status === "ok";
      }).length,
      sourcesTotal: health.length,
    };
  }

  var api = { build: build, dedupe: dedupe, titleTokens: titleTokens, similarity: similarity, statusOf: statusOf };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FeedBuild = api;
})(typeof window !== "undefined" ? window : globalThis);
