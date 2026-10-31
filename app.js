// The news feed is a static file published by the GitHub Actions collector (docs/ACTIONS_MIGRATION.md).
// The Cloudflare Worker is a temporary fallback; FeedSource picks the freshest valid copy.
const STATIC_FEED_URL = "https://raw.githubusercontent.com/cryptoqueen23/CORYELLCOUNTYSCOOP/data/news.json";
const RSS_WORKER_URL = "https://coryell-county-rss.truewolfflix777.workers.dev";
const FEED_URLS = [STATIC_FEED_URL, RSS_WORKER_URL];
const FEED_TIMEOUT_MS = 6000; // per request, so a slow static file cannot hold the page back for long

const SNAPSHOT_STORAGE_KEY = "messenger-snapshot-v2";
const STALE_SNAPSHOT_MINUTES = 60;
const FETCH_TIMEOUT_MS = 10000;

const logic = window.NewsLogic;

// ---- Navigation menu --------------------------------------------------------

const menuToggle = document.querySelector("#menu-toggle");
const primaryMenu = document.querySelector("#primary-menu");

function closeMenu() {
  primaryMenu.classList.remove("open");
  menuToggle.setAttribute("aria-expanded", "false");
  menuToggle.setAttribute("aria-label", "Open navigation menu");
}

menuToggle.addEventListener("click", () => {
  const isOpen = primaryMenu.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(isOpen));
  menuToggle.setAttribute("aria-label", isOpen ? "Close navigation menu" : "Open navigation menu");
});

primaryMenu.querySelectorAll("a").forEach((link) => link.addEventListener("click", closeMenu));

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && primaryMenu.classList.contains("open")) {
    closeMenu();
    menuToggle.focus();
  }
});

window.addEventListener("resize", () => {
  if (window.innerWidth > 1200) closeMenu();
});

// ---- Small helpers ----------------------------------------------------------

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function readSaved() {
  try {
    return JSON.parse(localStorage.getItem(SNAPSHOT_STORAGE_KEY));
  } catch (error) {
    return null;
  }
}

function writeSaved(snapshot) {
  try {
    localStorage.setItem(SNAPSHOT_STORAGE_KEY, JSON.stringify(snapshot));
  } catch (error) {
    // Storage can be unavailable (private mode, full); the page works without it.
  }
}

async function fetchFeedJson(url, signal) {
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function fetchJson(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---- Weather ----------------------------------------------------------------
// Current conditions come from a real station observation. The forecast is
// shown separately and labeled as a forecast; a forecast is never presented as
// a live reading.

const CHICAGO = { timeZone: "America/Chicago" };

function weatherBlock(title, lines) {
  const block = el("div", "weather-block");
  block.append(el("h3", "weather-block-title", title));
  lines.forEach((line) => block.append(line));
  return block;
}

async function latestObservation(stationsUrl) {
  const stationsData = await fetchJson(stationsUrl);
  const stations = (stationsData.features || []).slice(0, 3);

  for (const station of stations) {
    const id = station.properties && station.properties.stationIdentifier;
    if (!id) continue;
    try {
      const obs = await fetchJson(`https://api.weather.gov/stations/${id}/observations/latest`);
      const tempC = obs.properties.temperature && obs.properties.temperature.value;
      if (typeof tempC === "number") {
        return {
          station: id,
          tempF: Math.round((tempC * 9) / 5 + 32),
          conditions: obs.properties.textDescription || "",
          time: obs.properties.timestamp,
        };
      }
    } catch (error) {
      // Try the next nearby station.
    }
  }
  return null;
}

async function loadWeather() {
  const container = document.querySelector("#weather-content");
  if (!container) return;

  const nodes = [];
  try {
    // Approximate coordinates for Gatesville, Texas.
    const point = await fetchJson("https://api.weather.gov/points/31.4352,-97.7439");
    const { forecast: forecastUrl, observationStations: stationsUrl } = point.properties;

    const [forecastResult, observationResult] = await Promise.allSettled([
      fetchJson(forecastUrl),
      latestObservation(stationsUrl),
    ]);

    const observation = observationResult.status === "fulfilled" ? observationResult.value : null;
    if (observation) {
      const when = new Date(observation.time);
      const ageMinutes = Math.round((Date.now() - when.getTime()) / 60000);
      const stamp = `${observation.station}, ${when.toLocaleTimeString("en-US", { ...CHICAGO, hour: "numeric", minute: "2-digit" })}`;
      const temp = el("p", "weather-temperature", `${observation.tempF}°F`);
      const detail = el("p", "weather-detail", observation.conditions || "Conditions not reported");
      const source = el(
        "p",
        "weather-meta",
        ageMinutes > 180 ? `Last reported ${stamp} (over 3 hours old)` : `Measured at ${stamp}`
      );
      nodes.push(weatherBlock("Current conditions", [temp, detail, source]));
    } else {
      nodes.push(weatherBlock("Current conditions", [el("p", "weather-detail", "Current readings are unavailable right now.")]));
    }

    if (forecastResult.status === "fulfilled") {
      const periods = forecastResult.value.properties.periods || [];
      const lines = periods.slice(0, 2).map((period) => {
        const line = el("p", "weather-detail");
        line.append(el("strong", "", `${period.name}: `));
        line.append(document.createTextNode(`${period.temperature}°${period.temperatureUnit}, ${period.shortForecast}`));
        return line;
      });
      if (lines.length) nodes.push(weatherBlock("Forecast", lines));
    }

    if (!nodes.length) throw new Error("No weather data");
  } catch (error) {
    nodes.length = 0;
  }

  container.replaceChildren();
  if (!nodes.length) {
    const message = el("p", "", "Local weather is temporarily unavailable. ");
    const link = el("a", "", "View the National Weather Service");
    link.href = "https://forecast.weather.gov/MapClick.php?lat=31.4352&lon=-97.7439";
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    message.append(link);
    container.append(message);
    return;
  }
  container.append(...nodes);
}

// ---- News -------------------------------------------------------------------

let allStories = [];
let renderTimer;

function renderStory(story, now) {
  const article = el("article", `story story-${story.kind}`);

  const meta = el("p", "story-meta");
  const kindLabels = {
    official: "Government announcement",
    news: "News report",
    // Reserved for the Scoop's own investigations; never produced by the automatic feed.
    scoop: "Coryell County Scoop original reporting",
  };
  meta.append(el("span", `story-kind kind-${story.kind}`, kindLabels[story.kind] || kindLabels.news));
  if (story.kind === "official") meta.append(el("span", "story-kind-note", "From the agency, not independent reporting"));
  meta.append(el("span", "story-publisher", story.publisher));

  const time = el("time", "story-date", logic.dateLabel(story, now));
  if (story.pubDate) {
    time.dateTime = story.pubDate;
    time.title = new Date(story.pubDate).toLocaleString("en-US", { ...CHICAGO, dateStyle: "medium", timeStyle: "short" });
  }
  meta.append(time);
  if (story.stale) meta.append(el("span", "story-stale", "saved copy"));
  article.append(meta);

  const heading = el("h3", "story-title");
  const href = logic.safeHref(story.link);
  if (href) {
    const link = el("a", "", story.title);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.append(el("span", "visually-hidden", " (opens in a new tab)"));
    heading.append(link);
  } else {
    heading.textContent = story.title;
  }
  article.append(heading);

  if (story.summary && story.kind === "official") {
    article.append(el("p", "story-summary", story.summary));
  }

  const tags = [logic.LOCATION_LABELS[story.location]]
    .concat(story.categories.filter((c) => c !== "general").map((c) => logic.CATEGORY_LABELS[c]))
    .filter(Boolean);
  article.append(el("p", "story-tags", tags.join(" · ")));

  if (story.alsoReportedBy && story.alsoReportedBy.length) {
    article.append(el("p", "story-also", `Also reported by ${story.alsoReportedBy.slice(0, 3).join(", ")}`));
  }
  return article;
}

function fillList(container, stories, emptyMessage, now) {
  container.replaceChildren();
  if (!stories.length) {
    container.append(el("p", "empty-state", emptyMessage));
    return;
  }
  container.append(...stories.map((story) => renderStory(story, now)));
}

function currentFilters() {
  return {
    q: document.querySelector("#q").value,
    location: document.querySelector("#f-location").value,
    category: document.querySelector("#f-category").value,
    days: document.querySelector("#f-date").value,
  };
}

function render() {
  const now = Date.now();
  const filters = currentFilters();
  const filtering = logic.isFiltering(filters);
  const browse = document.querySelector("#browse");
  const results = document.querySelector("#results");

  browse.hidden = filtering;
  results.hidden = !filtering;

  if (filtering) {
    const matches = logic.filterStories(allStories, filters, now);
    fillList(
      document.querySelector("#results-list"),
      matches,
      "No current stories match. Try fewer words or clear a filter.",
      now
    );
    setResultCount(matches.length);
    return;
  }

  document.querySelectorAll("[data-section]").forEach((container) => {
    const stories = logic.sectionStories(container.dataset.section, allStories);
    fillList(container, stories, container.dataset.empty, now);
  });
  setResultCount(null);
}

let lastStatus = "";
function setResultCount(count) {
  const status = document.querySelector("#feed-status");
  const base = status.dataset.base || "";
  const text = count === null ? base : `${count} ${count === 1 ? "story matches" : "stories match"}. ${base}`;
  // Only touch the live region when the text changes, so screen readers are not re-announced.
  if (text !== lastStatus) {
    status.textContent = text;
    lastStatus = text;
  }
  // The results panel is far below the search box, so say how many matched right next to it (not a live region).
  const jump = document.querySelector("#results-jump");
  jump.hidden = count === null;
  if (count !== null) document.querySelector("#results-jump-count").textContent = `${count} ${count === 1 ? "story matches" : "stories match"}.`;
}

document.querySelector("#results-jump-link").addEventListener("click", (event) => {
  event.preventDefault();
  const heading = document.querySelector("#results-h");
  heading.scrollIntoView({ block: "start" });
  heading.focus();
});

function renderLatestBar(now) {
  const bar = document.querySelector("#latest-bar");
  const pick = logic.latestBar(allStories, now);
  bar.hidden = !pick;
  if (!pick) return;

  document.querySelector("#latest-label").textContent = pick.label;
  const text = document.querySelector("#latest-text");
  text.replaceChildren();
  const href = logic.safeHref(pick.story.link);
  if (href) {
    const link = el("a", "", pick.story.title);
    link.href = href;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    text.append(link);
  } else {
    text.append(document.createTextNode(pick.story.title));
  }
  text.append(el("span", "latest-source", ` — ${pick.story.publisher}, ${logic.dateLabel(pick.story, now)}`));
}

function renderSourceHealth(health) {
  const list = document.querySelector("#source-health-list");
  list.replaceChildren();
  const words = { ok: "Responding", stale: "Delayed, showing earlier results", failing: "Not responding, showing earlier results", pending: "Not checked yet" };
  health.forEach((entry) => {
    const item = el("li", "", `${entry.name}: ${words[entry.status] || entry.status}`);
    list.append(item);
  });
}

function showSnapshot(snapshot, { fromSavedCopy }) {
  const now = Date.now();
  allStories = Array.isArray(snapshot.stories) ? snapshot.stories.filter((s) => s && s.title && s.link) : [];
  if (fromSavedCopy) {
    // A copy from the visitor's last visit: label every story as saved, and drop
    // weather alerts, which may have expired since.
    allStories = allStories
      .filter((s) => s.sourceId !== "nws-alerts")
      .map((s) => Object.assign({}, s, { stale: true }));
  }

  const ageMinutes = (now - Date.parse(snapshot.generatedAt)) / 60000;
  const updated = new Date(snapshot.generatedAt).toLocaleString("en-US", {
    ...CHICAGO,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

  const status = document.querySelector("#feed-status");
  status.dataset.base = `Headlines updated ${updated} Central (${logic.ageText(snapshot.generatedAt, now)}).${snapshot.legacy ? "" : ` ${snapshot.sourcesOk} of ${snapshot.sourcesTotal} sources responding.`}`;
  lastStatus = "";

  const notice = document.querySelector("#feed-notice");
  let message = "";
  if (fromSavedCopy) {
    message = "We could not reach the news service, so this is a saved copy from your last visit. Stories may be out of date.";
  } else if (ageMinutes > (snapshot.staleAfterMinutes || STALE_SNAPSHOT_MINUTES)) {
    message = "The news service has not refreshed recently. These stories were last gathered " + logic.ageText(snapshot.generatedAt, now) + ".";
  }
  notice.textContent = message;
  notice.hidden = !message;

  renderLatestBar(now);
  renderSourceHealth(Array.isArray(snapshot.health) ? snapshot.health : []);
  render();
}

function showLoadError() {
  document.querySelector("#feed-status").textContent = "";
  const notice = document.querySelector("#feed-notice");
  notice.replaceChildren(
    document.createTextNode("Headlines are temporarily unavailable. "),
    Object.assign(el("button", "link-button", "Try again"), { type: "button", onclick: () => loadHeadlines() })
  );
  notice.hidden = false;
  document.querySelectorAll("[data-section]").forEach((container) => {
    container.replaceChildren(el("p", "empty-state", "Headlines could not be loaded."));
  });
}

async function loadHeadlines() {
  try {
    const { snapshot } = await window.FeedSource.loadFeed(
      FEED_URLS,
      fetchFeedJson,
      { build: window.FeedBuild.build, adaptLegacy: logic.adaptLegacySnapshot },
      Date.now(),
      { timeoutMs: FEED_TIMEOUT_MS }
    );
    writeSaved(snapshot);
    showSnapshot(snapshot, { fromSavedCopy: false });
  } catch (error) {
    console.error(error);
    const saved = readSaved();
    if (saved && Array.isArray(saved.stories)) showSnapshot(saved, { fromSavedCopy: true });
    else showLoadError();
  }
}

// ---- Search & filters -------------------------------------------------------

const filterForm = document.querySelector("#filters");
filterForm.addEventListener("submit", (event) => event.preventDefault());
filterForm.addEventListener("input", () => {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 150);
});
document.querySelector("#reset-filters").addEventListener("click", () => {
  filterForm.reset();
  render();
  document.querySelector("#q").focus();
});

// ---- Start ------------------------------------------------------------------

document.querySelector("#year").textContent = new Date().getFullYear();
loadWeather();
loadHeadlines();

// Tell assistive technology which links open a new tab. Runs again whenever the page content changes
// (stories and configured links are added after load); it skips links that already say so.
function markNewTabLinks() {
  document.querySelectorAll('a[target="_blank"]').forEach((link) => {
    if (link.querySelector(".visually-hidden") || /opens in/i.test(link.textContent)) return;
    link.append(el("span", "visually-hidden", " (opens in a new tab)"));
  });
}
markNewTabLinks();
let newTabTimer;
new MutationObserver(() => {
  clearTimeout(newTabTimer);
  newTabTimer = setTimeout(markNewTabLinks, 100);
}).observe(document.body, { childList: true, subtree: true });

// ---- Insurance section configuration ----------------------------------------
// Text and links come from site-config.json so they can be changed without
// touching code. The HTML contains the same values as defaults, so the section
// still works if the file cannot be loaded.

function configValue(config, path) {
  return path.split(".").reduce((node, key) => (node && typeof node === "object" ? node[key] : undefined), config);
}

function safeConfigHref(url) {
  try {
    const parsed = new URL(url);
    return ["https:", "tel:", "mailto:"].includes(parsed.protocol) ? parsed.href : "";
  } catch (error) {
    return "";
  }
}

async function applySiteConfig() {
  let config;
  try {
    const response = await fetch("site-config.json", { cache: "no-cache" });
    if (!response.ok) return;
    config = await response.json();
  } catch (error) {
    return;
  }

  if (configValue(config, "insurance.enabled") === false) {
    document.querySelectorAll("[data-insurance]").forEach((node) => {
      node.hidden = true;
    });
    return;
  }

  document.querySelectorAll("[data-cfg-text]").forEach((node) => {
    const value = configValue(config, node.dataset.cfgText);
    if (typeof value === "string" && value.trim()) node.textContent = value;
  });

  document.querySelectorAll("[data-cfg-href]").forEach((node) => {
    const value = configValue(config, node.dataset.cfgHref);
    // An empty string removes that button (for example, to take the phone number off the site).
    if (value === "") {
      (node.closest("li") || node).hidden = true;
      return;
    }
    const href = safeConfigHref(value);
    if (href) node.href = href;
  });
}

applySiteConfig();
