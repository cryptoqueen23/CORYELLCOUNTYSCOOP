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

This governs RSS source selection for "Latest Texas Headlines" and
"Election Watch," and how any future commentary/opinion content is labeled.

## Current sources (rss-worker/worker.js)

Official sources always rank ahead of media outlets in the general
headlines list (`official: true` flag, capped per-source so one prolific
feed can't crowd out the rest) — this is deliberate per the editorial
policy above, not a bug.

**Official** (priority order the user specified 2026-07-24):
- Coryell County Sheriff's Office — RSS, but the site is inactive (newest
  post confirmed 2021-09-28). Left in; contributes nothing until they post
  again, which is harmless.
- City of Copperas Cove — RSS (CivicPlus).
- City of Gatesville — no RSS; scraped via their internal JSON endpoint
  (`_includes_/published/news_list.json`), which is actually more reliable
  than scraping HTML since it's the same data their own site's JS reads.
- Texas Department of Public Safety — RSS.
- Office of the Governor — RSS.
- Texas Secretary of State — RSS (covers general press + elections).
- TxDOT — no RSS; scraped from their newsroom listing page. No date is
  available per-item without fetching every article individually (too
  heavy for a "lightweight" Worker), so items get a synthetic timestamp
  that preserves the page's own newest-first order.
- Texas Attorney General — no RSS; scraped from their press release
  listing page (has real per-item dates). Their CMS injects soft-hyphen
  characters (`­`) into titles for line-break hinting — stripped
  during parsing, or titles look broken-mid-word.
- National Weather Service alerts — active alerts for Coryell County's
  zone (`TXZ157`). Usually empty; that's correct, not a failure.

**Not implemented** (researched 2026-07-24, no viable lightweight path):
- Coryell County government itself — no RSS, no scrapable news/announcement
  page exists (only static sub-pages; real-time updates are Facebook-only).
- Coryell County Office of Emergency Management — same situation, static
  page only.
- Texas Legislature (capitol.texas.gov / legis.texas.gov) — only bill-
  tracking XML feeds exist, nothing suitable for a general-news audience.
- Texas Education Agency — newsroom page is JS-rendered client-side with
  no discoverable static API; would need headless-browser rendering to
  scrape, which isn't a "lightweight" Worker anymore.
- Gatesville ISD / Copperas Cove ISD — both JS-rendered, same problem as
  TEA. Revisit only if Cloudflare's Browser Rendering API (paid) is
  worth it for this.
- Facebook-only sources generally (Sheriff, OEM) — no server-side-fetchable
  content without Facebook Graph API access; not pursued.

**Media** (supplement official info, never replace it — center-right per
editorial policy):
- KWTX Central Texas — local TV affiliate, straight local news.
- Texas Scorecard — Texas-focused, conservative-leaning, heavy state
  political/policy coverage.
- The Texan — Texas-focused, conservative-leaning. Feed URL isn't the
  obvious `/feed/` (that 404s) — it's `thetexan.news/search/?f=rss&t=article&l=20&s=start_time&sd=desc`,
  discovered via the `<link rel="alternate">` tag on their homepage.

Previously used and removed at the user's direction:
- Texas Tribune — dropped for being perceived as liberal-leaning.
- KSAT San Antonio — dropped for the same reason.

## Election Watch keyword-matching gotchas

`isElectionStory()` in rss-worker/worker.js does keyword matching, which
has two non-obvious failure modes already hit and fixed once — don't
reintroduce them:
- **Must use word-boundary matching, not `.includes()`.** Plain substring
  search matched "election" inside "Sel**election** Process" (a DPS
  program, nothing to do with voting). Use the `containsWord()` helper.
- **A candidate's own office isn't election coverage by default.** The AG's
  and Governor's press releases mention Paxton/Abbott in nearly every
  title just doing routine government business. `SELF_SOURCE_CANDIDATE`
  requires an actual election term (not just the name) for those two
  sources specifically. Don't add a new official source without checking
  whether it's a sitting candidate's own office first.
