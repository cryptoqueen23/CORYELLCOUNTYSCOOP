# The Coryell County Messenger

Keep these files in the same folder:

- index.html
- styles.css
- app.js
- mari-and-dog.jpeg
- video/coryellcourt.mp4

Open index.html to preview the website.

Before publishing, replace every instance of:

your-email@example.com

The Facebook group is already linked:
https://www.facebook.com/groups/255196943007202

## Latest Texas Headlines (RSS)

The homepage's "Latest Texas Headlines" section and the local weather card
are the only dynamic pieces of the site. Weather calls the free National
Weather Service API directly from the browser — no setup needed.

Headlines are different: browsers can't fetch most RSS feeds directly
because of CORS, so a small Cloudflare Worker fetches the feeds, converts
them to JSON, and caches the result. It's already deployed — see
[rss-worker/README.md](rss-worker/README.md) for the URL and how to
redeploy after changing the feed list or allowed origins.
