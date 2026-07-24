# RSS Worker

A small Cloudflare Worker that pulls approved RSS/Atom feeds, converts them to
JSON, and serves the latest 8 headlines to the Coryell County Messenger site.
No database — results are cached at Cloudflare's edge for about 15 minutes.

## Deploy

1. Install Wrangler if you don't have it: `npm install -g wrangler`
2. From this folder, log in: `wrangler login`
3. Deploy: `wrangler deploy`
4. Wrangler prints your Worker URL.

Currently deployed at: `https://coryell-county-rss.truewolfflix777.workers.dev`

## Configure

Edit `worker.js`:

- `APPROVED_FEEDS` — the list of RSS/Atom feeds to pull from.
- `ALLOWED_ORIGINS` — the sites allowed to call this Worker. Add your custom
  domain here if you attach one to the Vercel deployment.

## Connect it to the site

Copy the deployed Worker URL into `RSS_WORKER_URL` at the top of `app.js` in
the project root, then redeploy the static site.
