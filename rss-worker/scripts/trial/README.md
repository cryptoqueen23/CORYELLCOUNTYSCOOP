# Trial tools (CPU / reliability / site checks)

Scratch tools used for the 2026-10 Worker CPU trials. Paths inside are hard-coded to Mari's machine and to the
session scratchpad; edit them before reuse.

- `variant.cjs <label> <tail1.jsonl,tail2.jsonl> [--json out]`  CPU by response class and by source from `wrangler tail --format json` logs (merges redundant tails).
- `gate2.sh N tail1 tail2`  waits until N fetching runs are recorded, then prints the report.
- `clear.sh`  clears ONLY the test KV namespace (NEWS_KV_TEST) so a variant starts from the first-save state.
- `ticks.mjs <tail>`  checks every tick against the schedule (missing ticks, mismatches).
- `a11y.cjs`, `a11y2.cjs`, `nav.cjs`, `front.cjs`  Playwright checks (keyboard, zoom, axe, menu widths, feed compatibility). Need playwright-core and axe-core from other projects on this machine.
- `kwtx_cut.mjs`, `ag.mjs`  offline checks (KWTX truncation safety, Attorney General cold/warm parse cost).

Start a tail: `npx wrangler@4 tail coryell-county-rss-test --format json -c wrangler.test.local.toml > file.jsonl &`
(run two for redundancy; tail connections drop).
