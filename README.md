# The Coryell County Messenger

Static site (Vercel) plus a Cloudflare Worker that gathers local and Texas news
automatically. Nothing is published by hand.

Files at the site root: `index.html`, `styles.css`, `app.js`, `news-logic.js`,
`mari-and-dog.jpeg`. `video/coryellcourt.mp4` is kept but no longer loaded.

Preview locally: open `index.html` (it fetches headlines from the deployed Worker).

- Worker, sources, deploy: [rss-worker/README.md](rss-worker/README.md), [rss-worker/SOURCES.md](rss-worker/SOURCES.md)
- Audit, architecture, test results, limitations: [docs/MODERNIZATION.md](docs/MODERNIZATION.md)
- Life & Health Insurance section and how to edit it: [docs/INSURANCE.md](docs/INSURANCE.md)
- Editorial rules for contributors: [CLAUDE.md](CLAUDE.md)

Tests: `cd rss-worker && npm test`, and `node --test "test/*.test.js"` here.

Contact: marimercruz8@gmail.com. Facebook group: https://www.facebook.com/groups/255196943007202
