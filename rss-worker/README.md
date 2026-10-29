# News Worker

Cloudflare Worker that collects approved sources (see [SOURCES.md](SOURCES.md)),
classifies and de-duplicates them, and serves one JSON snapshot to the site.
No database.

- `GET /` snapshot: `{ schema: 2, generatedAt, stories[], health[], sourcesOk, sourcesTotal }`
- `GET /health` per-source status
- Cron: every 2 minutes. A run only starts when work has piled up (or a source has waited
  25% past its interval), then fetches the most overdue sources up to a CPU-cost budget
  (`RUN_BUDGET` in `lib/aggregate.js`, each source's `cost` in `lib/sources.js`), to stay
  inside the free plan's 10 ms CPU limit and 1,000 KV writes/day. Estimated 290-330 KV
  writes a day. Each source has its own interval (15 to 120 minutes) in `lib/sources.js`.

## Isolated test Worker

`wrangler.test.toml` defines `coryell-county-rss-test`: a separate Worker with its own KV
namespace, so production is untouched. Locally: `wrangler dev -c wrangler.test.toml
--test-scheduled --persist-to .wrangler-test`, then GET `/cdn-cgi/local/scheduled` to run a
cron tick. For real CPU numbers, deploy it (needs approval) and run
`wrangler tail coryell-county-rss-test --format json` (shows `cpuTime`). Full procedure and pass
criteria: [../docs/DEPLOYMENT_CHECKLIST.md](../docs/DEPLOYMENT_CHECKLIST.md).

`node scripts/simulate-day.mjs` estimates a day of runs and KV writes from the registry.

## Develop and test

```
npm test                 # unit + handler tests, no network
node scripts/smoke.mjs   # fetches every live source and prints the result
```

## Deploy (separate from the website)

Vercel deploys the static site only. The Worker is deployed with Wrangler:

1. `npm install -g wrangler` and `wrangler login`
2. **Create the KV namespace (required for reliable operation):**
   `wrangler kv namespace create NEWS_KV`, then uncomment the `[[kv_namespaces]]`
   block in `wrangler.toml` and paste the id. Without it the cron job and your visitors
   use different Cloudflare caches and do not see each other's data.
3. `wrangler deploy` from this folder
4. Wait about 20 minutes: the first runs fill in sources two at a time. Check
   `https://coryell-county-rss.truewolfflix777.workers.dev/health`.

Currently deployed at that URL (the previous version, until you redeploy).
**Roll back** with `wrangler rollback`.

The snapshot still includes `stories` and `electionStories`, so the old site keeps
working if the Worker is deployed first. Deploy the Worker first.

## Configure

- Sources and refresh intervals: `lib/sources.js` (the only way to allow a new host).
- CPU budget per run: `RUN_BUDGET` in `lib/aggregate.js`. If Cloudflare reports
  "exceeded resource limits" (error 1102) for cron runs, lower it (5 to 3).
- Allowed browser origins: `ALLOWED_ORIGINS` in `worker.js`. Add a new site domain here.
- Classification terms: `lib/classify.js`.
