// Feed parsing and text/date/URL sanitizing. Pure functions, no network.

const NAMED_ENTITIES = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  shy: "",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  ndash: "–",
  mdash: "—",
  hellip: "…",
};

export function decodeEntities(text) {
  return String(text ?? "").replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, body) => {
    if (body[0] === "#") {
      const code = body[1].toLowerCase() === "x" ? parseInt(body.slice(2), 16) : Number(body.slice(1));
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : "";
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
  });
}

// Feed text is untrusted. Output is plain text only: tags removed, entities
// decoded once, whitespace collapsed, soft hyphens and control chars dropped.
export function cleanText(raw, maxLength = 300) {
  let text = String(raw ?? "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ");
  text = decodeEntities(text);
  // Entities can decode into markup-looking text; strip tags a second time.
  text = text.replace(/<[^>]*>/g, " ");
  text = text
    // Soft hyphens and zero-width spaces are invisible: remove, don't space out.
    .replace(/[­​‌‍﻿]/g, "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return text.length > maxLength ? `${text.slice(0, maxLength - 1).trimEnd()}…` : text;
}

// Only absolute http(s) URLs without embedded credentials survive.
export function safeUrl(raw, base) {
  try {
    const url = new URL(decodeEntities(String(raw ?? "")).trim(), base);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch {
    return "";
  }
}

// Some feeds stamp current items with a bogus year (the Texas Secretary of State
// feed uses 2001). A date that implausible is treated as missing, not repaired.
const MIN_YEAR = 2010;
const FUTURE_TOLERANCE_MS = 10 * 60 * 1000;

// Returns an ISO string, or null when the date is missing, unparseable, or
// implausible (far past, or in the future — a bad feed clock must never push a
// story to the top).
export function parseDate(raw, now = Date.now()) {
  if (!raw) return null;
  let text = String(raw).trim();
  // Dates without a zone ("October 28, 2026") would otherwise depend on the
  // runtime's time zone; pin them to UTC so results are the same everywhere.
  const isIso = /^\d{4}-\d\d-\d\d/.test(text);
  const hasZone = /(?:Z|GMT|UTC|[+-]\d{2}:?\d{2}|\b[A-Z]{2,4})$/.test(text);
  if (!isIso && !hasZone) text += " UTC";
  const parsed = new Date(text);
  const time = parsed.getTime();
  if (Number.isNaN(time)) return null;
  if (parsed.getUTCFullYear() < MIN_YEAR) return null;
  if (time > now + FUTURE_TOLERANCE_MS) return null;
  return parsed.toISOString();
}

function extractTag(block, tag) {
  const match = block.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, "i"));
  return match ? match[1].trim() : "";
}

function extractAtomLink(block) {
  const alternate =
    block.match(/<link[^>]*\brel=["']alternate["'][^>]*\bhref=["']([^"']+)["']/i) ||
    block.match(/<link[^>]*\bhref=["']([^"']+)["'][^>]*\brel=["']alternate["']/i) ||
    block.match(/<link[^>]*\bhref=["']([^"']+)["'][^>]*>/i);
  return alternate ? alternate[1] : "";
}

// Parses RSS 2.0, RSS 1.0-style, and Atom. Returns raw (unfiltered) items.
// `maxItems` bounds CPU on very large feeds (the Secretary of State feed has
// 400+ items, almost all years old).
export function parseFeed(xml, { maxItems = 40, now = Date.now(), summaries = true } = {}) {
  const text = String(xml ?? "");
  const isAtom = /<feed[\s>]/i.test(text) && !/<rss[\s>]/i.test(text);
  const tag = isAtom ? "entry" : "item";
  const pattern = new RegExp(`<${tag}[\\s>][\\s\\S]*?</${tag}>`, "gi");

  const items = [];
  let match;
  while ((match = pattern.exec(text)) !== null && items.length < maxItems) {
    const block = match[0];
    const title = cleanText(extractTag(block, "title"));
    const link = safeUrl(isAtom ? extractAtomLink(block) : cleanRawLink(extractTag(block, "link")));
    if (!title || !link) continue;

    const dateRaw = isAtom
      ? extractTag(block, "published") || extractTag(block, "updated")
      : extractTag(block, "pubDate") || extractTag(block, "dc:date");

    const sourceMatch = block.match(/<source[^>]*>([\s\S]*?)<\/source>/i);

    items.push({
      title,
      link,
      pubDate: parseDate(cleanText(dateRaw, 80), now),
      publisher: sourceMatch ? cleanText(sourceMatch[1], 120) : "",
      summary: summaries ? cleanText(extractTag(block, isAtom ? "summary" : "description"), 200) : "",
    });
  }
  return items;
}

function cleanRawLink(raw) {
  return String(raw).replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "").trim();
}

// Google News appends " - Publisher" to every title.
export function stripPublisherSuffix(title, publisher) {
  if (!publisher) return title;
  const suffix = ` - ${publisher}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}
