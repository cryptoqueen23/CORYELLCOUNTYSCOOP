// Geographic relevance and category classification. All matching is
// word-boundary regex on the headline — never substring `.includes()`, which
// is how "Selection" once matched "election" (see CLAUDE.md).

export const LOCATION_ORDER = ["copperas-cove", "gatesville", "coryell-county", "central-texas", "texas"];

const LOCATION_TERMS = {
  "copperas-cove": ["copperas cove", "cove isd", "ccisd", "cove city council"],
  gatesville: ["gatesville", "gatesville isd"],
  "coryell-county": [
    "coryell county",
    "coryell co\\.?",
    "coryell",
    "evant",
    "oglesby",
    "jonesboro",
    "coryell city",
    "purmela",
    "south mountain",
  ],
  "central-texas": [
    "central texas",
    "centex",
    "killeen",
    "harker heights",
    "nolanville",
    "belton",
    "temple",
    "waco",
    "lampasas",
    "bell county",
    "bell co\\.?",
    "mclennan county",
    "bosque county",
    "hamilton county",
    "fort cavazos",
    "fort hood",
    "salado",
    "lometa",
    "kempner",
  ],
};

const LOCATION_PATTERNS = Object.fromEntries(
  Object.entries(LOCATION_TERMS).map(([id, terms]) => [id, new RegExp(`\\b(?:${terms.join("|")})(?![\\w])`, "i")]),
);

// Publishers whose whole beat is Coryell County; a story from them is local
// even when the headline omits the town name.
const LOCAL_PUBLISHERS = [
  { pattern: /gatesville messenger/i, location: "gatesville" },
  { pattern: /copperas cove leader/i, location: "copperas-cove" },
  { pattern: /killeen daily herald|kdhnews/i, location: "central-texas" },
];

export function localPublisher(publisher) {
  return LOCAL_PUBLISHERS.find((entry) => entry.pattern.test(publisher || "")) || null;
}

function unique(value, index, array) {
  return array.indexOf(value) === index;
}

function sortByLocality(list) {
  const rank = (id) => LOCATION_ORDER.indexOf(id);
  return [...new Set(list)].sort((a, b) => rank(a) - rank(b));
}

// Returns { locations: [...most local first], basis }.
//  - title:     a place name appears in the headline (strongest signal)
//  - publisher: a hyper-local outlet published it
//  - search:    only the search query that found it mentions the place (weak)
//  - source:    nothing in the story itself; falls back to the source's coverage area
export function locate(title, source, publisher = "") {
  const found = LOCATION_ORDER.filter((id) => LOCATION_PATTERNS[id]?.test(title));

  if (source.localOfficial) {
    return { locations: sortByLocality([source.scope, ...found, "texas"]), basis: "source" };
  }
  // A newspaper whose whole beat is this place: local even when the headline omits the town.
  if (source.localOutlet) {
    return { locations: sortByLocality([source.scope, ...found, "texas"]), basis: "publisher" };
  }
  if (found.length) {
    return { locations: sortByLocality([...found, "texas"]), basis: "title" };
  }

  const outlet = localPublisher(publisher);
  if (outlet) return { locations: [outlet.location, "texas"].filter(unique), basis: "publisher" };
  if (source.hint) return { locations: [source.hint, "texas"].filter(unique), basis: "search" };
  return { locations: [source.scope, "texas"].filter(unique), basis: "source" };
}

const CATEGORY_TERMS = {
  elections: [
    "elections?",
    "early voting",
    "ballots?",
    "voters?",
    "voting",
    "runoffs?",
    "midterms?",
    "primary",
    "primaries",
    "candidates?",
    "polling (?:place|location)s?",
    "senate race",
    "governor'?s race",
    "super pacs?",
  ],
  government: [
    "budget",
    "taxes",
    "tax",
    "taxpayers?",
    "tax rate",
    "appraisal",
    "city council",
    "commissioners?(?: court)?",
    "county judge",
    "bond election",
    "audit",
    "ordinance",
    "public spending",
    "city manager",
    "assistant city manager",
    "county auditor",
    "levy",
  ],
  schools: [
    "isd",
    "schools?",
    "students?",
    "teachers?",
    "superintendent",
    "campus(?:es)?",
    "graduation",
    "central texas college",
    "ctc",
    "tea",
    "classroom",
  ],
  "public-safety": [
    "arrest(?:ed|s)?",
    "police",
    "sheriff",
    "deput(?:y|ies)",
    "shooting",
    "crash(?:es)?",
    "wreck",
    "fire department",
    "wildfire",
    "burn ban",
    "dps",
    "emergency",
    "missing",
    "killed",
    "murder",
    "charged",
    "jail",
    "trafficking",
    "weather alert",
    "warning",
    "advisory",
  ],
  infrastructure: [
    "roads?",
    "highway",
    "us 190",
    "closures?",
    "txdot",
    "bridge",
    "construction",
    "water",
    "wastewater",
    "sewer",
    "utility",
    "utilities",
    "boil water",
    "traffic",
    "broadband",
    "power outage",
    "pothole",
  ],
  sports: ["football", "volleyball", "basketball", "baseball", "softball", "playoffs?", "track meet", "cross country"],
  community: [
    "festival",
    "parade",
    "events?",
    "library",
    "volunteers?",
    "fundraiser",
    "church",
    "4-h",
    "market",
    "trick or treating",
    "boozaar",
    "veterans?",
    "ribbon cutting",
    "celebrat\\w+",
  ],
};

const CATEGORY_PATTERNS = Object.fromEntries(
  Object.entries(CATEGORY_TERMS).map(([id, terms]) => [id, new RegExp(`\\b(?:${terms.join("|")})\\b`, "i")]),
);

const TEXAS_CANDIDATES = /\b(?:talarico|paxton|abbott|ted cruz|colin allred|wesley hunt)\b/i;

// A sitting candidate's own office issues routine press releases that name
// them constantly. For these sources a name alone is not election coverage.
const SELF_SOURCE_CANDIDATE = new Map([
  ["Texas Attorney General", /\bpaxton\b/i],
  ["Office of the Governor", /\babbott\b/i],
]);

export const CATEGORY_IDS = [
  "government",
  "schools",
  "elections",
  "public-safety",
  "infrastructure",
  "community",
  "sports",
  "general",
];

export function categorize(title, source, location) {
  const categories = [];
  // Non-Texas stories that use election words (other states' races on
  // regional feeds) don't count: the headline must show a Texas/local tie, or
  // the source must be Texas-focused.
  const texasTie =
    location.basis === "title" ||
    source.texasFocused === true ||
    source.localOfficial === true ||
    source.localOutlet === true;

  for (const id of Object.keys(CATEGORY_PATTERNS)) {
    if (!CATEGORY_PATTERNS[id].test(title)) continue;
    if (id === "elections" && !texasTie) continue;
    categories.push(id);
  }

  if (!categories.includes("elections") && texasTie && TEXAS_CANDIDATES.test(title)) {
    const selfPattern = SELF_SOURCE_CANDIDATE.get(source.name);
    const onlyOwnName = selfPattern && selfPattern.test(title);
    if (!onlyOwnName) categories.push("elections");
  }

  return categories.length ? categories : ["general"];
}

// Content that is never news for this audience (listings, obituaries, etc.).
const BLOCKED_PUBLISHER =
  /realtor\.com|zillow|redfin|trulia|loopnet|funeral|obituar|legacy\.com|maxpreps|crexi|homes\.com|movoto|apartments\.com/i;
const BLOCKED_TITLE = /\bobituary\b|\[updated \d|\bfor sale\b|\bmls\b|\bnow hiring\b/i;

export function isBlocked(title, publisher) {
  return BLOCKED_PUBLISHER.test(publisher || "") || BLOCKED_TITLE.test(title);
}
