# Snippets — GDELT bulk-file index (workaround for slow / 429 DOC API)

Status (23 Oct 2026, IST): **pre-live trial built.** Code is in the public repo `sjanarda85/snippets-news-index`; the Worker (`worker/src/index-client.js`, `blocklist.js`) and front-end (`feed-modes.js`) read it. Sections 0-9 are the original research (kept for the numbers); **section 10 is the current design, Legal conditions and runbook and wins where they differ.**
All numbers below were measured on this box from real GDELT files (72 h ending 2026-10-23 04:00 UTC) unless marked *estimate* or *unverified*.

## 0. Verdict
**Feasible, and cheaper/faster than the live DOC calls.** GDELT's free 15-minute GKG files carry, per article: URL, outlet domain, headline (`PAGE_TITLE`), publish time, tone, themes and geocoded locations — enough to build *live* and *curated* views by place and topic without the DOC API. The heavy part (≈1.5 GB of zips per 72 h) cannot run in a Worker (10 ms CPU on Free), so ingestion runs on **GitHub Actions** and publishes **static JSON shards**; the Worker (or the browser) reads one small file per request. Recommended: **A = GitHub Actions → GitHub Pages (public repo), plus D = live DOC fallback for anything not indexed. Cost ₹0/month.**
The prototype is in `ingest/` (Node ESM, zero dependencies; reuses `worker/src/cluster.js` and `guard.js` so story ids and legal flags match the site).

## 1. GDELT investigation
* `lastupdate.txt` (≈0.1 s): 3 lines — export, mentions, **gkg** zip URL + size + md5. New files appear every 15 min (:00 :15 :30 :45). `masterfilelist.txt` is 128 MB (1.2 M lines) — not needed: file names are deterministic stamps (`YYYYMMDDHHMMSS.gkg.csv.zip`), so backfill builds URLs directly. Range requests work.
* **Hosts:** `http://data.gdeltproject.org` (port 80) timed out from this sandbox → use HTTPS. The newest ~1 h of files 404s on `https://data.gdeltproject.org/gdeltv2/` but exists on `https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/` → ingester tries the GCS URL first, then the data host; validates the `PK` zip signature (GCS 404 returns an XML body).
* **GKG 2.1** = 27 tab-separated columns. Used: 3 domain, 4 URL, 7 themes, 10 V2EnhancedLocations (`type#name#FIPS#ADM1#ADM2#lat#lon#id#charoffset`), 15 V2Tone, 26 Extras XML (`PAGE_TITLE`, `PAGE_PRECISEPUBTIMESTAMP`). Deliberately **not** stored: quotations, persons, orgs, images, GCAM, amounts, links.
* Main stream is 100 % English-language *sources*; titles are HTML-entity-encoded (decoded). The separate *translation* stream (2.7 GB / 72 h, 690 k rows) has titles in the **original language** → not usable for English feeds; relevant only for a future `lang=hi/ml/…` phase (Malayalam ≈ 0.3 % of rows ≈ 2.2 k / 72 h).
* GDELT's own domain→country list (`DOMAINSBYCOUNTRY-ALLLANGUAGES.TXT`, 975 KB, 32.8 k domains) gives each outlet's country → implements the site's default "from"/sourcecountry scope (ingester-side only).
* **Licence / attribution:** GDELT's "Using GDELT" page states all datasets are free for unlimited, unrestricted academic, commercial or governmental use. It is metadata: it cannot license publishers' text. We keep headline + link + outlet name only (no body, quotes, images); summaries stay ≤60 words, in new words, multi-outlet only, and wire/exclusive/single-source = headline-only (guard.js). Show "News metadata: GDELT Project" credit (exact citation wording not verified from the page — ask GDELT / owner to confirm; the earlier legal review already recommends written confirmation for commercial dependence).

## 2. Measurements (this box, 1 core)
| Item | Result |
|---|---|
| One 15-min file | ~1,216 rows avg (596–1,998), zip 5.2 MB avg (max 8.5), 16 MB unzipped; fetch ≈ 0.3 s (GCS), parse+filter+enrich ≈ 0.2 s, **batch state file ≈ 70 KB gz** |
| 72 h main stream (288 files) | 349,521 rows, 1,501 MB zips, **download 7.8 s** (6 parallel, ~180 MB/s); **ingest 63–73 s** CPU (0.25 s/file) |
| Junk dropped | 17.9 % of rows → kept 287,102. Reasons: domain blocklist 16.6 k (iheart radio, press-release wires, marketbeat farms), per-batch per-domain cap 24.5 k, stubs (<50 words) 11.6 k, URL patterns 4.3 k, <4-word titles 3.8 k, title patterns (horoscope, coupons, obituaries, stock-bot) 1.2 k, non-Latin 0.4 k |
| Clustering 72 h | 287 k articles → **134,946 stories** in 21 s (inverted index; O(n²) would not finish). 16.5 k multi-outlet stories feed 7d/30d |
| Full build (cluster + rank + write ~13 k files) | **38–47 s** (load 1 s, cluster 21 s, day roll-ups 0.6 s, 30 d merge 1.3 s, rank+write 15–17 s) |
| Incremental `update` (real network) | 3 new batches fetched+processed in 0.5 s; whole run incl. rebuild **47 s** |
| State kept | 72 h batches 28 MB gz + day roll-ups 1.6 MB gz/day → **≈ 76 MB at 30 days** (rebuildable by backfill) |
| Places with shards (72 h, any period) | **209 countries** (from-/about- keys), 6 continents + world, **436 states/provinces, 575 cities**. In 24 h: 293 country keys, 291 states, 344 cities |
| Shard sizes | avg ≈ 14 KB, max 62 KB (25–40 stories each, ≤5 sources/story) |
| Total published | live 1,371 files **18.8 MB** (4.7 MB gz) · 24h 3,691 files 51.6 MB (12.8 gz) · 7d 2,934 files 61.9 MB (14.3 gz) · 30d 2,934 files 61.9 MB (14.2 gz) → **≈ 194 MB raw / 46 MB gz** (3d period optional: +86 MB, dropped) |

**30-day backfill (extrapolated from the 72 h run, not run in full):** 2,880 files ≈ 15 GB download ≈ 1.5–2 min; parse ≈ 10–12 min on one core (processed day by day, memory flat, resumable); state ≈ 76 MB; 30 d merge ≈ 15–20 s, build ≈ 1 min. Shard files for 7d/30d will grow to roughly 1.5–2× the counts above once 30 days of data exist (*estimate*: ~250 MB raw / ~60 MB gz for the whole site, far below Pages' 1 GB cap). Fits one Actions job (6 h limit) with huge margin. The 72 h test also covers 7d/30d code paths (they simply equal 3 days of data today).

## 3. Data model
**Pipeline:** zip → parse → junk filter → `enrich` (topic tags, place keys, outlet country) → per-batch compact article file → cluster (same normTitle/tokens/0.42 similarity as the site; anti-drift "core tokens" so big clusters don't swallow unrelated headlines) → story records → rank → shards.

**Story record (stored/served; compact):** `id` (FNV of lead normTitle, same as cluster.js), `headline` (cleanHeadline of lead), `firstSeen`, `updatedAt`, `outlets` (distinct domains), `localOutlets`, `why`, `category`, `tags`, `sources[≤5] {outlet (plain text), url, title (if different), publishedAt}`, `tone`, `headlineOnly` (`wire|exclusive|single-source`, computed by guard.js over **all** sources), `needsReview` + `reviewReasons` (guard.js over headline + shown titles). No summaries in the index.

**Place keys** (use the front-end's own ids/names/FIPS from `site/assets/data`): `world`; `r-<Continent>`; `from-<ISO2>` (stories carried by that country's outlets — the site's default country view; ranked by *local* outlet count, "20 in India"); `about-<ISO2>` (stories whose subject is that country); `s-<ISO>-<state-slug>` (e.g. `s-IN-kerala`); `t-<ISO>-<city-slug>` (state-suffixed only for duplicate names). State/city shards = stories mentioning the place with ≥1 outlet from its country (= scope "from"). Aliases mirror live.js ALIASES / map2 ALT (Keralam, Cochin, Trivandrum, Calicut, Bangalore, Bombay, Madras, Orissa…).
Article↔place rule (tuned on real data): place is **in the headline** (found by name — GKG locations alone missed most Kochi headlines: 25 vs 3) **or** is what the article is mainly about (top country; state/city ≥3 mentions and top-2). A passing body mention no longer pulls a Scottish story onto the India page.

**Topics:** tags from GKG themes + headline words (GKG has no sport/entertainment theme): technology, ai, science, space, business, sports, cricket, health, politics, election, world, climate, monsoon, entertainment (+ crime only inside "all"). Site chips map via `CHIP_TAG` (`economy→business`, `"artificial intelligence"→ai`, …). Free-text `q` that is not a chip → not indexed → live DOC fallback.

**Modes / periods:**
* **Live** (`live/…`): stories whose newest article is within the last **6 h**, sorted by `updatedAt` desc (≤40; single-source allowed, shown headline-only). Refreshed every 15-min batch.
* **Curated** (`curated/{24h,7d,30d}/…`): score = 2.2·ln(effective outlets) + 1.6·recency decay + 0.8·prominence (word count, |tone|) + 0.5·days-covered; half-lives 8 h / 48 h / 10 d. Effective outlets = *local* outlets for from-/state/city shards; "syndication-only" domains (fake-local press-release networks, local radio; 290 found) count 0.3. Top 30 (25 per topic), dedup by normTitle, multi-outlet preferred. `why` = "12 outlets · 8 in India · covered over 3 days · still developing".
* Day roll-ups (`state/days/YYYYMMDD`, multi-outlet stories only, ~29 % of a day) are frozen once the day ends; 7d/30d = merge of roll-ups by the same clustering. 24h/live come from the 72 h window.

## 4. API and front-end
`GET /api/snippets?place=&country=&fips=&state=&q=|topic=&scope=&lang=&fast=1` **+ new** `mode=live|curated` (default live), `period=24h|7d|30d` (curated only), optional `key=` (map id → `s-IN-kerala` directly). Response stays `snippets.feed.v1` (adds `mode`, `period`, `batch`, `generatedAt`, `attribution`, `note` when a parent place was substituted, `summaryEligible[]`). Resolution (`resolver.mjs`, tested in `test.mjs` with the real param shapes): world → continent → `from-`/`about-` → state → city; a city/state/tag with too few stories **falls back to its parent** (Kochi → Kerala → India, never silently to world) and says so; live-empty → same place curated 24h; unknown place/free-text/`lang≠en` → live DOC path (hybrid).
Front-end: Live | Curated segmented toggle under the place title; Curated shows period pills 24h · 7d · 30d (default 24h; remember in localStorage); keep topic chips and language filter. Live polls every 2–5 min: data only changes per batch, so poll with ETag/`batch` and re-render only when it changes; mark stories with `updatedAt` newer than the last poll as "new". Show "Updated 12 min ago · News metadata: GDELT" and the `why` hint on every card.

## 5. Architecture comparison
Sizes: ≈ 11 k files, 194 MB raw (46 MB gz) now; live set alone 1,371 files / 4.7 MB gz rewritten every 15 min.

| | Free-tier math (verified limits) | Verdict |
|---|---|---|
| **A. GitHub Actions → GitHub Pages (public repo, custom workflow)** | Actions: public repo = unlimited minutes; run ≈ 2–2.5 min × 96/day. Pages: site ≤ 1 GB, soft 100 GB/month bandwidth, the 10-builds/h soft limit **does not apply** to custom workflows. Auth = built-in `GITHUB_TOKEN`, **no secret, no Cloudflare change**. Worker/browser reads static JSON (CORS-open). | **Recommended** |
| A′. Same but private repo | 2,000 free min/month: 15-min cadence ≈ 5.8 k min ✗; hourly ≈ 1.4 k ✓ (Pages from private repos needs a paid GitHub plan — *unverified*) | only if hourly is acceptable |
| **A2. Workers KV** | Free: **1,000 writes/day**, 100 k reads/day, 1 GB. We need ≥ 1,371 live keys × 96 runs/day ≈ 131 k writes/day ✗ (even one refresh of all ~11 k keys ✗). Usable only for a tiny pointer (`latest` batch) | ✗ for shards |
| **B. D1** | Free: **100 k rows written/day** (indexes count extra), 5 M reads, 5 GB; since 2026-09-01 queries *fail* past the limit. 1,371 live rows × 96 = 131 k/day ✗; hourly live + hourly 24h ≈ 120 k ✗ | ✗ on free; fine on Paid ($5/mo ≈ ₹420, needs VP Finance) |
| **R2** (extra) | 1 M Class A writes/month free; 15-min live (3.9 M) + hourly 24h (2.7 M) + daily 7d/30d (0.2 M) ≈ 6.8 M → ≈ USD 26 ≈ **₹2,200/month** > the ₹2,000 flag; needs a card on the account | ✗ unless bundled/finance approves |
| **C. Always-on machine / owner PC** | ₹0 compute but no uptime guarantee, needs inbound/outbound credentials | ✗ |
| **D. Hybrid with live DOC fallback** | Index answers world/continent/country/state/major-city × 14 topics × live/24h/7d/30d; DOC only for free-text q, tiny places, non-English. DOC traffic drops by the share of requests served from the index; prewarm cron can be reduced | **Adopt together with A** |
| Cloudflare Pages / static assets redeploy | needs a scoped CF API token (account change) and deploy-count limits (*unverified*) | not without owner approval |

**Worker read (fast=1):** one `fetch` of `places.json` (48 KB gz, isolate-cached 10 min) + one shard (≤ 55 KB, cached 60 s) + `JSON.parse` ≈ 1 ms CPU ≪ 10 ms; 2 of 50 subrequests. `worker-read.sketch.mjs` shows it. Workers Free 100 k requests/day ≈ 30 k reader sessions of 3 polls; **or the browser can read the Pages JSON directly** (0 Worker requests) and call the Worker only for summaries of `summaryEligible` ids. Freshness: GDELT batch (≤15 min) + cron slot/delay (5–25 min, GitHub cron is best-effort) + Pages CDN cache (~10 min) ⇒ typically 15–45 min behind real time, similar to DOC's own indexing lag; to tighten, publish a tiny `latest.json` and fetch shards as `?v=<batch>` (*to verify at implementation*).
**Secrets:** none for A (GITHUB_TOKEN only). GDELT needs no key. Never put a Cloudflare token in the repo; only if the owner later wants a KV pointer: KV-write-only token as an Actions secret.
**Failure modes:** GDELT file missing/late → stamp skipped, next run catches up (≤ 288 batches) and the UI shows `batch` age; GitHub cron skipped/late → stale-but-valid files, Worker falls back to DOC when `generatedAt` is > 2 h old; scheduled workflows in public repos are disabled after 60 days without repo activity (*known GitHub behaviour, verify*) → add a weekly keep-alive commit and an uptime check; Actions cache evicted → workflow auto-runs `backfill --days 30` (~15 min); Pages deploy failure → previous site stays live; bad build → `test.mjs` invariants fail the job before deploy. Example workflow: `ci/snippets-index.yml.example`.

## 6. Legal / content risks
1. **Summary eligibility is low under the current guard.** Of 13,865 stories in all 24h shards: 37 % single-source, 7 % wire (any wire domain among *all* sources), 0.5 % exclusive, 54 % needs-review (named-person regex alone 46 %, crime/court 16 %); only **20.7 % are summary-eligible (10 % in the head shards: world/India/Kerala)**. If every needs-review item goes to humans it is unmanageable → owner decision: auto headline-only for needs-review, and/or tune `NOT_PEOPLE`/wire logic (large clusters touched by one wire outlet are headline-only today).
2. Headlines are publishers' text; display = headline + link + plain-text outlet name only, as today. No body text/quotes/images are ingested. Meta-description fetching for summaries stays in the existing guarded path (robots/opt-out).
3. GitHub Pages terms exclude hosting a free site "primarily directed at … commercial transactions or … SaaS". A data-only static index of public headlines is probably fine, but if the news site is monetised the owner should confirm (fallback: R2/paid Worker plan, §5).
4. Repo and index would be **public**; contains only already-public headlines/URLs plus our tags.

## 7. Technical risks / limits seen in the data
* Place precision is heuristic: spot-check of Kerala 24h top-10 ≈ 7/10 clearly Kerala-relevant (misses: a Sri Lanka landslide, a Chennai alert). Known false hits: "Cochin Shipyard" → Kochi, "Mumbai Indians" → Mumbai.
* Small places are sparse in GDELT (Kochi: 4 stories/24h, 2 in 7d on 3 days of data) → parent fallback. Topic shards for small states need ≥5 stories; more appear at 30 days.
* Topic tags are union-of-members and noisy (themes like KILL/NATURAL_DISASTER spill into crime/climate); clustering still merges some near-duplicate stories or splits one story into two.
* Press-release/syndication networks inflate outlet counts (mitigated by domain weights, not eliminated). Sources are 100 % English-language outlets in this stream.
* Single upstream (GDELT): if GDELT stalls the index goes stale (shown via `batch`).
* India-local news is thinner than global news in this stream; `from-IN` ranks by Indian outlets to compensate.

## 8. Owner decisions / approvals needed (original list; see section 10 for what was decided)
1. Choose hosting: **new public GitHub repo + Pages (₹0)** vs paid option (R2 ≈ ₹2,200/mo, Workers Paid ₹420/mo + finance). Creating the repo, enabling Pages and the Actions workflow = external changes → needs explicit approval.
2. Confirm GDELT commercial use in writing and the attribution wording.
3. Legal sign-off on the flag policy (§6.1) and on serving headlines from the index.
4. Approve the front-end/API changes in §4 and whether to retire the worker prewarm cron once the index is live.
5. Optional later: Indic-language phase via the translation stream; KV pointer (needs a scoped Cloudflare token).

## 9. Files
`ingest.mjs` (CLI: `update | backfill --days N | build | one`), `lib/{gdelt,places,topics,junk,cluster,outlets,build}.mjs`, `resolver.mjs`, `test.mjs`, `measure_raw.py`, `worker-read.sketch.mjs`, `ci/snippets-index.yml.example`, `data/DOMAINSBYCOUNTRY-ALLLANGUAGES.TXT`, `out/` (samples: `live/…`, `curated/{24h,7d,30d}/…`, `places.json`, `_report.json`, `SAMPLES.md`). Not kept in git: `raw/`, `state/`, `build/`.
Run: `node ingest.mjs backfill --days 3 --nobuild && node ingest.mjs build && node test.mjs build`.


## 10. Trial build: what runs, Legal conditions, runbook (23 Oct 2026)

**What runs.** `.github/workflows/index.yml` (cron `7,22,37,52 * * * *`, odd minutes on purpose; `workflow_dispatch` takes `backfill_days`) restores `state/` from `actions/cache`, runs `node ingest.mjs update` (fetch new 15-minute GKG files from storage.googleapis.com then data.gdeltproject.org, filter, cluster, rank), then publishes `public/` + the shards with `actions/upload-pages-artifact` + `actions/deploy-pages` (GITHUB_TOKEN only, no secrets). First run backfills 7 days; each later run grows the state toward 30 days (`--grow-days`). A weekly heartbeat commit to `HEARTBEAT.txt` keeps GitHub from disabling the schedule after 60 days of repo inactivity. **Shards are never committed to git.**

**Worker read path (owner decision 23 Oct: "do the same as Inshorts").** Collect ahead of time, store, serve every reader from the stored copy. `places.json` (+ one shard) from `INDEX_BASE_URL` answers every request (World, India, states, cities, topics, free-text search over stored stories, legacy requests without `mode`). The live DOC API is NOT on the reader path (default `DOC_FALLBACK="off"`); an old index is shown with an "updated X ago" note; only a cold isolate with Pages unreachable returns a friendly 503. Details in `worker/DEPLOY.md` > "GDELT index (trial)".

**Legal conditions implemented (Legal review section 10):**
| | Condition | Where |
|---|---|---|
| a | Trial hosting is for **pre-live only**. Before any paid plan: private store read by the Worker (e.g. R2 or a private origin), scheduler off GitHub. Hosting stays swappable (`INDEX_BASE_URL`). | `wrangler.toml`, DEPLOY.md |
| b | No shard commits; Pages artifact only. | workflow |
| c | Odd-minute cron; weekly heartbeat; `generatedAt` + `builtAt` in `places.json` and every shard; Worker marks the index stale when `builtAt` > 45 min old and says so; older: still shown with an age note (the live DOC API is not used for readers; `DOC_FALLBACK="on"` is an emergency switch). | `lib/policy.mjs`, `index-client.js` |
| d | `attribution` = "Contains data from The GDELT Project, https://www.gdeltproject.org/" in every shard and `places.json`, repo README, site footer, About page, feed panel. | |
| e | Retention: Live window 6 h (shards replaced each run, nothing accumulated beyond the 72 h working window, <= ~48 h of live data kept); Curated <= 30 days; flagged <= 7 days. | `POLICY.*` |
| f | No tone on flagged stories. A crime place is taken only from the headline text, never from GDELT's place field alone. GDELT person/organisation lists are never stored. | `build.mjs`, `policy.mjs` |
| g | Flagged = crime/court (the allegation label applies) and named-person (headline-only): headline unchanged, no summary, label "Reported by [Outlet]. Allegation, not established." Stories involving minors or sexual-offence victims are dropped at ingest (keyword filter, conservative). Guilt-as-fact stories about named people are held (not published). Blocklist: see below. | |

**Blocklist SOP (credible legal complaint: remove within 4 hours).**
1. Hide first: `POST /api/admin/hide` (needs the Worker store) or, without it, add the hashed row to `ingest/blocklist.json` with `node blocklist-tool.mjs add url <url> --reason LEGAL`. This one file is read by ingest **and** the Worker (no second list, no Worker redeploy).
2. Commit and push `blocklist.json`, then run the workflow once (`gh workflow run index.yml`): the file is published with the index, the Worker re-reads it within ~60 s, and the URL leaves the shards on that build.
3. Log the removal as: date, SHA-256 of the URL, who asked. Do not keep the headline or the URL.
4. Tell Legal the URL is down. Target: within 4 hours of receipt.

**Weekly spot check (Legal: 5% of unflagged items).** `node spotcheck.mjs > spotcheck-YYYYMMDD.csv` samples about 5% (min 10) of unflagged curated stories from the live Pages index. A person reads each headline, marks `ok_or_problem`, and any miss goes through the blocklist SOP plus a note to Legal so the keyword filter (`lib/policy.mjs`) can be extended. Keep the CSV without URLs after review.

**Known limits.** (1) About two thirds of stories are needs-review under the Worker's named-person heuristic (`guard.js`), so only a minority get a machine summary; the rest are headline-only. (2) Place matching is heuristic (known false hits: Cochin Shipyard, Mumbai Indians; `FALSE_PLACE` in `build.mjs` handles the common ones). (3) A public repo plus public Pages means the headline index is publicly fetchable, which sits uneasily with the Legal wish to keep shards non-public (10.3). The owner accepted this for the pre-live trial only; it must move before launch. (4) GitHub scheduled runs can be late; the staleness guard covers that.
