# News collection on GitHub Actions (replaces the Cloudflare Worker)

Status: implemented on branch `scoop-sched-v3`. NOT merged, NOT deployed. Every step below that changes
`main`, Vercel or the live Worker needs Mari's explicit approval.

## How it works

```
GitHub Actions (every 15 min, collector/collect.mjs)
   reads sources that are due -> keeps/updates one record per source
   -> commits data/news.json to the `data` branch (only when it changed)
Website (Vercel, unchanged hosting)
   app.js -> FeedSource.loadFeed([static file, Worker]) -> FeedBuild.build -> same page as before
```

- **Same feed format.** `news.json` is the schema 3 feed the Worker served, produced by the same code
  (`rss-worker/lib/`), so ranking, dedupe, expiry, local-news priority, editorial labels and dates are unchanged.
- **State = the published file.** No KV. Each source has its own record: items (with the publisher's own dates),
  last successful refresh (`rec.t`), consecutive failures, last error.
- **Failures are isolated.** A failed source keeps its saved stories, dates and last good refresh time. One retry
  pass for transient errors (not for HTTP 4xx such as 403). If NO source can be reached the run fails and publishes nothing.
- **Three different times, never mixed:** collector run time (`tick.at`, what the page calls "updated"),
  last successful refresh per source (`rec.t`), article publication date (`item.pubDate`; undated items stay
  "Date not provided" and carry only a first-seen time).
- **When a commit happens:** only if a source's visible content changed, a failure status changed, or the hourly
  "collector ran" marker is due (24 commits/day at most from the marker). Unchanged runs commit nothing.
- **Static URL:** `https://raw.githubusercontent.com/cryptoqueen23/CORYELLCOUNTYSCOOP/data/news.json`
  (CORS `*`, `Cache-Control: max-age=300`, so readers see data at most ~5 min behind the commit).
- **Site loader** (`feed-source.js`): 6 s limit per request; static file used if valid and gathered within 150 min;
  otherwise the Worker is asked and the freshest valid copy wins; both down -> the visitor's saved copy, then the error message.

## Texas Secretary of State (documented limitation)

`sos.state.tx.us` / `sos.texas.gov` answer HTTP 403 (an S3 error page, for every path including `robots.txt`) to
GitHub's runner network but 200 from other networks. The cause is not confirmed (most likely the host blocks GitHub/Azure
address ranges). No workaround that keeps to honest, public access exists on our side. Handling: the source is kept in the registry, fetched
once per 4 hours, never retried within a run, never blocks other sources, and shows on the page as
"Not responding, showing earlier results". Its feed has no usable current items (items dated 2001 are treated as missing),
so the practical loss is small. If the Texas SOS webmaster allows the GitHub range, it recovers by itself.

## Other source behaviour seen from GitHub's runners (proof-of-concept runs)

- **Texas Governor** needs 7-10 s to send its first byte (also from a home connection); the Worker's 8 s limit made it time out in 4 of 8 runner attempts. The collector sets `FETCH_TIMEOUT_MS=25000` (the Worker keeps 8 s). With it, 15 of 15 sources succeed from a local run.
- **Texas DPS** failed 2 of 8 attempts with a transient connection error and recovered on the retry pass or the next run.
- **Texas Scorecard** returned a Cloudflare bot challenge (HTTP 403 "Just a moment...") once in 7 attempts; it is retried on every run until it passes.
- The two local newspapers (Leader Press, Gatesville Messenger), which failed with HTTP 520 from Cloudflare's network, answered HTTP 200 every time from GitHub (5 of 5).

## Safety properties

- Workflow permissions: `contents: read` globally; the one job gets `contents: write` (pushes `data` only). No secrets.
- `concurrency: collect-news`, `cancel-in-progress: false`: one collector at a time, never cancelled mid-publish.
- Vercel: the workflow never pushes `main`. `vercel.json` (`git.deploymentEnabled`) turns off builds for `data` and `scratch/*`,
  and the collector writes the same setting into the data branch. During the proof of concept, pushes to scratch branches produced no
  Vercel status or deployment.
- `GITHUB_TOKEN` pushes do not start other workflows.
- A corrupt `news.json` aborts the run (exit 2); it is never overwritten by a fresh start (history keeps every version).

## Known risks

1. **60-day inactivity.** GitHub disables scheduled workflows in a public repo after 60 days with no "repository activity".
   GitHub does not define the term and documents nothing about commits made by the workflow itself, so whether the bot's
   data-branch commits count is UNVERIFIED. No keepalive commits are used. The site's own stale warning
   ("has not refreshed recently") appears after 150 min, so a stopped collector is visible within hours. Recovery:
   `gh workflow enable collect-news.yml` (or Actions tab -> Enable workflow). Any real push to `main` is the strongest signal.
2. **Late or skipped runs.** GitHub may delay or drop scheduled runs under load. News is 30+ min granular, so this is tolerable.
3. **Source IP blocking.** Other hosts could start blocking GitHub's ranges (Texas SOS already does). Failure stays isolated.
4. **raw.githubusercontent.com** is a best-effort CDN. If it is ever restricted, move the file to GitHub Pages (same data, new URL) -
   one constant in `app.js`.
5. **Fallback Worker quality.** The production Worker still runs the old July code (legacy format; its "updated" time is assembly time,
   not collection time, and it can show a 2014 SOS story dated 2028). It is only used when the static file is missing or stale.
6. **Data branch history grows** by about 24-60 small commits a day. If it ever matters, squash the data branch (nothing depends on its history).
7. Failure emails go to the account that last edited the workflow's cron line.

## Deployment steps (all need approval)

1. Merge `scoop-sched-v3` into `main` (this adds the workflow, `collector/`, `feed-source.js`, the `app.js` change and `vercel.json`).
   Vercel deploys the site. At this moment `data` does not exist yet, so the site simply falls back to the Worker (safe).
2. Actions tab -> `collect-news` -> **Run workflow** (creates the `data` branch and the first `news.json`). Check the run summary:
   14+ of 15 sources ok (Texas SOS 403 is expected).
3. Open the static URL in a browser; confirm JSON and `schema: 3`. Reload the live site; the "Headlines updated" time should match the run.
4. Leave the schedule running for 24-48 h with the Worker untouched. Check: runs on time, `data` commits, no Vercel deployment for `data`,
   page shows fresh stories, stale warning absent.
5. Only then (separate approval) retire the Worker: remove it from `FEED_URLS` in `app.js`, delete the Worker, and archive `rss-worker/worker.js`
   and `wrangler*.toml` (keep `rss-worker/lib`, which the collector uses).

## Rollback

| Situation | Action |
|---|---|
| Collector misbehaves, site otherwise fine | Actions tab -> disable `collect-news`. The site shows the last published file, then falls back to the Worker once it is stale (150 min). |
| Bad data published | Revert the last commit on `data` (`git revert` and push), or delete `data/news.json` so the site uses the Worker. |
| Site change misbehaves | Revert the merge commit on `main` (Vercel redeploys the previous site, which reads the Worker only; the Worker format is unchanged so nothing else is needed). |
| Static host problem | Change `STATIC_FEED_URL` in `app.js`, or remove it from `FEED_URLS`. |

The Worker is not modified at any point before step 5, so rolling back never depends on restoring it.

## Checks (run before merging)

```
node --test "test/*.test.js"                 # site: 40 tests
node --test collector/test/collect.test.mjs  # collector: 11 tests
cd rss-worker && npm test                    # library + legacy Worker: 73 tests
node collector/test/browser-check.cjs <news.json>   # manual: Playwright + axe, needs playwright-core / axe-core from other projects
```
