// Duplicate detection: the same event is often published by a city, a local
// paper, a TV station and a Google News re-listing.

const STOPWORDS = new Set([
  "the", "a", "an", "of", "to", "in", "on", "for", "and", "at", "by", "with", "as", "is", "are", "from", "its", "new",
]);

export function titleTokens(title) {
  return new Set(
    String(title)
      .toLowerCase()
      .replace(/[‘’']/g, "")
      .replace(/[^a-z0-9]+/g, " ")
      .split(" ")
      .filter((word) => word && !STOPWORDS.has(word)),
  );
}

export const DUPLICATE_THRESHOLD = 0.75;

export function similarity(a, b) {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  const jaccard = shared / (a.size + b.size - shared);
  // One headline wholly contained in a longer one (e.g. extra suffix text).
  const containment = shared / Math.min(a.size, b.size);
  return Math.max(jaccard, Math.min(a.size, b.size) >= 5 ? containment * 0.9 : 0);
}

// `stories` must already be sorted best-first; the first of each cluster wins
// and records the other publishers in `alsoReportedBy`.
//
// A token index limits comparisons to stories that share words, which keeps
// CPU low (a full pairwise scan was the most expensive step on the free plan).
export function dedupe(stories) {
  const kept = [];
  const byLink = new Map();
  const byToken = new Map();

  for (const story of stories) {
    const tokens = titleTokens(story.title);
    let existing = byLink.get(story.link);

    if (!existing) {
      const shared = new Map();
      for (const token of tokens) {
        for (const index of byToken.get(token) || []) shared.set(index, (shared.get(index) || 0) + 1);
      }
      // Earliest kept story that is similar enough wins, as in a plain scan.
      const candidates = [...shared.keys()].sort((a, b) => a - b);
      for (const index of candidates) {
        const candidate = kept[index];
        const needed = Math.min(2, tokens.size, candidate._tokens.size);
        if (shared.get(index) >= needed && similarity(candidate._tokens, tokens) >= DUPLICATE_THRESHOLD) {
          existing = candidate;
          break;
        }
      }
    }

    if (existing) {
      const name = story.publisher;
      if (name && name !== existing.publisher && !existing.alsoReportedBy.includes(name)) {
        existing.alsoReportedBy.push(name);
      }
      continue;
    }

    const entry = { ...story, _tokens: tokens, alsoReportedBy: [] };
    const position = kept.push(entry) - 1;
    byLink.set(story.link, entry);
    for (const token of tokens) {
      if (!byToken.has(token)) byToken.set(token, []);
      byToken.get(token).push(position);
    }
  }

  return kept.map(({ _tokens, ...story }) => story);
}
