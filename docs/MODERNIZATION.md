# Modernization: audit, architecture, deployment, limitations

Branch: `modernize-aggregator`. Nothing here is live until deployed (see Deployment).

## 1. Audit findings (2026-10-29, before changes)

Checked against the live Worker and each source, not assumed from code.

| Finding | Evidence |
|---|---|
| Statewide news dominated the page; almost nothing local | Live Worker returned 12 stories: 11 statewide, 1 Copperas Cove. Gatesville contributed 0. |
| "Local News" cards were placeholders | Three cards with stock Unsplash photos and text like "Use this card for TxDOT..." |
| Scoop blog cards were placeholders with dead `#` links | `index.html` |
| Election Watch showed 2014-2015 stories | The Secretary of State feed has 409 items, mostly 2014-15, and no age filter existed. |
| A story dated **2028** sat at the top | A Secretary of State item with a bad date sorted first. No date validation. |
| TxDOT items carried fake "now" timestamps | The Worker stamped them at fetch time, so old TxDOT news looked brand new. |
| A hand-pinned July 2026 KSAT story was permanent | `PINNED_ELECTION_STORIES`; KSAT was also a source the owner had removed. |
| Breaking News bar was a standing label | It showed the top headline regardless of age. |
| Weather could label a forecast as "Right now" | `app.js` fell back to forecast values when no observation was available. |
| Weather values inserted with `innerHTML` | `app.js` (low risk, NWS data, but unnecessary). |
| One cache entry, no stale fallback, no health info | A feed failure was silent; an empty refresh emptied the page. |
| 25 MB autoplay video referenced on first load | `preload="metadata"` plus autoplay on `video/coryellcourt.mp4`. |
| Render-blocking Google Fonts (third party) | Two font families from fonts.googleapis.com. |
| Sheriff feed dead since 2021; Gatesville city news months old | Kept; now age-filtered and shown as healthy but empty. |
| The Texan feed returns HTTP 429 from the test machine | Failure is now isolated and reported. |
| Focus ring (`#f3b51b`) about 1.9:1 against white | Below the 3:1 non-text contrast requirement. |
| Menu overflowed horizontally between 761 and about 1100 px | Measured: page 1076 px wide in a 768 px viewport. |
| Vercel project settings | The project could not be found in the connected Vercel team by repo URL or name search, so branch and auto-deploy settings are **unverified**. Check the dashboard (see Deployment). |
| CORS | Allow-list present and correct (hub domain, apex, `coryellcountyscoop.vercel.app`). |

## 2. Architecture

```
Sources (RSS / Atom / JSON / listing pages / Google News RSS)
        |  independent fetches, timeout + retry, allowlisted hosts only
        v
Cloudflare Worker (cron every 15 min, per-source refresh intervals)
   parse -> sanitize -> validate dates -> classify place + topic
   -> expire by age -> cap per source -> score -> de-duplicate
        |  state: KV (recommended) or Cache API; last-known-good per source
        v
GET / -> snapshot JSON (stories + feed health)       GET /health
        v
Static site on Vercel: filters, search, sections (news-logic.js, app.js)
   browser keeps a saved copy in localStorage for outages
```

No database, no accounts, no paid services. Weather is fetched by the browser
from api.weather.gov (as before).

Ranking: place weight (Copperas Cove, Gatesville, Coryell County 100;
Central Texas 50; Texas 10), title place match +10, official +8, local
publisher +6, search-only match -10, recency up to +40 fading over ten days.
Sections then sort by date. Texas Headlines lists official announcements first
(editorial policy).

## 3. What changed

- Worker rewritten as small modules (`rss-worker/lib/`), with tests.
- Homepage: search plus place/topic/date filters; sections for Latest Local,
  Copperas Cove, Gatesville, Coryell County, Government, Schools, Public
  Safety, Elections, Texas Headlines, Community Updates.
- Removed: video from the page (file kept in `video/`, unreferenced), Google
  Fonts, Unsplash images, placeholder cards, the pinned story, and the standing
  "Breaking" label (replaced by a "Weather alert" / "Latest local" strip that
  only shows when true and under 24 hours old).
- Added: the Life & Health Insurance section (see `docs/INSURANCE.md`).
- Kept: branding, masthead, Scoop profile, Complaint of the Day, news-tip links,
  Guess Your Party link, useful links, footer, editorial policy.

## 4. Test results

Run 2026-10-29:

- `rss-worker`: `npm test` 41 passed, 0 failed (RSS/Atom/empty/malformed parsing,
  duplicates, geographic matching, the "Selection" false match, dates including
  future dates and time-zone independence, expiry, source failure and
  last-known-good, backoff, allowlist, CORS, preflight, total-outage handler test).
- Site: `node --test "test/*.test.js"` 19 passed, 0 failed (search, filters,
  sections, date labels, top strip expiry, saved copies, undated ordering,
  unsafe links, insurance config/HTML consistency, no dead links).
- Browser (Chromium via Playwright, live data): no horizontal scroll at 320,
  375, 768, 1024 and 1440 px; no console errors; stand-alone controls at least
  44 px; first Tab stop is the skip link; search, empty state, place filter,
  worker-down message and saved-copy fallback all behave.
- axe-core (WCAG 2.0/2.1/2.2 A/AA plus best-practice tags): 0 violations on
  desktop, mobile, mobile with menu open, and the filtered view.
- **Not run:** Lighthouse (not installed here), so the 90/95 score targets are
  unmeasured; screen-reader testing; the deployed Worker (CPU limit and KV
  behavior are unverified until deployed). Page weight measured: HTML 16 KB,
  CSS 18 KB, JS 21 KB, one 77 KB image, snapshot about 30 KB gzipped. The 25 MB
  video and font downloads are gone.

## 5. Deployment (two separate steps; order matters)

Nothing has been pushed or deployed.

1. **Worker first**: see `rss-worker/README.md` (KV namespace required for reliable use,
   `wrangler deploy`, check `/health`). The old site keeps working with the new
   Worker.
2. **Check Vercel**: dashboard, project, Settings, Git. Confirm the Production
   Branch (expected `main`) and that no "Ignored Build Step" skips builds. A push
   of a non-`main` branch creates a preview deployment only; production changes
   when `modernize-aggregator` is merged into `main`.
3. Review the preview URL, then merge. Verify the live page loads headlines and
   the Worker `/health` shows sources responding.
4. Roll back: Vercel Deployments, promote the previous one; Worker
   `wrangler rollback`.

## 6. Remaining limitations and minimal maintenance

- Google News RSS is unofficial; if Google changes it, local coverage drops to
  the official feeds, KWTX and KCEN until another source is added.
- Scraped sources (AG, TxDOT) break if those sites change their markup. The rest
  keep working and the health list shows the failure.
- No coverage of Coryell County government, county OEM, or school districts:
  none publishes a usable feed (see SOURCES.md).
- Local-vs-regional classification is keyword based on headlines; some stories
  will land in "general" or the wrong place. Tune `lib/classify.js`.
- Search covers only the retained recent stories (roughly two weeks), not an archive.
- Complaint of the Day and the Scoop section are owner-edited by hand.
- Cloudflare free-tier CPU headroom is unverified until deployed.
- Ongoing maintenance expected: none routine. Occasionally glance at "Source
  status" at the bottom of the page.
