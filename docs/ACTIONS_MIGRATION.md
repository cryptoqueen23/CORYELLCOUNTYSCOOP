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
   not collection time). It is only used when the static file is missing or older than 150 minutes, and its future-dated or invalid stories
   (such as the 2014 SOS release dated 2028) are now filtered out in the browser. It carries no local-place data, so it shows Texas Headlines only.
6. **Data branch history grows** by about 24-60 small commits a day. If it ever matters, squash the data branch (nothing depends on its history).
7. Failure emails go to the account that last edited the workflow's cron line.

## What the merge deploys (read before approving)

`scoop-sched-v3` is 19 commits ahead of `main`. Merging it puts the WHOLE modernised site live on Vercel (new `index.html` and
`styles.css`, the insurance section driven by `site-config.json`, accessibility work, the new feed reader), not only the feed switch.
The Worker is NOT deployed by the merge (it is deployed only with `wrangler`); confirm in the Cloudflare dashboard that no Git
integration (Workers Builds) is attached to this repository before merging.

## Launch commands (run only after explicit approval)

```bash
cd C:/Users/insur/CORYELLCOUNTYSCOOP
# 0. Pre-flight: everything green, nothing uncommitted, nothing already on main that we lack
git status --short                         # expect: nothing
node --test "test/*.test.js"               # 44 pass
node --test collector/test/collect.test.mjs# 11 pass
(cd rss-worker && npm test)                # 77 pass
git fetch origin && git rev-list --left-right --count origin/main...scoop-sched-v3   # expect: 0 19 (or 0 N)
git rev-parse origin/main                  # note this SHA: it is the rollback target for the site

# 1. Merge and push (this is what makes Vercel deploy the site)
git switch main && git pull --ff-only origin main
git merge --no-ff scoop-sched-v3 -m "Launch: GitHub Actions news collector, static feed loader, modernised site"
git push origin main

# 2. Wait for the Vercel deployment to be Ready (dashboard, or: gh api repos/cryptoqueen23/CORYELLCOUNTYSCOOP/commits/main/status -q .state)
# 3. Create the data branch and the first news.json
gh workflow run collect-news.yml
gh run watch $(gh run list --workflow collect-news.yml --limit 1 --json databaseId -q '.[0].databaseId')
# 4. Confirm the file is published
curl -s https://raw.githubusercontent.com/cryptoqueen23/CORYELLCOUNTYSCOOP/data/news.json | head -c 300
```

Cleanup after the observation period (separate approval): `git push origin --delete scratch/actions-poc scratch/actions-poc-data`.

## Verification checklist (first hour)

- [ ] Vercel production deployment of the merge commit is Ready; `https://coryellcountyscoop.vercel.app` loads.
- [ ] `collect-news` run succeeded; summary shows 14 or more of 15 sources ok (Texas SOS 403 is expected).
- [ ] The `data` branch exists with `news.json` and `vercel.json`; **no Vercel deployment** appears for the `data` commit.
- [ ] The static URL returns JSON with `"schema":3` and a recent `tick.at`.
- [ ] The live page shows "Headlines updated ... Central" matching that run, local stories first, labels "Government announcement" / "News report", dates on stories.
- [ ] Browser network tab: the first request is the `raw.githubusercontent.com` URL (200); the Worker is NOT requested.
- [ ] Phone width (320/375 px): no sideways scrolling; keyboard Tab reaches the skip link first.
- [ ] After 2 hours: a second and third scheduled run happened (Actions tab), on roughly a 15-minute rhythm.

## Observation period (24-48 h, Worker left running)

Check at 1 h, 6 h, 24 h, 48 h: scheduled runs present, `data` commits at most ~1 an hour when nothing changes, page not showing the
stale warning, no Vercel deployments from `data`, failing sources limited to Texas SOS (and occasional Governor/DPS/Scorecard blips).

## Rollback (actual behaviour, verified in tests and in a browser)

| Situation | What happens / what to do |
|---|---|
| **Workflow disabled or stopped** | Nothing breaks at once. The last `news.json` stays at the static URL. The page keeps using it for **150 minutes after the collector last ran**, without calling the Worker (checked at 10, 30 and 149 min). From 150 min on, the page asks the Worker and shows the fresher valid copy. After the Worker is retired, the old static file keeps showing with the page's "has not refreshed recently" warning. Re-enable: `gh workflow enable collect-news.yml`. |
| Bad data published | Revert the last commit on `data` and push, or delete `news.json` on `data`; the page falls back to the Worker. |
| Site change misbehaves | `git revert -m 1 <merge commit>` on `main` and push; Vercel redeploys. The previous site reads the Worker only, and the Worker is untouched. Rollback target SHA is the `origin/main` noted in step 0. |
| Static host problem | Change `STATIC_FEED_URL` in `app.js` (e.g. to GitHub Pages) or remove it from `FEED_URLS`. |

The Worker is not modified at any point before it is retired, so rollback never depends on restoring it. When the Worker is used as the
fallback, stories with a date more than a day ahead, a date before 2010, an unreadable date or a non-http(s) link are dropped; real dates are never
rewritten.

## Date rules (current)

- Collector: a publisher date more than 1 day in the future drops the story (bad feed clock). A date only slightly ahead, or before 2010, is treated as
  missing: the story shows "Date not provided" and is labelled with when it was first seen (kept separate from its publication date, never shown as one).
  Valid dates are stored exactly as the publisher gave them.
- Browser (`feed-build.js`): also drops any story whose reference time is more than a day ahead.
- Fallback Worker (`news-logic.js` legacy adapter): same rules as above, applied in the browser.

## Observed in the proof of concept: stories that "disappear"

Between a 03:xx and a 15:xx run 21 saved stories looked missing. Checked one by one against the live sources: 12 KWTX stories
(older than the oldest item KWTX lists now), 1 Gatesville Messenger "Briefs" item (the publisher's list now starts a week later), and 8
Lampasas Dispatch stories that were never removed: that site returns the same links with `https` at one time and `http` at another, so
a link comparison saw them as different. No story is discarded by our code before its source drops it, its `maxAgeDays`, or the per-source cap.
(Collected stories are replaced by each successful fetch of that source; keeping rolled-off stories until `maxAgeDays` would be a separate change.)

## Checks (run before merging)

```
node --test "test/*.test.js"                 # site: 44 tests
node --test collector/test/collect.test.mjs  # collector: 11 tests
cd rss-worker && npm test                    # library + legacy Worker: 77 tests
node collector/test/browser-check.cjs <news.json>   # manual: Playwright + axe, needs playwright-core / axe-core from other projects
```
