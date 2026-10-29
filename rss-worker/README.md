# News Worker

Cloudflare Worker that collects approved sources (see [SOURCES.md](SOURCES.md)),
classifies and de-duplicates them, and serves one JSON snapshot to the site.
No database.

- `GET /` snapshot: `{ schema: 2, generatedAt, stories[], health[], sourcesOk, sourcesTotal }`
- `GET /health` per-source status
- Cron: every 2 minutes. Each run fetches only the 2 most overdue sources
  (`MAX_SOURCES_PER_RUN` in `lib/aggregate.js`) to stay inside the free plan's
  10 ms CPU limit. Each source also has its own minimum interval in `lib/sources.js`.

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
- Sources per run: `MAX_SOURCES_PER_RUN` in `lib/aggregate.js`. If Cloudflare reports
  "exceeded resource limits" (error 1102) for cron runs, lower it to 1.
- Allowed browser origins: `ALLOWED_ORIGINS` in `worker.js`. Add a new site domain here.
- Classification terms: `lib/classify.js`.
