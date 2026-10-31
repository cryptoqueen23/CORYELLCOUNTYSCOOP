# Deployment checklist (final, nothing here has been run)

Status 2026-10-29: code is on branch `modernize-aggregator`, local only. No push,
merge, deploy, DNS change or Cloudflare/Vercel change has been made. Every step
below that touches Cloudflare or Vercel needs Mari's explicit approval first.

## What was verified (and how)

| Item | Result | Evidence |
|---|---|---|
| Vercel project and repo link | Project `coryellcountyscoop`, team `crypto-rican-queens-projects`, linked to github.com/cryptoqueen23/CORYELLCOUNTYSCOOP | GitHub commit status on `main` points to vercel.com/crypto-rican-queens-projects/coryellcountyscoop/...; 26 GitHub deployments, created by `vercel[bot]` |
| Production branch | Behaves as `main`: all 26 deployments are environment "Production" from commits on `main`; latest = `7574c18` = current `main` head; zero non-production deployments; repo has only a `main` branch; no `vercel.json` | GitHub API |
| Production branch **setting** | **Not directly read.** The connected Vercel tool cannot see this project (it lists only `gargoyle`) and the Vercel CLI is not logged in | Check in dashboard (below) |
| Preview deployments for other branches | **Unknown**: no other branch has ever been pushed, so this has never been exercised | Dashboard check |
| Cloudflare Free limits | 100,000 Worker requests/day; 10 ms CPU per invocation (HTTP and cron); 50 subrequests per invocation; 5 cron triggers per account; KV 100,000 reads and 1,000 writes per day, operations beyond that "fail with an error" (no charge described) | developers.cloudflare.com Workers limits, Workers pricing, KV pricing pages, fetched 2026-10-29 |
| Not stated by Cloudflare | Whether cron invocations count toward the 100,000 requests/day (about 720/day if so) | docs silent |
| Worker in the real runtime | Test Worker run locally in Cloudflare's runtime (`workerd` via `wrangler dev`): 5 cron runs filled all 17 sources, 16 healthy, no errors. Local CPU **cannot** be measured meaningfully (process readings include network and logging overhead) | Needs a trial deploy |
| Insurance links | 5 of 6 external links return HTTP 200 and every in-page anchor exists (see below) | HTTP checks and browser click-through |
| Licence and disclosure text | Copied word for word from phoenixsecuritas.com (legal page and home page footer): Phoenix Securitas Premium, NPN: 21566471, TX, FL, OH, educational-purposes disclaimer, Medicare plan-availability disclaimer with Medicare.gov and 1-800-MEDICARE | live site |
| "Free quote" / "free consultation" claims | Both appear on phoenixsecuritas.com | live site |
| NIPR licence lookup link | `pnc.nipr.com` does **not resolve** (DNS failure from two separate environments). That is the link Phoenix Securitas itself uses, so it may be dead on your own site too. Left off this site | see "Decisions for Mari" |

## KV write budget (free limit 1,000/day)

Changes made: the snapshot is only rewritten when what visitors see changes (or every
20 minutes as a heartbeat); fetching is batched (a source waits at most 25% of its own
interval so several can be fetched in one run); each run is limited by a CPU-cost budget.

Simulated day (`node rss-worker/scripts/simulate-day.mjs`): about 224 runs with work and
660 source fetches; **290 to 330 KV writes per day** (was an estimated 600 to 800),
leaving about 70% headroom. Local sources are still checked every 20 minutes (up to about
5 minutes later when batching). After deploy, `/health` reports the real counts under `today`.

## Phase 1: isolated trial Worker (needs approval; production untouched)

Uses `rss-worker/wrangler.test.toml`: separate Worker name `coryell-county-rss-test`,
separate KV namespace, its own `*.workers.dev` address. The production Worker, its KV
and the live site are not involved.

1. Confirm your account's cron-trigger count (limit 5 per account; the trial Worker uses 1, production later 1).
2. `wrangler login`; `wrangler kv namespace create NEWS_KV_TEST`; paste the id into `wrangler.test.toml`.
3. `wrangler deploy -c wrangler.test.toml`
4. In a second terminal: `wrangler tail coryell-county-rss-test --format json` and keep it running; each event includes `cpuTime` and `wallTime`.
5. Let it run at least 24 hours. Open `/health` on the test address a few times.
6. **Pass criteria (all must hold):**
   - `cpuTime` for scheduled runs: 99th percentile at or below 8 ms (limit 10); no run at or above 10 ms. Include the first runs after deploy (cold).
   - Zero "exceeded resource limits" (1102) or other exceptions in the tail.
   - `/health` `today.kvWrites` projected under 500 for a full day; `today.runs` plausible (about 720 cron runs).
   - After about 20 minutes `sourcesOk` is 16 of 17 (The Texan is rate-limited from some networks; that is accepted).
   - GET `/` responds in a few hundred ms and the page view CPU is a small fraction of 10 ms.
7. If CPU is too high: lower `RUN_BUDGET` in `lib/aggregate.js` (5 to 3), redeploy the test Worker, repeat. Do not move to Phase 2 until it passes.
8. Delete the trial Worker and its KV namespace afterwards (`wrangler delete -c wrangler.test.toml`) if production uses its own.

## Phase 2: production Worker (needs approval; after Phase 1 passes)

1. Back up the current production code reference: `wrangler deployments list` (note the current version id; this is the rollback target). Record that the current deployed version is the old single-file Worker.
2. `wrangler kv namespace create NEWS_KV` and put the id in `wrangler.toml` (uncomment the block).
3. `wrangler deploy` from `rss-worker/`.
4. Verify: `/health` works; within about 20 minutes `sourcesOk` is 16 of 17; open the live site (still the old version): it keeps working because the new Worker still returns `stories` and `electionStories`.
5. Rollback: `wrangler rollback` (restores the previous version). Independent of the site.

## Phase 3: website (needs approval; after Phase 2 is healthy)

1. Vercel dashboard, project `coryellcountyscoop`, Settings, Git: write down the Production Branch (expected `main`), confirm "Ignored Build Step" is empty, and that Preview Deployments are on.
2. Approved push of branch `modernize-aggregator` only (not `main`). Expect a **Preview** deployment URL in the Vercel dashboard or as a GitHub commit status. If a Production deployment appears instead, stop (Production Branch is not what we think).
3. On the preview: check headlines load, filters, insurance section and every CTA, mobile menu, `/health`.
4. Approved merge into `main`. Vercel deploys Production automatically.
5. Verify live: https://www.coryellcountyhub.xyz/ and https://coryellcountyscoop.vercel.app/ show the new page and "Headlines updated ..." text.
6. Rollback: Vercel, Deployments, promote the previous production deployment (instant), or `git revert` the merge commit and push.

## Phase 4: first week

- Daily for 3 days: `/health` (sources, `today.kvWrites`), the "Source status" list on the page.
- Watch the Cloudflare dashboard for Worker errors; if any 1102, lower `RUN_BUDGET`.
- No DNS changes are part of this plan.

## Decisions for Mari before or during deployment

1. **NIPR licence link** on phoenixsecuritas.com (`pnc.nipr.com/...`) does not resolve. Check it on your own site and replace it with a working lookup. This site shows the licence as text only.
2. **Insurance buttons**: "Explore Life" and "Explore Health" both go to `phoenixsecuritas.com/#products`. Give separate pages if you have them (edit `site-config.json`).
3. **Compliance review**: the disclosure wording was copied from your existing site, not newly written; confirm it still matches what your agency or compliance contact requires, especially for the Medicare mention on the Health card.
4. **Phone**: (512) 387-2748 was provided by you and also appears on phoenixsecuritas.com. Earlier notes say this is a privacy-shield (Google Voice) number and you had removed tap-to-call from your Linktree for that reason; to take it off this site set `insurance.phone.url` to an empty string `""` in `site-config.json` (the button disappears).
5. `mariscrm` is not connected. Say so if you want inquiries sent there later.
6. Approve whether to commit this latest work as a second local commit (currently uncommitted).
