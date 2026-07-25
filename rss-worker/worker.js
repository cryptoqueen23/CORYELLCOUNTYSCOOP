// Cloudflare Worker: fetches approved RSS/Atom feeds, converts them to JSON,
// and serves the latest headlines to The Coryell County Messenger.
// No database. Results are cached at Cloudflare's edge for CACHE_TTL_SECONDS.

const APPROVED_FEEDS = [
  { name: "KWTX Central Texas", url: "https://www.kwtx.com/arc/outboundfeeds/rss/?outputType=xml" },
  { name: "KSAT San Antonio", url: "https://www.ksat.com/arc/outboundfeeds/rss/?outputType=xml" },
];

// Sites allowed to call this Worker from the browser.
const ALLOWED_ORIGINS = new Set([
  "https://www.coryellcountyhub.xyz",
  "https://coryellcountyhub.xyz",
  "https://coryellcountyscoop.vercel.app",
]);

const CACHE_TTL_SECONDS = 15 * 60;
const MAX_STORIES = 8;

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
  "candidate",
  "voter",
  "senate race",
  "governor's race",
  "campaign",
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

function isElectionStory(title) {
  const lower = title.toLowerCase();

  if (TEXAS_CANDIDATE_KEYWORDS.some((keyword) => lower.includes(keyword))) {
    return true;
  }

  const hasGenericTerm = GENERIC_ELECTION_KEYWORDS.some((keyword) => lower.includes(keyword));
  return hasGenericTerm && lower.includes("texas");
}

export default {
  async fetch(request, env, ctx) {
    const origin = request.headers.get("Origin") || "";
    const corsHeaders = buildCorsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    const cache = caches.default;
    const cacheKey = new Request(new URL("/texas-headlines-v4", request.url).toString());

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

async function fetchAllFeeds() {
  const results = await Promise.allSettled(
    APPROVED_FEEDS.map(async (feed) => {
      const response = await fetch(feed.url, {
        headers: { "User-Agent": "CoryellCountyMessengerBot/1.0" },
      });

      if (!response.ok) {
        throw new Error(`Feed request failed: ${feed.name}`);
      }

      const xml = await response.text();
      return parseFeed(xml, feed.name);
    })
  );

  const allStories = results
    .filter((result) => result.status === "fulfilled")
    .flatMap((result) => result.value);

  allStories.sort((a, b) => new Date(b.pubDate || 0) - new Date(a.pubDate || 0));

  const liveElectionStories = allStories.filter((story) => isElectionStory(story.title));

  const pinnedLinks = new Set(PINNED_ELECTION_STORIES.map((story) => story.link));
  const electionStories = [
    ...PINNED_ELECTION_STORIES,
    ...liveElectionStories.filter((story) => !pinnedLinks.has(story.link)),
  ];

  return {
    stories: allStories.slice(0, MAX_STORIES),
    electionStories: electionStories.slice(0, MAX_STORIES),
  };
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
    .replace(/&#0?39;/g, "'");
}
