# Source registry and feed health

The registry is code: `lib/sources.js`. Every outbound request is restricted to
the hostnames in that file. This page explains what is in it and why.

Verified live on 2026-10-29 from a local machine. Item counts are what each
feed returned, not how many are shown (age limits and per-source caps apply).

## Official (shown as "Official announcement")

| Source | Method | Notes |
|---|---|---|
| City of Copperas Cove | RSS (CivicPlus News Flash) | Working, dated. |
| City of Gatesville | JSON the city's own site loads (`news_list.json`) | Working, but the newest item was months old, so nothing is shown until they post again (45-day age limit). |
| Coryell County Sheriff's Office | RSS | Site inactive; newest post 2021. Contributes nothing until they post. Harmless. |
| National Weather Service alerts, zone TXZ157 | api.weather.gov | Empty is normal. Alerts vanish when they expire. |
| Texas DPS | RSS | Working. |
| Office of the Governor | RSS | Working. |
| Texas Secretary of State | RSS | Feed is 400+ items; current items carry the year 2001 and older ones are 2014-2015. Pre-2010 dates are treated as missing (see Limits); the old items are hidden by the age limit. |
| Texas Attorney General | HTML listing scrape | Working. Fragile (page markup). If the layout changes the source shows as failing and the rest keep working. |
| TxDOT | HTML listing scrape | No dates on the listing; items are labeled "Date not provided" and expire 3 days after first seen. |

## News (shown as "News report", publisher named per story)

| Source | Method | Notes |
|---|---|---|
| KWTX, KCEN | RSS | Regional TV. Classified by place name in the headline; otherwise "Central Texas". |
| Texas Scorecard, The Texan | RSS | Texas-wide. The Texan rate-limited (HTTP 429) from the test machine; it may work from Cloudflare. A failing source never blocks others. |
| Google News searches (Copperas Cove, Gatesville, Coryell County, local ISDs) | Public Google News RSS search | Surfaces the Killeen Daily Herald, Copperas Cove Leader-Press, Gatesville Messenger, Fox 44 and others, each with its real publisher. **Risk:** this is a public but unofficial endpoint; Google could change or restrict it. If it stops working the registry degrades to the other sources. Links point to news.google.com, which redirects to the publisher. |

Noise filtered out: obituaries and funeral-home pages, real-estate listings,
MaxPreps listings (`isBlocked` in `lib/classify.js`).

## Not available (researched; do not re-research without a new idea)

- Coryell County government, Coryell County OEM: no RSS or scrapable news page (Facebook only).
- Copperas Cove ISD: ccisd.net returns 403 to automated requests. Gatesville ISD, TEA: JS-rendered.
- Texas Legislature: only bill-tracking XML.
- Killeen Daily Herald direct feeds: rate-limited (429). Covered through Google News instead.
- Gatesville Messenger direct: no working feed (404 / empty search feed). Covered through Google News.

## How freshness and failures work

- A cron trigger runs every 2 minutes and fetches only the 2 most overdue sources
  (never-fetched first). Each source has its own minimum interval (`refreshMinutes`:
  15 to 120 minutes) and is skipped until due. A full cycle through all 17 sources
  takes about 20 minutes after a fresh deploy; afterwards each source is refreshed at
  its own interval.
- Each source is fetched independently with an 8 s timeout and one retry
  (after 700 ms) for network errors and 5xx. HTTP 4xx is not retried.
- On failure the source's last good items are kept and marked `stale: true`;
  consecutive failures back off 5, 10, 20 ... minutes (max 2 hours).
- Status per source: `ok`, `stale` (1-2 failures), `failing` (3+), `pending`.
- `GET /health` returns the per-source status; the site shows it under
  "Source status" at the bottom of the page.
- Each story carries `pubDate` (from the source, validated), `fetchedAt` (when
  the Worker last got the source) and `stale`. The site shows the publication
  date only, never the fetch time, as the story date.

## Limits (Cloudflare Free plan, figures from Cloudflare's published limits)

- 100,000 Worker requests/day; 50 subrequests and **10 ms CPU per invocation**
  (cron invocations too); 5 cron triggers per account.
- KV: 100,000 reads/day, 1,000 writes/day.
- This design: at most 2 source fetches (plus 0 extra) per run; each run that fetches
  writes 2 KV keys. Estimated 300-400 runs with work per day, so about 600-800 KV
  writes/day. Each page view reads 1 KV key.
- CPU: measured on a laptop (warm Node, not Cloudflare) a typical 2-source run is about
  5-8 ms and the heaviest case about 10 ms. That is inside the limit on paper
  with little margin, and **unverified until deployed**. Going over the limit makes
  that run fail (error 1102); it does not bill the account. The previous snapshot keeps
  being served and the page says it has not refreshed recently.
- Feeds with bogus dates: the Texas Secretary of State feed stamps current items
  with the year 2001. Dates before 2010 are treated as "no date", so those items show
  as "Date not provided" for up to 3 days after first being seen.
