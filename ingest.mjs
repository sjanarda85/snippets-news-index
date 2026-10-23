#!/usr/bin/env node
/* Snippets news index ingester.  GDELT GKG 2.1 15-minute files -> junk filter -> places/topics -> stories -> ranked JSON shards.
     node ingest.mjs update                    # incremental: fetch new 15-min batches, freeze finished days, prune, rebuild shards   (the cron job)
     node ingest.mjs backfill --days 3         # initial fill (also resumable)
     node ingest.mjs build [--out build]       # rebuild shards from state only (no network)
     node ingest.mjs one                       # fetch+process the latest single file and print timings
   State dir (default ./state, gitignored): batches/<stamp>.json.gz (72 h of compact articles) + days/<yyyymmdd>.json.gz (30 d of story rollups). */
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { latestStamp, stampsBack, stampOf, downloadGkg, unzipFirst, parseGkg, dateOfStamp } from "./lib/gdelt.mjs";
import { loadPlaces } from "./lib/places.mjs";
import { loadOutlets } from "./lib/outlets.mjs";
import { loadGeo, REGION_IDS, MULTI, REGION_NAMES } from "./lib/geo.mjs";
import { diversityReport } from "./vendor/diversity.js";
import { enrich, storiesFromArticles, mergeStories, rankShards, apiStory, localOf, domainWeights, applyWeights, PERIODS } from "./lib/build.mjs";
import { TOPIC_LABEL } from "./lib/topics.mjs";
import { POLICY } from "./lib/policy.mjs";
import { compileBlocklist, articleBlocked, matchesBlocklist } from "./vendor/blocklist-core.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2), cmd = args[0] || "update";
const opt = (n, d) => { const i = args.indexOf("--" + n); return i < 0 ? d : (args[i + 1] && !args[i + 1].startsWith("--") ? args[i + 1] : true); };
const STATE = path.resolve(opt("state", path.join(HERE, "state"))), OUT = path.resolve(opt("out", path.join(HERE, "build")));
const RAW = opt("raw", null);   // optional: directory of already downloaded zips (offline test)
const WINDOW_H = 72, KEEP_DAYS = 30;
fs.mkdirSync(path.join(STATE, "batches"), { recursive: true }); fs.mkdirSync(path.join(STATE, "days"), { recursive: true });

const P = loadPlaces(path.join(HERE, "geo"));
const ctx = { P, G: loadGeo(P, path.join(HERE, "geo")), outletCountry: loadOutlets(path.join(HERE, "data/DOMAINSBYCOUNTRY-ALLLANGUAGES.TXT")) };
const describe = (key) => { const m = /^rg-(.+)$/.exec(key); return m ? (REGION_NAMES[m[1]] ? { type: "region", name: REGION_NAMES[m[1]], region: m[1] } : null) : P.describe(key); };
const T0 = Date.now(), lap = (m) => console.error(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}`);
const stampMs = (s) => dateOfStamp(s).getTime();
const writeGz = (f, o) => fs.writeFileSync(f, zlib.gzipSync(JSON.stringify(o), { level: 6 }));
const readGz = (f) => JSON.parse(zlib.gunzipSync(fs.readFileSync(f)).toString());
const bFile = (s) => path.join(STATE, "batches", s + ".json.gz"), dFile = (d) => path.join(STATE, "days", d + ".json.gz");
const listBatches = () => fs.readdirSync(path.join(STATE, "batches")).filter((f) => f.endsWith(".json.gz")).map((f) => f.slice(0, 14)).sort();
/* Takedown blocklist: ONE file, blocklist.json (url hashes, story ids, domains, terms; same file the Worker bundles; format in vendor/blocklist-core.js).
   Blocked articles are never stored; any story that still matches is dropped from every shard and rollup on the next build. */
let BL = compileBlocklist(null);
try { BL = compileBlocklist(JSON.parse(fs.readFileSync(path.join(HERE, "blocklist.json"), "utf8"))); } catch (e) { if (e.code !== "ENOENT") throw e; }
if (BL.problems.length) { console.error("blocklist.json problems: " + BL.problems.join("; ")); process.exit(2); }
const blockedStory = (s) => matchesBlocklist({ id: s.id, headline: s.h, sources: s.src.map((x) => ({ domain: x[0], url: x[1], title: x[2] })) }, BL);
const stats = { rows: 0, kept: 0, junk: {}, batches: 0, bytesZip: 0 };

async function processBatch(stamp) {
  if (fs.existsSync(bFile(stamp))) return;
  let buf;
  if (RAW && fs.existsSync(path.join(RAW, `${stamp}.gkg.csv.zip`))) buf = fs.readFileSync(path.join(RAW, `${stamp}.gkg.csv.zip`));
  else buf = await downloadGkg(stamp);
  if (!buf) return;
  stats.bytesZip += buf.length;
  const arts = [], domCount = new Map(), parts = [parseGkg(unzipFirst(buf).toString("utf8"), stamp)];
  if (POLICY.TRANSLATION_FILES && POLICY.LANG_L2.length) {   // off by default: see POLICY.TRANSLATION_FILES
    const tb = (RAW && fs.existsSync(path.join(RAW, `${stamp}.translation.gkg.csv.zip`))) ? fs.readFileSync(path.join(RAW, `${stamp}.translation.gkg.csv.zip`)) : await downloadGkg(stamp, { translation: true });
    if (tb) { stats.bytesZip += tb.length; parts.push(parseGkg(unzipFirst(tb).toString("utf8"), stamp)); }
  }
  for (const a of parts.flatMap((g) => [...g])) {
    stats.rows++;
    const dc = (domCount.get(a.domain) || 0) + 1; domCount.set(a.domain, dc);
    if (dc > 25) { stats.junk["domain-cap"] = (stats.junk["domain-cap"] || 0) + 1; continue; }   // one outlet cannot flood a 15-min batch
    if (articleBlocked({ u: a.url, d: a.domain, t: a.title }, BL)) { stats.junk.blocklist = (stats.junk.blocklist || 0) + 1; continue; }
    const e = enrich(a, ctx, stats); if (e) { arts.push(e); stats.kept++; }
  }
  writeGz(bFile(stamp), arts); stats.batches++;
}

function freezeDays(latest) {
  const stamps = listBatches(), byDay = new Map();
  for (const s of stamps) (byDay.get(s.slice(0, 8)) || byDay.set(s.slice(0, 8), []).get(s.slice(0, 8))).push(s);
  const today = latest.slice(0, 8), made = [];
  for (const [day, ss] of byDay) {
    if (day >= today || fs.existsSync(dFile(day))) continue;
    if (ss.length < 48 && !opt("force")) continue;     // mostly-missing day (e.g. started mid-day): do not freeze a partial rollup
    made.push(day); writeGz(dFile(day), { v: 1, day, batches: ss.length, stories: dayStories(ss) });
  }
  return made;
}
const keepStory = (s) => s.n >= 3 || (s.n >= 2 && s.pl.some((k) => /^[st]-/.test(k)));   // day rollup keeps multi-outlet stories only (curated = multi-outlet); ~29% of a day
function dayStories(ss) { const arts = ss.flatMap((s) => readGz(bFile(s))); return storiesFromArticles(arts, ctx).filter(keepStory); }
/* Legal retention: crime/court/named-person stories are removed from the stored day roll-ups (not just hidden) once older than FLAGGED_MAX_DAYS */
function scrubFlagged(latest) {
  for (const f of fs.readdirSync(path.join(STATE, "days"))) {
    if (stampMs(f.slice(0, 8) + "000000") > stampMs(latest) - POLICY.FLAGGED_MAX_DAYS * 86400000) continue;
    const o = readGz(path.join(STATE, "days", f)); if (o.scrubbed) continue;
    o.stories = o.stories.filter((s) => !(s.rr && s.rr.length)); o.scrubbed = POLICY.FLAGGED_MAX_DAYS; writeGz(path.join(STATE, "days", f), o);
  }
}
function prune(latest) {
  const cut = stampMs(latest) - WINDOW_H * 3600000;
  for (const s of listBatches()) if (stampMs(s) < cut && (fs.existsSync(dFile(s.slice(0, 8))) || stampMs(s) < cut - 86400000)) fs.unlinkSync(bFile(s));   // rolled up, or an unfreezable partial day
  scrubFlagged(latest);
  const dcut = stampMs(latest) - KEEP_DAYS * 86400000;
  for (const f of fs.readdirSync(path.join(STATE, "days"))) if (stampMs(f.slice(0, 8) + "000000") < dcut - 86400000) fs.unlinkSync(path.join(STATE, "days", f));
}

async function pool(items, n, fn) { let i = 0; await Promise.all(Array.from({ length: n }, async () => { while (i < items.length) { const x = items[i++]; await fn(x); } })); }

const DEADLINE = opt("deadline-min", 0) ? T0 + +opt("deadline-min", 0) * 60000 : 0;   // stop starting new days after this (the build still runs)
async function ingestRange(end, count, latest = end) {
  const stamps = stampsBack(end, count);   // oldest -> newest
  const byDay = new Map(); for (const s of stamps) (byDay.get(s.slice(0, 8)) || byDay.set(s.slice(0, 8), []).get(s.slice(0, 8))).push(s);
  for (const [day, ss] of byDay) {
    if (DEADLINE && Date.now() > DEADLINE) { lap(`deadline reached: stopping before day ${day} (it is picked up by the next run)`); break; }
    await pool(ss, 8, processBatch);
    const frozen = freezeDays(latest); if (frozen.length) lap(`day ${frozen.join(",")} frozen`);
    prune(latest);
    lap(`day ${day}: ${ss.length} batches  rows=${stats.rows} kept=${stats.kept}`);
  }
}

function buildAll() {
  const bs = listBatches(); if (!bs.length) throw new Error("no batches in state");
  const latest = bs[bs.length - 1], now = stampMs(latest) + 15 * 60000;    // end of the newest batch
  const rep0 = {}; const t = {}; let t1 = Date.now(); const tick = (k) => { t[k] = Date.now() - t1; t1 = Date.now(); };
  const winBs = bs.filter((s) => stampMs(s) >= now - WINDOW_H * 3600000), perBatch = new Map(winBs.map((s) => [s, readGz(bFile(s))]));
  tick("load72h");
  const winStories = storiesFromArticles([...perBatch.values()].flat(), ctx).filter((s) => !blockedStory(s)); tick("cluster72h");
  // per-day rollups: frozen files + today (partial) from batches
  const today = latest.slice(0, 8), dayLists = [];
  for (const f of fs.readdirSync(path.join(STATE, "days")).sort()) if (stampMs(f.slice(0, 8) + "000000") >= now - (KEEP_DAYS + 1) * 86400000) dayLists.push(readGz(path.join(STATE, "days", f)).stories.filter((s) => !blockedStory(s)));
  dayLists.push(storiesFromArticles([...perBatch].filter(([s]) => s.startsWith(today)).flatMap(([, a]) => a), ctx).filter(keepStory).filter((s) => !blockedStory(s))); tick("rollups");
  const merged = mergeStories(dayLists.flat()); tick("merge30d");
  const W = domainWeights(winStories); applyWeights(winStories, W); applyWeights(merged, W); rep0.syndicationOnlyDomains = W.size;
  const sets = { live: winStories, "24h": winStories, "7d": merged, "30d": merged };
  fs.rmSync(OUT, { recursive: true, force: true });
  const rep = { ...rep0, builtAt: new Date().toISOString(), generatedAt: new Date(now).toISOString(), batch: latest, articles72h: [...perBatch.values()].reduce((n, a) => n + a.length, 0), stories72h: winStories.length, storiesMerged: merged.length, dayRollups: dayLists.length, ms: t, shards: {}, bytes: {}, gz: {} };
  const placesIdx = {};
  for (const period of Object.keys(PERIODS)) {
    const ranked = rankShards(sets[period], ctx, period, now, { topN: period === "live" ? 40 : 30 });
    let files = 0, bytes = 0, gz = 0, maxB = 0; const byType = {};
    for (const [kk, list] of ranked) {
      const [key, tag] = [kk.slice(0, kk.indexOf("|")), kk.slice(kk.indexOf("|") + 1)];
      const info = describe(key); if (!info) continue;
      const apiList = list.map((s) => apiStory(s, now, period, localOf(s, key, ctx), ctx, list.scores && list.scores.get(s)));
      if (key === "world" && tag === "all") { rep.diversity ||= {}; rep.diversity[period] = { ...diversityReport(apiList), ranking: list.diversity || null }; }
      const body = JSON.stringify({ schema: "snippets.index.v1", mode: period === "live" ? "live" : "curated", period, key, tag, place: info, topic: tag === "all" ? null : TOPIC_LABEL[tag] || tag,
        generatedAt: rep.generatedAt, builtAt: rep.builtAt, attribution: POLICY.ATTRIBUTION, batch: latest, count: list.length, ...(key === "world" && tag === "all" ? { diversity: diversityReport(apiList) } : {}), stories: apiList });
      const f = path.join(OUT, period === "live" ? "live" : "curated/" + period, key, tag + ".json");
      fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, body);
      files++; bytes += body.length; maxB = Math.max(maxB, body.length); gz += zlib.gzipSync(body, { level: 6 }).length;
      byType[info.type] = (byType[info.type] || 0) + 1;
      placesIdx[key] ||= {}; placesIdx[key][tag] = (placesIdx[key][tag] || 0) | (1 << Object.keys(PERIODS).indexOf(period));   // bit i = this shard exists for period i (live,24h,7d,30d)
    }
    rep.shards[period] = { files, byType, maxBytes: maxB }; rep.bytes[period] = bytes; rep.gz[period] = gz;
  }
  tick("rank+write");
  fs.writeFileSync(path.join(OUT, "places.json"), JSON.stringify({ schema: "snippets.index.places.v2", periods: Object.keys(PERIODS), generatedAt: rep.generatedAt, builtAt: rep.builtAt, attribution: POLICY.ATTRIBUTION, batch: latest, k: placesIdx, regions: [...REGION_IDS, MULTI].map((r) => ({ id: r, key: "rg-" + r, name: REGION_NAMES[r] })), scope: "global" }));
  rep.placesCovered = { keys: Object.keys(placesIdx).length, byType: Object.keys(placesIdx).reduce((m, k) => { const ty = describe(k).type; m[ty] = (m[ty] || 0) + 1; return m; }, {}) };
  rep.ms = t; fs.writeFileSync(path.join(OUT, "_report.json"), JSON.stringify(rep, null, 1));
  return rep;
}

if (cmd === "one") {
  const st = opt("stamp", await latestStamp()); const t = Date.now();
  await processBatch(st); const pt = Date.now() - t; const arts = readGz(bFile(st));
  console.log(JSON.stringify({ stamp: st, ms: pt, rows: stats.rows, kept: stats.kept, junk: stats.junk, zipBytes: stats.bytesZip, batchGzBytes: fs.statSync(bFile(st)).size, stories: storiesFromArticles(arts, ctx).length }));
} else if (cmd === "backfill" || cmd === "update") {
  const latest = opt("end", null) || await latestStamp();
  const dayStart = (n) => stampOf(new Date(Date.UTC(+latest.slice(0, 4), +latest.slice(4, 6) - 1, +latest.slice(6, 8)) - n * 86400000));
  const batchesBetween = (a, b) => Math.round((stampMs(b) - stampMs(a)) / 900000) + 1;
  let count;
  if (cmd === "backfill") count = batchesBetween(dayStart(+opt("days", 3)), latest);       // whole days before today + today so far (no partial first day)
  else { const bs = listBatches(); count = Math.min(96 * 3, bs.length ? Math.max(1, Math.round((stampMs(latest) - stampMs(bs[bs.length - 1])) / 900000)) : batchesBetween(dayStart(3), latest)); }
  lap(`${cmd}: ${count} batches ending ${latest}`);
  await ingestRange(latest, count);
  /* growth: every run extends the history backwards by --grow-days whole days until --target-days is covered (rollups are cheap: 30 d = ~76 MB state) */
  const target = +opt("target-days", 0), grow = +opt("grow-days", 7);
  if (cmd === "update" && target) {
    const have = new Set([...fs.readdirSync(path.join(STATE, "days")).map((f) => f.slice(0, 8)), ...listBatches().map((s) => s.slice(0, 8))]);
    const oldest = [...have].sort()[0], want = dayStart(target).slice(0, 8);
    if (oldest > want) {
      const n = Math.min(grow, Math.round((Date.UTC(+oldest.slice(0, 4), +oldest.slice(4, 6) - 1, +oldest.slice(6, 8)) - Date.UTC(+want.slice(0, 4), +want.slice(4, 6) - 1, +want.slice(6, 8))) / 86400000));
      const end = stampOf(new Date(dateOfStamp(oldest + "000000").getTime() - 900000));
      lap(`growing history: ${n} older day(s) before ${oldest} (target ${target} d)`);
      await ingestRange(end, n * 96, latest);
    } else lap(`history complete: ${[...have].length} days >= target ${target} d`);
  }
  const frozen = freezeDays(latest); prune(latest); lap("ingest done " + JSON.stringify({ rows: stats.rows, kept: stats.kept, zipMB: +(stats.bytesZip / 1e6).toFixed(0), junk: stats.junk }));
  if (!opt("nobuild")) { const r = buildAll(); lap("build done " + JSON.stringify(r.ms)); console.log(JSON.stringify(r, null, 1)); }
} else if (cmd === "build") { const r = buildAll(); lap("build done"); console.log(JSON.stringify(r, null, 1)); }
