# CPU and reliability trial, schema 3 Worker (2026-10-30)

Test Worker `coryell-county-rss-test`, own KV namespace `NEWS_KV_TEST`, version `72b91937`
(the branch as of commit `267625c`, before any classification changes). Production, Vercel, DNS and
`main` were not touched. Tail recorded 17:30-18:52 UTC (42 scheduled ticks, 31 fetching runs, 11 idle,
0 missed ticks); source health read again at 22:09 UTC.

## Performance: CPU FAIL (headroom), requests and KV PASS

| Measure | Value |
|---|---|
| CPU median / p90 / p95 / max | 5 / 8 / 9 / 10 ms (limit 10) |
| Runs >= 10 ms | 1 (KWTX, 10 ms) |
| Runs > 8 ms | 2 (KWTX 10, SOS 9) |
| Runs >= 7 ms | 8 of 31 |
| Exceptions / non-ok outcomes | 0 / 0 (Cloudflare did not stop the 10 ms run) |
| Idle tick CPU | 0 ms |
| Page view CPU | 2-3 ms |
| Heavy sources | SOS 9, AG 8, DPS 6, TxDOT 3 (failed), Governor 3 (timeout), KWTX 7/7/10 |
| Fetching runs | 31: 22 succeeded (14 wrote, 8 unchanged = no write), 9 failed |
| KV | 31 reads, 23 writes in 82 min |
| Projection | 552 fetches/day; writes <= about 600 (limit 1,000); reads <= about 6,500 (limit 100,000); requests about 720 cron + visitors (limit 100,000); 1 cron trigger (limit 5 per account; other Workers' crons not checked) |

Limits verified from Cloudflare docs 2026-10-30: Free plan 10 ms CPU per HTTP request and per
Cron Trigger, 100,000 requests/day, 50 subrequests; KV 100,000 reads, 1,000 writes/day.

Decision: not enough headroom. p95 is 9 ms and a run reached the limit, with 8 of 31 runs at 7 ms or more.
The slow runs are the ones that parse and classify new items, which also pay V8's first-use regex
compile in a fresh isolate (cold Node: first ingest about 6.5 ms vs 0.3 ms warm). The branch's later
classification changes add description parsing for all news sources and are unmeasured.

## Reliability: FAIL (local coverage thin, 29% of fetches failed)

See the table in the report: Google News 0 of 4 sources ever succeeded (503/timeouts, same as the earlier trial),
The Texan HTTP 429, TxDOT "no items found" (worked in the earlier trial, so unverified whether layout
or a block page), Governor and DPS one timeout each, Leader Press and Gatesville Messenger one HTTP 520
each (Leader Press recovered on its next slot; Gatesville Messenger kept its 10 saved stories while stale).
Reliable local sources: City of Copperas Cove, Leader Press, Gatesville Messenger, Lampasas Dispatch.
Gatesville city and the sheriff are healthy but have no current items. Fox 44 and KWTX are regional and
contributed no confirmed Coryell County stories.

## Other findings

- Scheduler: all 42 ticks ran exactly the source the clock predicts, 0 mismatches, 2-minute spacing.
  The schedule is bunched (ticks 51-59 of each 4-hour cycle are idle).
- Saved stories keep original dates and are labelled "saved copy" (verified in browser logic and live:
  gatesville-messenger kept 10 items through a failure).
- Accessibility: axe (WCAG 2.0-2.2 A/AA tags), 0 violations at 320/768/1440 px against the test Worker
  feed and 375 px against the old production format; no horizontal scroll; menu works at all widths.
- Format: schema 3 -> feed-build.js renders 29 cards; the old production format also loads.
  The old site cannot read schema 3, so deploy the site first (docs/COORDINATED_DEPLOY.md).
