// Source registry. Every outbound request is checked against the hostnames of
// these URLs (see fetchers.js), so adding a source here is the only way to
// make the Worker fetch from a new host. Documented in ../SOURCES.md.
//
// Fields
//   kind          "official" (government announcement) | "news" (published reporting)
//   scope         coverage area used when the story itself doesn't say: a LOCATION_ORDER id
//   localOfficial true when every item from this source is local by definition (a city, the sheriff)
//   localOutlet   true for a newspaper whose whole beat is `scope` (Leader Press, Gatesville Messenger)
//   texasFocused  true when the outlet is Texas-only (so a bare election word is Texas election news)
//   hint          Google News searches only: the place the search was for (weak signal)
//   refreshMinutes how often this source is fetched. Must divide 120 and be a multiple of 2
//                 (the schedule repeats every 4 hours, one source per 2-minute cron tick).
//   maxAgeDays    items older than this are not shown
//   cap           most items one source may contribute (also how many are saved)
//   headChars     only this many characters of the response are read (newest items come first)

export const SOURCES = [
  // ---- Official: local ----------------------------------------------------
  {
    id: "cove-city",
    name: "City of Copperas Cove",
    kind: "official",
    fetcher: "rss",
    url: "https://www.copperascovetx.gov/RSSFeed.aspx?ModID=1&CID=All-newsflash.xml",
    scope: "copperas-cove",
    localOfficial: true,
    refreshMinutes: 30,
    maxAgeDays: 45,
    cap: 15,
    headChars: 30000,
  },
  {
    id: "gatesville-city",
    name: "City of Gatesville",
    kind: "official",
    fetcher: "gatesville",
    url: "https://www.gatesvilletx.com/_includes_/published/news_list.json",
    scope: "gatesville",
    localOfficial: true,
    refreshMinutes: 60,
    maxAgeDays: 45,
    cap: 15,
  },
  {
    id: "coryell-sheriff",
    name: "Coryell County Sheriff's Office",
    kind: "official",
    fetcher: "rss",
    url: "https://coryellcountysheriff.com/feed/",
    scope: "coryell-county",
    localOfficial: true,
    refreshMinutes: 120,
    maxAgeDays: 45,
    cap: 10,
    headChars: 30000,
  },
  {
    id: "nws-alerts",
    name: "National Weather Service",
    kind: "official",
    fetcher: "nws",
    url: "https://api.weather.gov/alerts/active?zone=TXZ157",
    scope: "coryell-county",
    localOfficial: true,
    refreshMinutes: 20,
    maxAgeDays: 2,
    cap: 5,
  },

  // ---- News: local newspapers (direct publisher feeds) ----------------------
  {
    id: "leader-press",
    name: "Copperas Cove Leader Press",
    kind: "news",
    fetcher: "rss",
    url: "https://www.coveleaderpress.com/rss.xml",
    scope: "copperas-cove",
    localOutlet: true,
    refreshMinutes: 30,
    maxAgeDays: 21,
    cap: 15,
    headChars: 40000,
  },
  {
    id: "gatesville-messenger",
    name: "The Gatesville Messenger",
    kind: "news",
    fetcher: "rss",
    url: "https://www.gatesvillemessenger.com/rss.xml",
    scope: "gatesville",
    localOutlet: true,
    refreshMinutes: 60,
    maxAgeDays: 21,
    cap: 15,
    headChars: 40000,
  },

  // ---- News: regional ---------------------------------------------------------
  {
    id: "fox44",
    name: "KWKT Fox 44",
    kind: "news",
    fetcher: "rss",
    url: "https://www.fox44news.com/feed/",
    scope: "central-texas",
    refreshMinutes: 60,
    maxAgeDays: 7,
    cap: 12,
    headChars: 45000,
  },
  {
    id: "kwtx",
    name: "KWTX",
    kind: "news",
    fetcher: "rss",
    url: "https://www.kwtx.com/arc/outboundfeeds/rss/?outputType=xml",
    scope: "central-texas",
    refreshMinutes: 60,
    maxAgeDays: 7,
    cap: 12,
    headChars: 45000,
  },
  {
    id: "lampasas-dispatch",
    name: "Lampasas Dispatch Record",
    kind: "news",
    fetcher: "rss",
    url: "https://www.lampasasdispatchrecord.com/rss.xml",
    scope: "central-texas",
    localOutlet: true,
    refreshMinutes: 120,
    maxAgeDays: 14,
    cap: 8,
    headChars: 40000,
  },

  // ---- Official: Texas ----------------------------------------------------
  {
    id: "tx-dps",
    name: "Texas Department of Public Safety",
    kind: "official",
    fetcher: "rss",
    url: "https://www.dps.texas.gov/rss/dps-news.xml",
    scope: "texas",
    texasFocused: true,
    refreshMinutes: 60,
    maxAgeDays: 14,
    cap: 4,
    headChars: 12000,
  },
  {
    id: "tx-governor",
    name: "Office of the Governor",
    kind: "official",
    fetcher: "rss",
    url: "https://gov.texas.gov/news/rss",
    scope: "texas",
    texasFocused: true,
    refreshMinutes: 60,
    maxAgeDays: 14,
    cap: 3,
    headChars: 20000,
  },
  {
    id: "tx-sos",
    name: "Texas Secretary of State",
    kind: "official",
    fetcher: "rss",
    url: "https://www.sos.state.tx.us/rss/press.xml",
    scope: "texas",
    texasFocused: true,
    refreshMinutes: 240,
    maxAgeDays: 30,
    cap: 3,
    headChars: 12000,
  },
  {
    id: "tx-ag",
    name: "Texas Attorney General",
    kind: "official",
    fetcher: "ag",
    url: "https://www.texasattorneygeneral.gov/news/releases",
    scope: "texas",
    texasFocused: true,
    refreshMinutes: 240,
    maxAgeDays: 14,
    cap: 3,
    headChars: 60000,
  },
  {
    id: "txdot",
    name: "TxDOT",
    kind: "official",
    fetcher: "txdot",
    url: "https://www.txdot.gov/about/newsroom/statewide.html",
    scope: "texas",
    texasFocused: true,
    refreshMinutes: 240,
    maxAgeDays: 7,
    cap: 3,
    headChars: 135000,
  },

  // ---- News: Texas statewide ---------------------------------------------
  {
    id: "tx-scorecard",
    name: "Texas Scorecard",
    kind: "news",
    fetcher: "rss",
    url: "https://texasscorecard.com/feed/",
    scope: "texas",
    texasFocused: true,
    refreshMinutes: 60,
    maxAgeDays: 5,
    cap: 8,
    headChars: 25000,
  },

  // ---- News: Google News searches (SUPPLEMENTAL; surfaces the Killeen Daily
  // Herald and others that have no usable direct feed). Often throttled for
  // datacenter addresses, so nothing depends on these.
];

export const ALLOWED_HOSTS = new Set(SOURCES.map((source) => new URL(source.url).hostname));

// Hosts a redirect may legitimately land on (feeds sometimes move between
// apex and www). Anything else is rejected.
export function isAllowedHost(hostname) {
  if (ALLOWED_HOSTS.has(hostname)) return true;
  const bare = hostname.replace(/^www\./, "");
  return [...ALLOWED_HOSTS].some((host) => host.replace(/^www\./, "") === bare);
}
