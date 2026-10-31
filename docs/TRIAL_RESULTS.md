# Trial Worker results (2026-10-29 / 30)

Trial Worker: `coryell-county-rss-test` at https://coryell-county-rss-test.truewolfflix777.workers.dev
with its own KV namespace `NEWS_KV_TEST`. Account is on the Cloudflare Free plan (stated by Mari; the
billing page could not be read through the API). Production Worker `coryell-county-rss` (last deployed
2026-07-25), the Vercel site and `main` (`7574c18`) were not touched.

## CPU (Cloudflare `wrangler tail`, `cpuTime`, real Free-plan runs)

Documented Free limit: 10 ms per invocation. Cloudflare did **not** terminate any run (all outcomes `ok`,
zero exceptions), but most runs that did work were above the documented limit, so production cannot
rely on that leniency.

| Run (budget 3, clean first cycle) | CPU ms |
|---|---|
| cove-city, gatesville-city, coryell-sheriff | 9 |
| nws-alerts, tx-governor, tx-ag | 17 |
| tx-dps (timed out) | 6 |
| tx-sos, txdot | 26 |
| kwtx, kcen (failed), the-texan (failed) | 11 |
| tx-scorecard, gn-isd | 16 |
| gn-copperas-cove | 15 |
| gn-gatesville (HTTP 503) | 12 |
| gn-coryell (HTTP 503) | 9 |
| run with nothing due | 1 |
| page view (GET /) | 1 to 3 |

6 of 9 work runs exceeded 10 ms; the median was about 12 ms and the maximum 26 ms. A run costs roughly 6 ms
fixed (reading and rewriting the saved state, rebuilding the snapshot) plus 1 to 10 ms per source.
Earlier version (budget 5): 13, 18, 14 ms. Page views are cheap, so visitors are not the problem.

## Source behaviour seen from Cloudflare's network (different from a home network)

- Google News returned HTTP 503 for 2 of 4 searches in this cycle (Gatesville, Coryell County) and succeeded for the others.
- KCEN's feed redirected to www.youtube.com from Cloudflare, so the redirect guard rejected it (working as designed).
- Texas DPS timed out once (8 s, then one retry).
- The Texan returned HTTP 429.
- Everything else (Copperas Cove, Gatesville, Sheriff, NWS, Governor, AG, SOS, TxDOT, KWTX, Scorecard) responded.
- A failing source never blocked the others; its status shows "stale"/"failing" in `/health`.

## Quality checks on the live snapshot

- Page response: median 111 ms (82 to 553 ms), about 60 KB. CORS allowed only the approved origins; POST 405; unknown path 404.
- No story older than its source's limit; no future-dated or pre-2010 dates; undated items carried no invented date.
- 0 duplicate pairs left above the threshold (Google News merging could only be judged when it responded).
- Local coverage (29 stories at the first check): City of Copperas Cove, Copperas Cove Leader-Press, Killeen Daily Herald,
  The Gatesville Messenger, KWKT Fox 44, KCEN.
- Website against the trial Worker's real output: no horizontal scroll at 320/375/768/1024/1440 px, 0 accessibility
  violations, search and empty state work, Worker-down message and saved-copy fallback work.

## KV and request usage

- `/health` counters tracked runs and writes (minor undercount when two runs overlap).
- No excessive requests seen: about one cron run every 2 minutes; at most 3 source requests per run (plus one retry).

## Conclusion

The trial does not support promoting the current design as "free-tier safe". See the report for options.
