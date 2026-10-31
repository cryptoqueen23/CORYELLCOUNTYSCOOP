// Chooses which copy of the news feed the page shows: the static file the GitHub Actions collector publishes,
// or (temporarily) the older Cloudflare Worker. It picks the freshest VALID copy, not whichever answers first.
//
// "Gathered" time is when the collector/Worker last ran (snapshot.generatedAt). It is never an article's
// publication date. A copy is valid when it is a feed this site understands, has data for most sources, and
// its gathered time is a real time that is not in the future.
//
// Default order: ask the first URL; if its copy is valid and fresh (inside the page's own stale window) use it
// and do not call the fallback. Otherwise ask the next and keep whichever valid copy was gathered most recently.
// Every request has its own time limit, enforced here as well as through the request's abort signal.
(function (root) {
  "use strict";

  var STALE_MS = 150 * 60000; // same window as the page's "has not refreshed recently" warning
  var FUTURE_SLACK_MS = 10 * 60000;
  var MIN_SOURCES = 8; // a schema 3 feed with most sources missing is treated as broken, not as "no news"

  function withTimeout(start, ms) {
    var controller = new AbortController();
    var timer;
    var limit = new Promise(function (resolve, reject) {
      timer = setTimeout(function () {
        controller.abort();
        reject(new Error("timed out after " + ms + " ms"));
      }, ms);
    });
    return Promise.race([start(controller.signal), limit]).finally(function () {
      clearTimeout(timer);
    });
  }

  // Turns whatever a URL returned into the page's snapshot (schema 2) or throws.
  // deps: { build(feed, now), adaptLegacy(data) }
  function normalizeFeed(raw, deps, now) {
    var snapshot;
    if (raw && raw.schema === 3) {
      if (!Array.isArray(raw.sources)) throw new Error("schema 3 feed without sources");
      var withData = raw.sources.filter(function (s) {
        return s && s.rec;
      }).length;
      if (withData < MIN_SOURCES) throw new Error("feed has too few sources with data");
      snapshot = deps.build(raw, now);
    } else if (raw && raw.schema === 2) {
      snapshot = raw;
    } else {
      snapshot = deps.adaptLegacy(raw, now);
    }
    if (!snapshot || snapshot.schema !== 2 || !Array.isArray(snapshot.stories)) throw new Error("unexpected response");
    var gathered = Date.parse(snapshot.generatedAt);
    if (!isFinite(gathered)) throw new Error("feed has no usable gathered time");
    if (gathered - now > FUTURE_SLACK_MS) throw new Error("feed gathered time is in the future");
    return { snapshot: snapshot, gathered: gathered };
  }

  // urls: in order of preference. fetchJson(url, signal) resolves to parsed JSON.
  async function loadFeed(urls, fetchJson, deps, now, options) {
    var timeoutMs = (options && options.timeoutMs) || 6000;
    var errors = [];
    var best = null;
    for (var i = 0; i < urls.length; i += 1) {
      try {
        var raw = await withTimeout(function (signal) {
          return fetchJson(urls[i], signal);
        }, timeoutMs);
        var got = normalizeFeed(raw, deps, now);
        got.url = urls[i];
        if (!best || got.gathered > best.gathered) best = got;
        if (now - got.gathered <= STALE_MS) break; // fresh enough: do not call the fallback
      } catch (error) {
        errors.push(urls[i] + ": " + error.message);
      }
    }
    if (!best) throw new Error("no valid feed: " + errors.join("; "));
    return { snapshot: best.snapshot, url: best.url, errors: errors };
  }

  var api = { loadFeed: loadFeed, normalizeFeed: normalizeFeed, STALE_MS: STALE_MS };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.FeedSource = api;
})(typeof window !== "undefined" ? window : globalThis);
