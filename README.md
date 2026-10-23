# snippets-news-index

> **Pre-live trial.** This repository supports a private, pre-launch news-reader project. It is not a product, not an API with any guarantee, and may change or disappear without notice.

Every 15 minutes a GitHub Actions job reads the public [GDELT Project](https://www.gdeltproject.org/) Global Knowledge Graph files, groups headlines about the same story, ranks them, and publishes small JSON "shards" on GitHub Pages. A Cloudflare Worker reads one shard per request to show Live and Curated news lists.

**Contains data from The GDELT Project, https://www.gdeltproject.org/**

Not affiliated with, endorsed by, or sponsored by GDELT or by any news outlet named in the data.

## What is published
Only: story headline (as published by the outlet), link to the outlet's page, outlet name (domain), time, GDELT tone (not for crime/court/named-person stories), topic tags, and which place page it belongs to. No article text. No GDELT person or organisation lists. No tracking.

- `places.json` — which place/topic/period shards exist, plus `generatedAt` (time of the newest GDELT batch), `builtAt` (when this build ran) and `attribution`.
- `live/<place>/<topic>.json` — last ~6 hours, newest first.
- `curated/<24h|7d|30d>/<place>/<topic>.json` — ranked by number of distinct outlets, recency and prominence.
- Every shard carries an `attribution` field.

## Policy built into the build (see `lib/policy.mjs`)
- Retention: Live ≤ 6 h of stories (shards are replaced every run, nothing is accumulated); Curated ≤ 30 days; crime/court/named-person ("flagged") stories ≤ 7 days, removed from stored state too.
- Flagged stories: the publisher's headline is kept unchanged, no tone, no ranking boost, placed on a place page only if the place is named in the headline.
- Stories about minors in conflict with the law or victims of sexual offences are dropped at ingest. Stories that state guilt as fact about a person are held back.
- `blocklist.json` (the single blocklist, schema `snippets.blocklist.v1`): hashed URL / story id / domain / term entries (hashes and reason codes only, no URLs). Anything matching is never stored and is removed from every shard on the next build. The Worker reads the same published file. Add rows with `node blocklist-tool.mjs add url <url> --reason LEGAL`.
- `corrections.json` (schema `snippets.corrections.v1`): published corrections, served by the Worker as `GET /api/corrections` and shown on the story. `node test-editorial.mjs` tests the v1.5 behaviour (headline cleaning, health/election flags, blocklist).
- Shards are **not committed to git**. Each run publishes them as a Pages artifact, so there is no headline history in this repository. `robots.txt` asks crawlers not to index the site.

## Run locally
```
node ingest.mjs backfill --days 1 --state ./state --out ./build
node test.mjs build
```
Node 20+ . No dependencies.

## Layout
`ingest.mjs` (CLI), `lib/` (GDELT download/parse, junk filter, places, topics, clustering, ranking, policy), `vendor/` (copies of the Worker's `cluster.js`, `guard.js`, `resolver.js`; refresh with `sync-vendor.sh` in the main project), `geo/` + `data/` (place and outlet-country data, credits in `DATA-NOTICE.md`), `.github/workflows/index.yml`.

See `DATA-NOTICE.md` for data licences and credits, and `PLAN.md` for design notes. Code: MIT.
