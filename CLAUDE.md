# The Coryell County Messenger

## Editorial direction

The Coryell County Messenger has a center-right editorial perspective.

- Keep news reporting factual, sourced, and based on official records
  whenever possible.
- Place commentary, endorsements, and analysis in clearly labeled sections
  such as "The Coryell County Scoop," "Opinion," or "Editorial" — never
  mixed into straight news feeds.
- Prioritize official government sources, local agencies, Texas government,
  and reliable conservative-leaning publications, while accurately
  representing differing viewpoints when they are central to a story.

This governs source selection and how any future commentary/opinion content
is labeled. The owner does not publish articles by hand: the news sections are
fully automatic (see `docs/MODERNIZATION.md`).

## Where things live

- `rss-worker/` — Cloudflare Worker that aggregates sources into one JSON
  snapshot. Source registry: `rss-worker/lib/sources.js`, documented in
  `rss-worker/SOURCES.md` (read it before adding or re-researching sources,
  including the list of dead-end sources).
- `news-logic.js` — pure display logic (filters, sections, date labels).
- `app.js` — DOM wiring, weather, rendering.
- Tests: `cd rss-worker && npm test`, and `node --test "test/*.test.js"` at the root.

- Insurance flywheel: `docs/INSURANCE.md`; editable in `site-config.json`. It is a
  labelled business service, separate from news; it links to phoenixsecuritas.com
  and must never collect personal or health data on this site.

## Rules that are easy to break

- **Official sources rank ahead of media in the "Texas Headlines" section**
  (deliberate editorial policy, implemented in `news-logic.js`
  `sectionStories("texas")`). Local news is always more prominent than statewide.
- **Never invent dates.** Dates before 2010 are treated as missing (the Secretary of State feed stamps 2001).
   An item with no publication date keeps `pubDate: null`
  and is labeled "Date not provided". TxDOT's newsroom has no per-item date, so
  the Worker records `firstSeen` instead; do not go back to synthetic timestamps.
- **Keyword matching must be word-boundary regex**, never `.includes()`
  ("Phase II Selection Process" once matched "election"). See
  `rss-worker/lib/classify.js`; tests cover this.
- **A candidate's own office isn't election coverage by default.** The AG's and
  Governor's press releases name Paxton/Abbott constantly doing routine work.
  `SELF_SOURCE_CANDIDATE` in `classify.js` requires an actual election term for
  those two sources. Check any new official source for the same problem.
- **Never insert feed HTML into the page.** Feed text is reduced to plain text in
  the Worker (`cleanText`) and rendered with `textContent` in the browser.
- **Outbound fetches are restricted** to hosts in `lib/sources.js`.
- **Worker and site deploy separately, as a pair.** The schema 3 Worker breaks
  the old site, so deploy the SITE first (the new site reads every format), then
  the Worker; roll back the Worker first. See `docs/COORDINATED_DEPLOY.md`.
- Previously dropped at the owner's direction: Texas Tribune, KSAT (perceived
  as liberal-leaning). The hand-pinned KSAT story was removed in the 2026-10
  modernization because pinned stories go stale; do not reintroduce manual pins.
