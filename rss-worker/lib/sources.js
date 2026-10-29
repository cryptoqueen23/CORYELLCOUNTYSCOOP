// Source registry. Every outbound request is checked against the hostnames of
// these URLs (see fetchers.js), so adding a source here is the only way to
// make the Worker fetch from a new host. Documented in ../SOURCES.md.
//
// Fields
//   kind          "official" (government announcement) | "news" (published reporting)
//   scope         coverage area used when the story itself doesn't say: a LOCATION_ORDER id
//   localOfficial true when every item from this source is local by definition
//   texasFocused  true when the outlet is Texas-only (so a bare election word is Texas election news)
//   hint          Google News searches only: the place the search was for (weak signal)
//   refreshMinutes minimum minutes between fetches of this source
//   maxAgeDays    items older than this are not shown
//   cap           most items one source may contribute

const GNEWS = (query) =>
  `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=en-US&gl=US&ceid=US:en`;

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
  },
  {
    id: "nws-alerts",
    name: "National Weather Service",
    kind: "official",
    fetcher: "nws",
    url: "https://api.weather.gov/alerts/active?zone=TXZ157",
    scope: "coryell-county",
    localOfficial: true,
    refreshMinutes: 15,
    maxAgeDays: 2,
    cap: 5,
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
  },
  {
    id: "tx-sos",
    name: "Texas Secretary of State",
    kind: "official",
    fetcher: "rss",
    url: "https://www.sos.state.tx.us/rss/press.xml",
    scope: "texas",
    texasFocused: true,
    refreshMinutes: 120,
    maxAgeDays: 30,
    cap: 3,
  },
  {
    id: "tx-ag",
    name: "Texas Attorney General",
    kind: "official",
    fetcher: "ag",
    url: "https://www.texasattorneygeneral.gov/news/releases",
    scope: "texas",
    texasFocused: true,
    refreshMinutes: 120,
    maxAgeDays: 14,
    cap: 3,
  },
  {
    id: "txdot",
    name: "TxDOT",
    kind: "official",
    fetcher: "txdot",
    url: "https://www.txdot.gov/about/newsroom/statewide.html",
    scope: "texas",
    texasFocused: true,
    refreshMinutes: 120,
    maxAgeDays: 7,
    cap: 3,
  },

  // ---- News: regional TV --------------------------------------------------
  {
    id: "kwtx",
    name: "KWTX",
    kind: "news",
    fetcher: "rss",
    url: "https://www.kwtx.com/arc/outboundfeeds/rss/?outputType=xml",
    scope: "central-texas",
    refreshMinutes: 20,
    maxAgeDays: 7,
    cap: 15,
  },
  {
    id: "kcen",
    name: "KCEN",
    kind: "news",
    fetcher: "rss",
    url: "https://www.kcentv.com/feeds/syndication/rss/news/local",
    scope: "central-texas",
    refreshMinutes: 20,
    maxAgeDays: 7,
    cap: 15,
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
  },
  {
    id: "the-texan",
    name: "The Texan",
    kind: "news",
    fetcher: "rss",
    url: "https://thetexan.news/search/?f=rss&t=article&l=20&s=start_time&sd=desc",
    scope: "texas",
    texasFocused: true,
    refreshMinutes: 60,
    maxAgeDays: 5,
    cap: 8,
  },

  // ---- News: Google News searches (surface local papers, per-story publisher)
  {
    id: "gn-copperas-cove",
    name: "Google News: Copperas Cove",
    kind: "news",
    fetcher: "gnews",
    url: GNEWS('"Copperas Cove" when:14d'),
    scope: "central-texas",
    hint: "copperas-cove",
    refreshMinutes: 20,
    maxAgeDays: 14,
    cap: 25,
  },
  {
    id: "gn-gatesville",
    name: "Google News: Gatesville",
    kind: "news",
    fetcher: "gnews",
    url: GNEWS('Gatesville Texas when:14d'),
    scope: "central-texas",
    hint: "gatesville",
    refreshMinutes: 20,
    maxAgeDays: 14,
    cap: 25,
  },
  {
    id: "gn-coryell",
    name: "Google News: Coryell County",
    kind: "news",
    fetcher: "gnews",
    url: GNEWS('"Coryell County" when:14d'),
    scope: "central-texas",
    hint: "coryell-county",
    refreshMinutes: 20,
    maxAgeDays: 14,
    cap: 25,
  },
  {
    id: "gn-isd",
    name: "Google News: Local schools",
    kind: "news",
    fetcher: "gnews",
    url: GNEWS('"Copperas Cove ISD" OR "Gatesville ISD" OR "Evant ISD" OR "Oglesby ISD" when:14d'),
    scope: "central-texas",
    refreshMinutes: 30,
    maxAgeDays: 14,
    cap: 15,
  },
];

export const ALLOWED_HOSTS = new Set(SOURCES.map((source) => new URL(source.url).hostname));

// Hosts a redirect may legitimately land on (feeds sometimes move between
// apex and www). Anything else is rejected.
export function isAllowedHost(hostname) {
  if (ALLOWED_HOSTS.has(hostname)) return true;
  const bare = hostname.replace(/^www\./, "");
  return [...ALLOWED_HOSTS].some((host) => host.replace(/^www\./, "") === bare);
}
