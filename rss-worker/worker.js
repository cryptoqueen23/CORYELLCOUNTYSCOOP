// Cloudflare Worker: fetches approved RSS/Atom feeds, converts them to JSON,
// and serves the latest headlines to The Coryell County Messenger.
// No database. Results are cached at Cloudflare's edge for CACHE_TTL_SECONDS.

// Official government/agency sources always rank ahead of media outlets —
// see the editorial policy in CLAUDE.md. Plain RSS/Atom feeds go here.
const OFFICIAL_FEEDS = [
  { name: "Coryell County Sheriff's Office", url: "https://coryellcountysheriff.com/feed/" },
  { name: "City of Copperas Cove", url: "https://www.copperascovetx.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml" },
  { name: "Texas Department of Public Safety", url: "https://www.dps.texas.gov/rss/dps-news.xml" },
  { name: "Office of the Governor", url: "https://gov.texas.gov/news/rss" },
  { name: "Texas Secretary of State", url: "https://www.sos.state.tx.us/rss/press.xml" },
];

// Media outlets supplement official information — they never outrank it.
// Center-right per editorial policy; see CLAUDE.md for why Texas Tribune
// and KSAT were dropped.
const MEDIA_FEEDS = [
  { name: "KWTX Central Texas", url: "https://www.kwtx.com/arc/outboundfeeds/rss/?outputType=xml" },
  { name: "Texas Scorecard", url: "https://texasscorecard.com/feed/" },
  { name: "The Texan", url: "https://thetexan.news/search/?f=rss&t=article&l=20&s=start_time&sd=desc" },
];

// A normal browser-style UA — some government sites bot-block the default
// Workers UA on otherwise-public, unauthenticated pages.
const BROWSER_USER_AGENT =
  "Mozilla/5.0 (compatible; CoryellCountyMessengerBot/1.0; +https://www.coryellcountyhub.xyz/)";

// Sites allowed to call this Worker from the browser.
const ALLOWED_ORIGINS = new Set([
  "https://www.coryellcountyhub.xyz",
  "https://coryellcountyhub.xyz",
  "https://coryellcountyscoop.vercel.app",
]);

const CACHE_TTL_SECONDS = 15 * 60;
const MAX_STORIES = 12;

// Stories that name a Texas candidate always qualify for "Election Watch".
// Generic election terms ("primary", "campaign", etc.) also need to mention
// Texas, since wire stories about other states' races use the same words.
const TEXAS_CANDIDATE_KEYWORDS = ["talarico", "paxton", "abbott", "ted cruz", "colin allred", "wesley hunt"];

const GENERIC_ELECTION_KEYWORDS = [
  "election",
  "midterm",
  "primary",
  "runoff",
  "ballot",
  "voter",
  "senate race",
  "governor's race",
  "super pac",
];

// Stories added by hand instead of pulled live from a feed — for coverage
// worth keeping visible even after it scrolls off the source feed.
const PINNED_ELECTION_STORIES = [
  {
    title: "Billionaire Reid Hoffman gives $10 million to super PAC backing Talarico's Senate bid in Texas",
    link: "https://www.ksat.com/news/texas/2026/07/16/billionaire-reid-hoffman-gives-10-million-to-super-pac-backing-talaricos-senate-bid-in-texas",
    pubDate: "2026-07-16T13:57:00-05:00",
    source: "KSAT San Antonio",
  },
];

// These two sources are a candidate's own office — their press releases
// mention that name constantly just doing routine government business
// ("Governor Abbott Appoints...", "AG Paxton Settles..."), which isn't
// midterm coverage. For these, require an actual election term too.
const SELF_SOURCE_CANDIDATE = new Map([
  ["Texas Attorney General", "paxton"],
  ["Office of the Governor", "abbott"],
]);

// Plain .includes() false-positives on word fragments — "election" matches
// inside "Selection", "voter" inside "devoted", etc. Word-boundary regex
// avoids that ("Phase II Selection Process" incorrectly matched "election"
// before this fix).
function containsWord(text, phrase) {
  const escaped = phrase.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`\\b${escaped}\\b`, "i").test(text);
}

function isElectionStory(title, source) {
  const hasGenericTerm = GENERIC_ELECTION_KEYWORDS.some((keyword) => containsWord(title, keyword));
  const nameMatch = TEXAS_CANDIDATE_KEYWORDS.some((keyword) => containsWord(title, keyword));

  const selfCandidate = SELF_SOURCE_CANDIDATE.get(source);
  const isSelfReferential = selfCandidate && containsWord(title, selfCandidate) && !hasGenericTerm;

  if (nameMatch && !isSelfReferential) {
    return true;
  }

  return hasGenericTerm && containsWord(title, "texas");
}

// Keeps one source from flooding the general headlines list — most useful
// for scraped sources like TxDOT that get synthetic near-now timestamps.
function capPerSource(stories, cap) {
  const counts = new Map();
  const result = [];

  for (const story of stories) {
    const count = counts.get(story.source) || 0;
    if (count < cap) {
      result.push(story);
      counts.set(story.source, count + 1);
    }
  }

  return result;
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = buildCorsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const cache = caches.default;
    const cacheKey = new Request(new URL("/texas-headlines-v7", request.url).toString());

    let bodyText;
    const cached = await cache.match(cacheKey);

    if (cached) {
      bodyText = await cached.text();
    } else {
      const { stories, electionStories } = await fetchAllFeeds();
      bodyText = JSON.stringify({ updated: new Date().toISOString(), stories, electionStories });

      const cacheResponse = new Response(bodyText, {
        headers: {
          "Content-Type": "application/json",
          "Cache-Control": `public, max-age=${CACHE_TTL_SECONDS}`,
        },
      });

      ctx.waitUntil(cache.put(cacheKey, cacheResponse));
    }

    return new Response(bodyText, {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  },
};

function buildCorsHeaders(origin) {
  const headers = { Vary: "Origin" };

  if (ALLOWED_ORIGINS.has(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  headers["Access-Control-Allow-Methods"] = "GET, OPTIONS";
  headers["Access-Control-Allow-Headers"] = "Content-Type";

  return headers;
}

function byDateDesc(a, b) {
  return new Date(b.pubDate || 0) - new Date(a.pubDate || 0);
}

async function fetchXmlFeed(feed) {
  const response = await fetch(feed.url, {
    headers: { "User-Agent": "CoryellCountyMessengerBot/1.0" },
  });

  if (!response.ok) {
    throw new Error(`Feed request failed: ${feed.name}`);
  }

  const xml = await response.text();
  return parseFeed(xml, feed.name);
}

async function settledStories(tasks) {
  const results = await Promise.allSettled(tasks);
  return results.filter((result) => result.status === "fulfilled").flatMap((result) => result.value);
}

async function fetchAllFeeds() {
  const officialStories = (
    await settledStories([
      ...OFFICIAL_FEEDS.map((feed) => fetchXmlFeed(feed)),
      fetchGatesvilleNews(),
      fetchTxDotNews(),
      fetchAgReleases(),
      fetchWeatherAlerts(),
    ])
  ).map((story) => ({ ...story, official: true }));

  const mediaStories = (await settledStories(MEDIA_FEEDS.map((feed) => fetchXmlFeed(feed)))).map((story) => ({
    ...story,
    official: false,
  }));

  officialStories.sort(byDateDesc);
  mediaStories.sort(byDateDesc);

  // Election Watch draws from the full, uncapped pool for best recall.
  const fullStoryPool = [...officialStories, ...mediaStories];

  // The general headlines list caps each official source so one prolific
  // feed (TxDOT's synthetic near-now timestamps, especially) can't crowd
  // out every other source. Official sources still rank ahead of media,
  // regardless of exact timestamp — see the editorial policy in CLAUDE.md.
  const generalStoryPool = [...capPerSource(officialStories, 3), ...mediaStories];

  const liveElectionStories = fullStoryPool.filter((story) => isElectionStory(story.title, story.source));

  const pinnedLinks = new Set(PINNED_ELECTION_STORIES.map((story) => story.link));
  const electionStories = [
    ...PINNED_ELECTION_STORIES,
    ...liveElectionStories.filter((story) => !pinnedLinks.has(story.link)),
  ];

  return {
    stories: generalStoryPool.slice(0, MAX_STORIES),
    electionStories: electionStories.slice(0, MAX_STORIES),
  };
}

// The City of Gatesville has no RSS feed, but its site loads news from this
// JSON endpoint client-side. It's an object keyed by article ID, not an
// array.
async function fetchGatesvilleNews() {
  const response = await fetch("https://www.gatesvilletx.com/_includes_/published/news_list.json", {
    headers: { "User-Agent": BROWSER_USER_AGENT },
  });

  if (!response.ok) {
    throw new Error("Gatesville news request failed");
  }

  const data = await response.json();

  return Object.values(data)
    .filter((item) => item.title && item.link)
    .map((item) => {
      const parsedDate = item.date ? new Date(item.date) : null;
      return {
        title: item.title,
        link: `https://www.gatesvilletx.com${item.link}`,
        pubDate: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
        source: "City of Gatesville",
      };
    });
}

// TxDOT has no RSS feed. Their statewide newsroom listing is server-rendered
// but doesn't show a date per item (only the individual article page does,
// and fetching every article would be too heavy for a "lightweight" Worker),
// so these are timestamped at fetch time — the listing itself is already in
// newest-first order.
async function fetchTxDotNews() {
  const response = await fetch("https://www.txdot.gov/about/newsroom/statewide.html", {
    headers: { "User-Agent": BROWSER_USER_AGENT },
  });

  if (!response.ok) {
    throw new Error("TxDOT newsroom request failed");
  }

  const html = await response.text();
  const linkPattern =
    /<a class="cmp-list__item-link" href="([^"]+)">\s*<span class="cmp-list__item-title">([^<]+)<\/span>/g;

  const stories = [];
  const now = new Date();
  let match;
  let index = 0;

  while ((match = linkPattern.exec(html)) !== null) {
    const [, href, title] = match;
    stories.push({
      title: decodeEntities(title.trim()),
      link: href.startsWith("http") ? href : `https://www.txdot.gov${href}`,
      // Nudge each item a minute earlier than the last so list order (already
      // newest-first on TxDOT's page) survives the later date-based sort.
      pubDate: new Date(now.getTime() - index * 60000).toISOString(),
      source: "TxDOT",
    });
    index += 1;
  }

  return stories;
}

// The Texas Attorney General's office has no RSS feed either. Their press
// release listing is server-rendered with a real publish date per item.
async function fetchAgReleases() {
  const response = await fetch("https://www.texasattorneygeneral.gov/news/releases", {
    headers: { "User-Agent": BROWSER_USER_AGENT },
  });

  if (!response.ok) {
    throw new Error("Texas Attorney General newsroom request failed");
  }

  const html = await response.text();
  const blocks = html.match(/<div class="m-b-3">[\s\S]*?<\/div>/g) || [];

  const stories = [];

  for (const block of blocks) {
    const titleMatch = block.match(/<h4[^>]*><a href="([^"]+)">([^<]+)<\/a><\/h4>/);
    if (!titleMatch) continue;

    const dateMatch = block.match(/<p class="meta m-b-0">\s*([^|<]+)\|/);
    const parsedDate = dateMatch ? new Date(dateMatch[1].trim()) : null;

    stories.push({
      // Their CMS inserts soft hyphens (­) into titles for line-break
      // hinting — strip them or words end up looking broken-mid-word.
      title: decodeEntities(titleMatch[2].replace(/­/g, "").trim()),
      link: `https://www.texasattorneygeneral.gov${titleMatch[1]}`,
      pubDate: parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null,
      source: "Texas Attorney General",
    });
  }

  return stories;
}

// Active NWS weather alerts for Coryell County (zone TXZ157) — usually
// empty, which is fine; it just contributes no stories that day.
async function fetchWeatherAlerts() {
  const response = await fetch("https://api.weather.gov/alerts/active?zone=TXZ157", {
    headers: { "User-Agent": "CoryellCountyMessengerBot/1.0" },
  });

  if (!response.ok) {
    throw new Error("NWS alerts request failed");
  }

  const data = await response.json();

  return (data.features || []).map((feature) => ({
    title: feature.properties.headline || feature.properties.event,
    link: "https://www.weather.gov/fwd/",
    pubDate: feature.properties.sent || feature.properties.effective || null,
    source: "National Weather Service",
  }));
}

function parseFeed(xml, sourceName) {
  const isAtom = /<feed[\s>]/i.test(xml) && !/<rss[\s>]/i.test(xml);
  const itemTag = isAtom ? "entry" : "item";
  const itemPattern = new RegExp(`<${itemTag}[\\s\\S]*?<\\/${itemTag}>`, "gi");
  const blocks = xml.match(itemPattern) || [];

  const stories = [];

  for (const block of blocks) {
    const title = decodeEntities(extractTag(block, "title"));
    const link = isAtom ? extractAtomLink(block) : decodeEntities(extractTag(block, "link"));
    const pubDateRaw = extractTag(block, isAtom ? "published" : "pubDate") || extractTag(block, "updated");
    const parsedDate = pubDateRaw ? new Date(pubDateRaw) : null;
    const pubDate = parsedDate && !Number.isNaN(parsedDate.getTime()) ? parsedDate.toISOString() : null;

    if (title && link) {
      stories.push({ title, link, pubDate, source: sourceName });
    }
  }

  return stories;
}

function extractTag(xmlBlock, tag) {
  const match = xmlBlock.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i"));

  if (!match) return "";

  return match[1]
    .replace(/^<!\[CDATA\[/, "")
    .replace(/\]\]>$/, "")
    .trim();
}

function extractAtomLink(xmlBlock) {
  const match = xmlBlock.match(/<link[^>]*rel="alternate"[^>]*href="([^"]+)"/i)
    || xmlBlock.match(/<link[^>]*href="([^"]+)"[^>]*\/?>/i);

  return match ? match[1] : "";
}

function decodeEntities(text) {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCharCode(parseInt(hex, 16)));
}
