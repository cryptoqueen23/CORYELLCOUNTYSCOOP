// Network layer: one fetcher per source type. Each returns raw items
// ({ title, link, pubDate, publisher, summary }) or throws. Source failures are
// isolated by the caller.

import { cleanText, decodeEntities, parseDate, parseFeed, safeUrl } from "./parse.js";
import { isAllowedHost } from "./sources.js";

const USER_AGENT = "Mozilla/5.0 (compatible; CoryellCountyMessengerBot/2.0; +https://www.coryellcountyhub.xyz/)";
const TIMEOUT_MS = 8000;
const MAX_BYTES = 1_500_000;
const RETRY_DELAY_MS = 700;
const FEED_HEAD_CHARS = 90_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// Reads at most `limit` characters of the body and abandons the rest, so large
// feeds cost neither download time nor CPU beyond the part we use.
async function readHead(response, limit) {
  if (!response.body) return (await response.text()).slice(0, limit);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (text.length < limit) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await reader.cancel().catch(() => {});
  return text.slice(0, limit);
}

class FetchError extends Error {
  constructor(message, retryable) {
    super(message);
    this.retryable = retryable;
  }
}

async function fetchOnce(url, accept, headChars = MAX_BYTES) {
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" || !isAllowedHost(parsed.hostname)) {
    throw new FetchError(`blocked host ${parsed.hostname}`, false);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": USER_AGENT, Accept: accept },
      signal: controller.signal,
      redirect: "follow",
    });

    // A redirect may only land on another approved host.
    if (response.url && !isAllowedHost(new URL(response.url).hostname)) {
      throw new FetchError(`redirected to unapproved host ${new URL(response.url).hostname}`, false);
    }
    if (!response.ok) {
      throw new FetchError(`HTTP ${response.status}`, response.status >= 500);
    }

    return await readHead(response, headChars);
  } catch (error) {
    if (error instanceof FetchError) throw error;
    // Network errors and timeouts are worth one retry.
    throw new FetchError(error.name === "AbortError" ? "timeout" : String(error.message || error), true);
  } finally {
    clearTimeout(timer);
  }
}

// Reasonable timeout plus one retry with backoff for transient failures only.
export async function fetchText(url, accept = "*/*", headChars = MAX_BYTES) {
  try {
    return await fetchOnce(url, accept, headChars);
  } catch (error) {
    if (!error.retryable) throw error;
    await sleep(RETRY_DELAY_MS);
    return fetchOnce(url, accept, headChars);
  }
}

const XML_ACCEPT = "application/rss+xml, application/atom+xml, application/xml;q=0.9, text/xml;q=0.8";

async function fetchRss(source, now) {
  const xml = await fetchText(source.url, XML_ACCEPT, source.headChars || FEED_HEAD_CHARS);
  // Newest items come first in every feed we use; the head of the document is enough
  // and keeps parsing within the free-plan CPU budget.
  // Only about `cap` items are ever kept, so only that many (plus a few spares for
  // blocked or too-old items) are parsed. Summaries are shown for official items only.
  const items = parseFeed(xml, { maxItems: (source.cap || 15) + 5, now, summaries: true });
  if (!items.length && !/<(rss|feed|rdf)[\s>]/i.test(xml)) {
    throw new FetchError("response was not a feed", false);
  }
  return items;
}

// Google News search results: the real publisher arrives in <source>.
async function fetchGoogleNews(source, now) {
  const items = await fetchRss(source, now);
  return items.map((item) => ({ ...item, summary: "" }));
}

// City of Gatesville has no RSS; its own site reads this JSON (object keyed by id).
async function fetchGatesville(source, now) {
  const data = JSON.parse(await fetchText(source.url, "application/json"));
  return Object.values(data)
    .filter((item) => item && item.title && item.link)
    .map((item) => ({
      title: cleanText(item.title),
      link: safeUrl(item.link, "https://www.gatesvilletx.com"),
      pubDate: parseDate(item.date, now),
      publisher: "",
      summary: cleanText(item.brief || "", 200),
    }))
    .filter((item) => item.title && item.link);
}

// TxDOT's newsroom listing shows no per-item date. Dates stay null on
// purpose: the Worker records when it first saw each link and labels it as
// such, never presenting it as a publication date.
async function fetchTxDot(source) {
  const html = await fetchText(source.url, "text/html", source.headChars);
  const pattern = /<a class="cmp-list__item-link" href="([^"]+)">\s*<span class="cmp-list__item-title">([^<]+)<\/span>/g;
  const items = [];
  let match;
  while ((match = pattern.exec(html)) !== null && items.length < 20) {
    const link = safeUrl(match[1], "https://www.txdot.gov");
    const title = cleanText(match[2]);
    if (link && title) items.push({ title, link, pubDate: null, publisher: "", summary: "" });
  }
  if (!items.length) throw new FetchError("no items found (page layout may have changed)", false);
  return items;
}

// Texas Attorney General press releases: server-rendered with real dates.
async function fetchAttorneyGeneral(source, now) {
  const html = await fetchText(source.url, "text/html", source.headChars);
  const blocks = html.match(/<div class="m-b-3">[\s\S]*?<\/div>/g) || [];
  const items = [];

  for (const block of blocks) {
    const titleMatch = block.match(/<h4[^>]*><a href="([^"]+)">([^<]+)<\/a><\/h4>/);
    if (!titleMatch) continue;
    const dateMatch = block.match(/<p class="meta m-b-0">\s*([^|<]+)\|/);
    const link = safeUrl(titleMatch[1], "https://www.texasattorneygeneral.gov");
    const title = cleanText(decodeEntities(titleMatch[2]));
    if (link && title) {
      items.push({ title, link, pubDate: parseDate(dateMatch?.[1], now), publisher: "", summary: "" });
    }
  }

  if (!items.length) throw new FetchError("no items found (page layout may have changed)", false);
  return items;
}

// Active NWS alerts for Coryell County (zone TXZ157). An empty list is the
// normal, healthy state.
async function fetchWeatherAlerts(source, now) {
  const data = JSON.parse(await fetchText(source.url, "application/geo+json"));
  return (data.features || [])
    .map((feature) => {
      const p = feature.properties || {};
      return {
        title: cleanText(p.headline || p.event || ""),
        link: "https://www.weather.gov/fwd/",
        pubDate: parseDate(p.sent || p.effective, now),
        expires: parseDate(p.expires || p.ends, now + 400 * 24 * 3_600_000),
        alert: true,
        publisher: "",
        summary: cleanText(p.event || "", 120),
      };
    })
    .filter((item) => item.title);
}

const FETCHERS = {
  rss: fetchRss,
  gnews: fetchGoogleNews,
  gatesville: fetchGatesville,
  txdot: fetchTxDot,
  ag: fetchAttorneyGeneral,
  nws: fetchWeatherAlerts,
};

// Runs one source; never throws. Errors come back as { ok: false }.
export async function runSource(source, now) {
  try {
    return { ok: true, items: await FETCHERS[source.fetcher](source, now) };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
}
