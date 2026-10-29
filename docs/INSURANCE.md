# Life & Health Insurance (the insurance flywheel)

The news brings residents to the site. This section gives interested visitors a
simple path to Marimer Cruz-Nieves's insurance business. It is presented as a
business service, separate from the news.

## What exists already (reused, not rebuilt)

Audited 2026-10-29. The insurance quoting, booking and licensing already live on
**phoenixsecuritas.com** and in the Linktree (`marislinktree`, published at
tree.phoenixsecuritas.com). This site links to them. It does not build a second
quote, CRM or booking system.

| Existing piece | Where | Used here |
|---|---|---|
| Life and health product pages, quote tools, lead form | phoenixsecuritas.com (`#products`, `#cta-heading`) | "Explore Life / Health Insurance", "Request a free quote" |
| Insurance 101 education page | phoenixsecuritas.com/insurance-101.html | "Read Insurance 101" |
| Telegram contact (primary) | t.me/mcn1611 | "Message me on Telegram" |
| Appointment booking | api.zybrzeus.com/calendar/mcruznieves | "Schedule an appointment" |
| Phone (512) 387-2748 | provided by Mari 2026-10-29; also on phoenixsecuritas.com | "Call" |
| Linktree hub | tree.phoenixsecuritas.com | "All my links" (also in footer, as before) |
| License | NPN 21566471; TX, FL, OH, NY (from the Linktree footer) | Disclosure line |

Not used: `mariscrm` (the audience CRM). Visitors go to Phoenix Securitas instead.
Nothing in the existing flywheel was removed or replaced. The site previously had
only an "Advertise with us" email link and the Phoenix Securitas footer link;
both are unchanged.

## Where it appears

1. Main navigation: **Life & Health Insurance** (outlined so it stands out), jumps to the section.
2. Homepage sidebar card: "Need life or health insurance?" with a "See your options" button.
3. Homepage section `#insurance`, below the news sections and above The Scoop,
   labelled "Business service from Marimer Cruz-Nieves. Not part of the news reporting above."

## Visitor journey

Discover (nav or sidebar card) -> choose **Explore Life Insurance** or **Explore Health
Insurance** -> Learn (Insurance 101) -> Request help (free quote on Phoenix Securitas) ->
Contact (Telegram, appointment, phone, all links).

## How visitors become leads

All lead capture happens on Phoenix Securitas (its quote and lead form), via
Telegram, your booking calendar, or phone. **This site collects no personal or
health information at all**: the only form on the site is the news search box. No
tracking scripts, pixels or analytics were added.

## Changing it without editing code

Edit `site-config.json` (in GitHub you can use the pencil icon, then commit; Vercel
republishes). You can change every label, description and link, or set
`"enabled": false` under `insurance` to hide the nav link, sidebar card and section.

- Links must start with `https://`, `tel:` or `mailto:`; anything else is ignored.
- If the file is missing or broken, the page shows the same defaults built into the HTML.
- `npm`-free check after editing: `node --test "test/*.test.js"` confirms the HTML
  defaults and config agree and no link is dead-looking (`#`).

## Open items for Mari

- The NIPR license-lookup link (`pnc.nipr.com`) that Phoenix Securitas uses could not
  be loaded from the machine used for testing, so it was not added. The license
  numbers are shown as text. Add a link in the section if you want one.
- The "Explore Life" and "Explore Health" buttons both go to the Phoenix Securitas
  products section today. If Phoenix Securitas gets separate life and health pages,
  change the two `url` values in `site-config.json`.
- Optional, needs your approval: send inquiries into `mariscrm`. Not done because it
  would need a new form, insurance-specific consent wording, and writing to its live
  database.
- Compliance wording (disclosures, state rules) was taken from your existing sites;
  have your compliance contact review before wide promotion.
