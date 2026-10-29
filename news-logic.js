// Pure display logic for the news page: filtering, sectioning, date labels.
// No DOM access, so it can be unit-tested in Node (test/site-logic.test.js).
// Loaded as a classic script (works from file:// too) and exposed as window.NewsLogic.
(function (root) {
  "use strict";

  var HOUR = 3600000;
  var DAY = 24 * HOUR;
  var LOCAL = ["copperas-cove", "gatesville", "coryell-county"];

  var LOCATION_LABELS = {
    "copperas-cove": "Copperas Cove",
    gatesville: "Gatesville",
    "coryell-county": "Coryell County",
    "central-texas": "Central Texas",
    texas: "Texas",
  };

  var CATEGORY_LABELS = {
    government: "Government",
    schools: "Schools",
    elections: "Elections",
    "public-safety": "Public safety",
    infrastructure: "Roads & utilities",
    community: "Community",
    sports: "Sports",
    general: "General",
  };

  function storyTime(story) {
    var value = story.pubDate || story.firstSeen;
    var time = value ? Date.parse(value) : NaN;
    return isNaN(time) ? 0 : time;
  }

  // Ordering uses the real publication date only. A story whose source gave no
  // date (only a first-seen time) sorts below every dated story, so it can never
  // look newer than reporting we can actually date.
  function publishedTime(story) {
    var time = story.pubDate ? Date.parse(story.pubDate) : NaN;
    return isNaN(time) ? 0 : time;
  }

  function byNewest(a, b) {
    return publishedTime(b) - publishedTime(a);
  }

  function isLocal(story) {
    return LOCAL.indexOf(story.location) !== -1;
  }

  function matchesQuery(story, query) {
    var words = String(query || "")
      .toLowerCase()
      .split(/\s+/)
      .filter(Boolean);
    if (!words.length) return true;
    var haystack = [story.title, story.publisher, story.summary, (story.alsoReportedBy || []).join(" ")]
      .join(" ")
      .toLowerCase();
    return words.every(function (word) {
      return haystack.indexOf(word) !== -1;
    });
  }

  function isFiltering(filters) {
    return Boolean(
      (filters.q && filters.q.trim()) || filters.location || filters.category || filters.days
    );
  }

  // `days` filters on the real publication date; stories whose source gave no
  // date are left out rather than guessed at.
  function filterStories(stories, filters, now) {
    var days = Number(filters.days) || 0;
    return stories
      .filter(function (story) {
        if (filters.location === "texas") {
          if (story.location !== "texas") return false;
        } else if (filters.location && story.locations.indexOf(filters.location) === -1) {
          return false;
        }
        if (filters.category && story.categories.indexOf(filters.category) === -1) return false;
        if (days) {
          var published = story.pubDate ? Date.parse(story.pubDate) : NaN;
          if (isNaN(published) || now - published > days * DAY) return false;
        }
        return matchesQuery(story, filters.q);
      })
      .sort(function (a, b) {
        // Search results: nearer places first, then newest.
        return localRank(a) - localRank(b) || byNewest(a, b);
      });
  }

  function localRank(story) {
    if (isLocal(story)) return 0;
    if (story.location === "central-texas") return 1;
    return 2;
  }

  function newest(list, limit) {
    return list.slice().sort(byNewest).slice(0, limit);
  }

  function nonStatewide(story) {
    return story.location !== "texas";
  }

  // Which stories belong in each homepage section.
  function sectionStories(name, stories) {
    var list;
    switch (name) {
      case "latest-local": {
        var local = newest(stories.filter(isLocal), 8);
        if (local.length >= 6) return local;
        var fill = newest(
          stories.filter(function (s) {
            return s.location === "central-texas";
          }),
          6 - local.length
        );
        return local.concat(fill).sort(byNewest);
      }
      case "copperas-cove":
      case "gatesville":
      case "coryell-county":
        return newest(
          stories.filter(function (s) {
            return s.location === name;
          }),
          5
        );
      case "government":
      case "schools":
      case "public-safety":
        return newest(
          stories.filter(function (s) {
            return nonStatewide(s) && s.categories.indexOf(name) !== -1;
          }),
          5
        );
      case "elections":
        list = stories.filter(function (s) {
          return s.categories.indexOf("elections") !== -1;
        });
        return list
          .sort(function (a, b) {
            return localRank(a) - localRank(b) || byNewest(a, b);
          })
          .slice(0, 6);
      case "community":
        return newest(
          stories.filter(function (s) {
            return nonStatewide(s) && s.categories.indexOf("community") !== -1;
          }),
          6
        );
      case "texas":
        // Editorial policy: official announcements are listed ahead of news reports.
        return stories
          .filter(function (s) {
            return s.location === "texas";
          })
          .sort(function (a, b) {
            var officialA = a.kind === "official" ? 0 : 1;
            var officialB = b.kind === "official" ? 0 : 1;
            return officialA - officialB || byNewest(a, b);
          })
          .slice(0, 8);
      default:
        return [];
    }
  }

  // Human date label. Never presents an unknown date as a publication date.
  function dateLabel(story, now) {
    if (story.pubDate) {
      var published = Date.parse(story.pubDate);
      var age = now - published;
      if (age < 0) age = 0;
      if (age < HOUR) return Math.max(1, Math.round(age / 60000)) + " min ago";
      if (age < DAY) {
        var hours = Math.round(age / HOUR);
        return hours + (hours === 1 ? " hour ago" : " hours ago");
      }
      var days = Math.round(age / DAY);
      if (days < 7) return days + (days === 1 ? " day ago" : " days ago");
      return new Date(published).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/Chicago" });
    }
    return "Date not provided";
  }

  function ageText(iso, now) {
    var time = Date.parse(iso);
    if (isNaN(time)) return "";
    var minutes = Math.max(0, Math.round((now - time) / 60000));
    if (minutes < 2) return "just now";
    if (minutes < 60) return minutes + " minutes ago";
    var hours = Math.round(minutes / 60);
    if (hours < 48) return hours + (hours === 1 ? " hour ago" : " hours ago");
    return Math.round(hours / 24) + " days ago";
  }

  // The strip under the nav. It only appears for an active weather alert or a
  // local headline published in the last 24 hours, and is labeled by what it is.
  function latestBar(allStories, now) {
    // Saved copies (a source was down) are never shown as "latest" or as alerts.
    var stories = allStories.filter(function (s) {
      return !s.stale;
    });
    var alert = stories.filter(function (s) {
      return s.sourceId === "nws-alerts";
    })[0];
    if (alert) return { label: "Weather alert", story: alert };

    var recent = newest(stories.filter(isLocal), 1)[0];
    if (recent && recent.pubDate && now - Date.parse(recent.pubDate) < DAY) {
      return { label: "Latest local", story: recent };
    }
    return null;
  }

  function safeHref(url) {
    try {
      var parsed = new URL(url);
      return parsed.protocol === "https:" || parsed.protocol === "http:" ? parsed.href : "";
    } catch (error) {
      return "";
    }
  }

  // The previous Worker version (before the 2026 rewrite) returned a plain list of
  // headlines. If the Worker is ever rolled back, show them rather than an error.
  // They carry no place or topic data, so they appear only under Texas Headlines.
  function adaptLegacySnapshot(data) {
    if (!data || !Array.isArray(data.stories)) return null;
    var stories = data.stories
      .filter(function (s) {
        return s && s.title && s.link;
      })
      .map(function (s) {
        return {
          id: String(s.link),
          title: String(s.title),
          link: String(s.link),
          source: s.source || "Texas News",
          sourceId: "legacy",
          publisher: s.source || "Texas News",
          kind: s.official ? "official" : "news",
          pubDate: s.pubDate || null,
          firstSeen: null,
          location: "texas",
          locations: ["texas"],
          locationBasis: "source",
          categories: ["general"],
          summary: "",
          alsoReportedBy: [],
          stale: false,
        };
      });
    return {
      schema: 2,
      generatedAt: data.updated || new Date().toISOString(),
      stories: stories,
      health: [],
      sourcesOk: 0,
      sourcesTotal: 0,
      legacy: true,
    };
  }

  var api = {
    adaptLegacySnapshot: adaptLegacySnapshot,
    LOCAL: LOCAL,
    LOCATION_LABELS: LOCATION_LABELS,
    CATEGORY_LABELS: CATEGORY_LABELS,
    storyTime: storyTime,
    matchesQuery: matchesQuery,
    isFiltering: isFiltering,
    filterStories: filterStories,
    sectionStories: sectionStories,
    dateLabel: dateLabel,
    ageText: ageText,
    latestBar: latestBar,
    safeHref: safeHref,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.NewsLogic = api;
})(typeof window !== "undefined" ? window : globalThis);
