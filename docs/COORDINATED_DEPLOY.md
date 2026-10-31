# Coordinated deployment and rollback (Worker + site)

Nothing here has been run against production. Every step needs Mari's explicit approval.

## Why order matters

The new Worker returns `schema: 3` (one saved record per source). The currently deployed
site only understands the old formats, so a new Worker with an old site shows
"Headlines are temporarily unavailable". The new site (`feed-build.js` + `app.js`) reads
**all three** formats:

| Worker response | New site | Old site |
|---|---|---|
| Old production Worker (plain `{updated, stories}`) | works (legacy adapter, Texas Headlines only) | works |
| Schema 2 (modernize-aggregator Worker) | works | works |
| Schema 3 (this branch) | works | **breaks** |

So the new site is safe to deploy before the Worker, and a Worker rollback is safe while the
new site is live. The only unsafe order is Worker first, or rolling the site back while the
schema 3 Worker is still serving.

## Deploy order

1. **Pre-flight (no changes).** `npm test` in `rss-worker/` and `node --test "test/*.test.js"` at the root,
   both green. Record rollback targets: `wrangler deployments list` (production Worker version id) and the
   current production Vercel deployment id/commit (`7574c18`).
2. **KV.** `wrangler kv namespace create NEWS_KV`; put the id in `wrangler.toml` (uncomment the block).
   This is new storage; the old Worker ignores it.
3. **Site first.** Merge the branch to `main` (Vercel auto-deploys). Verify the live site against the
   still-old Worker: headlines load (legacy list), no console errors, menu works at 320/768/1440 px.
   Rollback if bad: Vercel dashboard, promote the previous deployment.
4. **Worker second.** `wrangler deploy` from `rss-worker/`. Do not check the site yet: the first runs
   fill sources one per 2-minute tick, so the feed is thin until the first full cycle (up to 4 hours for
   the slowest sources; local sources within about 15-30 minutes). `/health` shows `pending` until each source
   has run once.
5. **Verify** `/health` (sources ok, `lastConfirmed` recent) and the live site (local sections populated,
   no 2028 or pre-2026 items at the top).
6. Watch `wrangler tail` for the first hour for errors and CPU time.

## Rollback

| Symptom | Action | Safe because |
|---|---|---|
| Worker misbehaving (errors, CPU, bad data) | `wrangler rollback` (restores previous Worker) | New site still reads the old format |
| Site misbehaving, Worker fine | Vercel: promote previous deployment | Only safe if the Worker is **also** rolled back first (old site cannot read schema 3). Do the Worker rollback first. |
| Both | Roll back Worker, then site | |

The KV namespace can stay; it is unused by the old Worker.

## Not decided here

Whether to keep the old Worker's `stories` field alongside schema 3 for a single-step deploy. It
would cost CPU on every feed assembly, which is the thing being avoided, so the two-step order above
is recommended instead.
