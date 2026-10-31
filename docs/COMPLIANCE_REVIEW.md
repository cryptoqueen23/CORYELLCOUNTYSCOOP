# Insurance wording flagged for compliance review

Status 2026-10-29: **not reviewed by a compliance professional.** Nothing below has been
rewritten; it is copied from phoenixsecuritas.com. Do not edit regulated wording without
approval from Mari and, where required, her agency or compliance contact.

## Where the regulated text is

| Text | File and key | Source |
|---|---|---|
| Full disclosure paragraph (Phoenix Securitas Premium, NPN: 21566471, licensed in Texas, Florida, Ohio and New York, educational-purposes statement, carrier and state variability, eligibility, **Medicare plan-availability statement with Medicare.gov and 1-800-MEDICARE**) | `site-config.json` `insurance.disclosure`, and the same default in `index.html` | Word for word from phoenixsecuritas.com (legal page and home page footer), copied 2026-10-29 |
| License line "NPN: 21566471. Licensed in TX, FL, OH and NY." | `insurance.licenseLine` | phoenixsecuritas.com license strip |
| "Quotes and consultations are free" / "Quotes are free" | `insurance.lead`, `insurance.promo.text` | phoenixsecuritas.com says "Free quote" and "Free consultation" |

## Specific points for the reviewer

1. **Medicare mention.** The Health card says "including marketplace plans and Medicare". The Medicare disclaimer is shown in the same section, but at the foot of it, not next to the card. Medicare marketing is regulated (CMS); confirm whether the disclaimer must sit adjacent to, or whether the Medicare words should be removed from this page.
2. **Not a licensed-state-only audience.** The site is read by Coryell County, Texas residents but the license line lists four states. Confirm no state-specific language or filing is needed for Texas advertising (for example, advertisement and name requirements).
3. **"Free" claims** are taken from the existing site; confirm they are acceptable in an advertisement.
4. **Phone number** (512) 387-2748 is left exactly as provided. Decision pending from Mari.
5. **No prices, rates, carrier names or coverage promises** appear on this site (checked by an automated test).
6. **The business-service label** ("Business service ... Not part of the news reporting") is there to separate advertising from news.

## License verification

NIPR has no public consumer lookup that works from a link, and `pnc.nipr.com` (used by phoenixsecuritas.com)
does not exist. This site links to the Texas Department of Insurance consumer lookup
(https://www.tdi.texas.gov/agent/agent-lookup.html), which was confirmed live and official on 2026-10-29. The dead
link on phoenixsecuritas.com was not changed (a different site).
