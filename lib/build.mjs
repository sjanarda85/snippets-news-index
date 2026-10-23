/* article -> enriched compact record; articles -> stories (clusters); stories -> ranked shards. Pure functions (no network). */
import { tokens, normTitle, cleanHeadline, clusterItems, storyId, scoreTitle } from "./cluster.mjs";
import { parseLocations, titleHits, norm, TITLE_TERMS } from "./places.mjs";
import { tagsOf, CATEGORY_OF } from "./topics.mjs";
import { junkReason } from "./junk.mjs";
import { POLICY, guiltAsFact, langTier } from "./policy.mjs";
import { geoOf, topicWeight, SCOPE_WEIGHT, REGION_NAMES, MULTI } from "./geo.mjs";
import { CAPS, countryCapMax, regionCapMax, isExceptional, REGIONS } from "../vendor/diversity.js";
import { headlineOnlyReason, reviewReasons } from "../vendor/guard.js";

export const MAX_SRC = 5, MAX_DS = 30, OUT_SRC = 5;

/** raw parsed GKG row -> compact record, or null (+counts in stats.junk[reason]) */
/* Place false hits: names that contain a place but are not about it (sports teams, companies, publications). Stripped from the headline before place matching. */
const FALSE_PLACE = /\b(cochin shipyard|mumbai indians|chennai super kings|delhi capitals|kolkata knight riders|royal challengers (bengaluru|bangalore)|sunrisers hyderabad|punjab kings|rajasthan royals|lucknow super giants|gujarat titans|new york (times|post|daily news|yankees|mets|knicks|giants|jets|islanders|rangers|liberty|city fc)|washington (post|commanders|nationals|wizards|capitals)|los angeles (times|lakers|dodgers|rams|chargers|angels|clippers)|manchester (united|city)|bank of india|air india|state bank of india|west indies|new england patriots|jersey shore)\b/gi;
export function enrich(a, ctx, stats) {
  const why = junkReason(a);
  if (why) { stats.junk[why] = (stats.junk[why] || 0) + 1; return null; }
  const cleanTitle = a.title.replace(FALSE_PLACE, " "), nt = " " + norm(cleanTitle) + " ";
  const hits = parseLocations(ctx.P, a.locs);
  /* article<->place rule (tuned on 72 h of real data): a place counts if it is in the HEADLINE, or it is what the article is mainly about:
     country = the most-mentioned country (or >=50% of it), state/city = mentioned >=3 times and among the 2 most-mentioned at that level.
     A single passing mention in the body ("... trade mission to India") must not put a UK story on the India page. */
  const top = (lvl) => hits.filter((h) => h.lvl === lvl).sort((x, y) => y.count - x.count);
  const topC = top(0), topS = top(1), topT = top(2);
  const dominant = new Set([...topC.filter((h) => h.count >= 2 && h.count >= 0.5 * topC[0].count), ...topS.slice(0, 2).filter((h) => h.count >= 3), ...topT.slice(0, 2).filter((h) => h.count >= 3)].map((h) => h.key));
  const keep = new Set(), pt = new Set();   // pt = place keys named in the headline itself (the only ones allowed for crime stories)
  for (const h of hits) {
    const terms = TITLE_TERMS[h.name] || [norm(h.name)];
    const inTitle = h.name.length > 2 && terms.some((t) => nt.includes(" " + t + " "));
    if (!inTitle && (!dominant.has(h.key) || (cleanTitle !== a.title && norm(a.title).includes(norm(h.name))))) continue;
    keep.add(h.key); if (inTitle) pt.add(h.key);
    if (h.lvl === 2) { const hs = hits.find((x) => x.lvl === 1 && x.iso === h.iso && ctx.P.countries.get(h.iso).cityList.some((c) => c.key === h.key && c.state === x.name)); if (hs) keep.add(hs.key); }
    if (h.lvl >= 1) keep.add("about-" + h.iso);
  }
  /* names in the headline itself (outlet country + GKG countries) */
  const oc = ctx.outletCountry(a.domain), isos = new Set(hits.filter((h) => h.lvl === 0).map((h) => h.iso));
  const oci = oc && ctx.P.byFips.get(oc); if (oci) isos.add(oci.id);
  for (const h of titleHits(ctx.P, cleanTitle, isos)) {
    keep.add(h.key); keep.add("about-" + h.iso); pt.add(h.key);
    if (h.lvl === 2 && h.state) { const sk = ctx.P.countries.get(h.iso).states.get(norm(h.state)); if (sk) { keep.add(sk.key); pt.add(sk.key); } }
  }
  return { u: a.url, d: a.domain, t: a.title, ts: a.ts, tn: +a.tone.toFixed(1), wc: a.wc, tg: tagsOf(a.themes, a.title), pl: [...keep], pt: [...pt], oc, ...(a.lang && a.lang !== "eng" ? { lg: a.lang, ...(a.tr ? { tr: 1 } : {}) } : {}) };
}

const iso = (ms) => new Date(ms).toISOString().replace(/\.\d+Z$/, "Z");

/** articles (compact) -> stories (clusters). One source per outlet. */
export function storiesFromArticles(arts, ctx) {
  const seen = new Set(), items = [];
  for (const a of arts) {
    if (seen.has(a.u)) continue; seen.add(a.u);
    items.push({ a, ts: a.ts, tokens: tokens(a.t) });
  }
  const clusters = clusterItems(items.filter((i) => i.tokens.size >= 2));
  return clusters.map((c) => toStory(c.items.map((i) => i.a), ctx));
}
function toStory(members, ctx) {
  const byD = new Map();
  for (const m of members.slice().sort((x, y) => x.ts - y.ts)) if (!byD.has(m.d)) byD.set(m.d, m);
  const srcAll = [...byD.values()];
  const lead = srcAll.slice().sort((x, y) => scoreTitle(y.t) - scoreTitle(x.t))[0];
  const thr = Math.max(1, Math.ceil(members.length * 0.34));
  const cnt = (f) => { const m = new Map(); for (const x of members) for (const k of f(x)) m.set(k, (m.get(k) || 0) + 1); return m; };
  const tg = [...cnt((x) => x.tg)].filter(([, n]) => n >= Math.max(1, Math.ceil(members.length * 0.4))).sort((a, b) => b[1] - a[1]).map(([k]) => k);
  const pl = [...cnt((x) => x.pl)].filter(([, n]) => n >= thr).map(([k]) => k);
  const oc = {};   // outlets per outlet-country (FIPS): "from" shards rank by LOCAL outlets, not by the global count
  for (const x of srcAll) if (x.oc) oc[x.oc] = (oc[x.oc] || 0) + 1;
  const times = srcAll.map((x) => x.ts);
  const story = {
    id: storyId(lead.t), h: cleanHeadline(lead.t, lead.d), first: Math.min(...times), last: Math.max(...times), n: srcAll.length,
    tone: +(members.reduce((s, x) => s + x.tn, 0) / members.length).toFixed(1), wc: Math.max(...members.map((x) => x.wc || 0)),
    tg, pl, oc, ds: srcAll.slice(0, MAX_DS).map((x) => x.d),
    src: null };
  const recent = srcAll.slice().sort((x, y) => y.ts - x.ts).slice(0, MAX_SRC);
  if (!recent.includes(lead)) recent[recent.length - 1] = lead;
  /* legal flags: wire/exclusive/single-source over ALL sources (same guard.js as the Worker); needs-review over the headline + the titles we would show */
  story.ho = headlineOnlyReason({ sources: srcAll.map((x) => ({ title: x.t, domain: x.d, outlet: x.d })) }) || "";
  story.rr = reviewReasons({ sources: recent.map((x) => ({ title: x.t, domain: x.d })), headline: story.h });
  /* health and election claims (editorial guide 7.4): GKG themes (HEALTH_* + a health headline cue, ELECTION themes) add to the headline-keyword flags of guard.js.
     Only a yes/no flag is kept; no GKG person/organisation data. Flagged = headline-only, no summary, no tone, no boost. */
  if (tg.includes("health") && !story.rr.includes("health-claim")) story.rr.push("health-claim");
  if (tg.includes("election") && !story.rr.includes("election-claim")) story.rr.push("election-claim");
  story.lead = lead.d;
  if (lead.lg) { story.lg = lead.lg; if (lead.tr) story.tr = 1; if (!story.ho) story.ho = "language"; }   // non-English: original headline as-is + language tag, never a summary (guide: L2 headline-only)
  if (story.rr.length) {   // Legal: flagged stories = the publisher's headline unchanged, no tone, no GDELT-only location, held if guilt is stated as fact
    story.h = cleanHeadline(lead.t, lead.d);   // the publisher's wording, only site-name junk stripped (editorial guide 3/7.3); the raw headline is kept in hr for audit
    if (POLICY.LOCATION_FROM_HEADLINE_ONLY && story.rr.includes("crime-or-court")) { const ptc = cnt((x) => x.pt || []), thr2 = Math.max(1, Math.ceil(members.length * 0.34)); story.pl = [...ptc].filter(([, n]) => n >= thr2).map(([k]) => k); }
    if (members.some((x) => guiltAsFact(x.t))) story.hold = 1;
  }
  story.src = recent.map((x) => [x.d, x.u, x.t, x.ts, x.oc || ""]);
  const raw = lead.t.replace(/\s+/g, " ").trim(); if (raw !== story.h) story.hr = raw;
  story.cat = CATEGORY_OF[tg.find((t) => CATEGORY_OF[t])] || "General";
  return story;
}

/** merge stories from several day rollups + the live window into cross-day stories (same clustering, on story tokens) */
export function mergeStories(list) {
  const items = list.map((s) => { const tk = tokens(s.h); for (const x of s.src.slice(0, 3)) for (const t of tokens(x[2])) tk.add(t); return { s, ts: s.first, tokens: tk }; });
  const clusters = clusterItems(items.filter((i) => i.tokens.size >= 2), { maxGapMs: 72 * 3600000 });
  return clusters.map((c) => {
    if (c.items.length === 1) return c.items[0].s;
    const ss = c.items.map((i) => i.s);
    const ds = [...new Set(ss.flatMap((s) => s.ds))].slice(0, MAX_DS);
    const srcMap = new Map(); for (const s of ss) for (const x of s.src) if (!srcMap.has(x[0])) srcMap.set(x[0], x);
    const src = [...srcMap.values()].sort((a, b) => b[3] - a[3]).slice(0, MAX_SRC);
    const lead = ss.slice().sort((a, b) => b.n - a.n)[0];
    const count = (f) => { const m = new Map(); for (const s of ss) for (const k of f(s)) m.set(k, (m.get(k) || 0) + 1); return m; };
    return { ...lead, first: Math.min(...ss.map((s) => s.first)), last: Math.max(...ss.map((s) => s.last)), n: Math.max(ds.length, ...ss.map((s) => s.n)),
      ds, src, tg: [...count((s) => s.tg).keys()], pl: [...count((s) => s.pl).keys()], oc: Object.fromEntries([...new Set(ss.flatMap((s) => Object.keys(s.oc)))].map((k) => [k, Math.min(Math.max(ds.length, ...ss.map((s) => s.n)), ss.reduce((t, s) => t + (s.oc[k] || 0), 0))])),
      ho: (ss.find((s) => s.ho === "exclusive" || s.ho === "wire") || {}).ho || (ds.length < 2 && lead.n < 2 ? "single-source" : "") || (lead.lg ? "language" : ""), rr: [...new Set(ss.flatMap((s) => s.rr))], tone: lead.tone, ...(ss.some((s) => s.hold) ? { hold: 1 } : {}) };
  });
}

/* ---------------- outlet quality ----------------
   Measured: networks of fake-"local" sites (xxxsun.com, xxxherald.com ...) and local radio/regional sites republish press releases and wire copy, and inflate
   "N outlets" (a 56-outlet story that was one press release). A domain whose articles (>=8 in the window) almost never appear in small organic
   clusters (<25% in clusters with <10 outlets) is a "syndication-only" outlet: it still shows as a source, but counts 0.3 toward ranking. */
export function domainWeights(stories) {
  const m = new Map();
  for (const s of stories) for (const d of s.ds) { const r = m.get(d) || m.set(d, [0, 0]).get(d); r[0]++; if (s.n < 10) r[1]++; }
  const w = new Map();
  for (const [d, [a, small]] of m) if (a >= 8 && small / a < 0.25) w.set(d, 0.3);
  return w;
}
export function applyWeights(stories, W) {
  for (const s of stories) { let t = 0; for (const d of s.ds) t += W.get(d) ?? 1; s.ne = s.ds.length ? +(s.n * (t / s.ds.length)).toFixed(1) : s.n; }
  return stories;
}
/* ---------------- ranking ---------------- */
export const PERIODS = { live: { ms: POLICY.LIVE_WINDOW_H * 3600000, hl: 3 }, "24h": { ms: 24 * 3600000, hl: 8 }, "7d": { ms: 7 * 86400000, hl: 48 }, "30d": { ms: 30 * 86400000, hl: 240 } };
/* outlet group: bbc.co.uk and bbc.com are one group (the label before the public suffix) */
const SLD = new Set(["co", "com", "org", "net", "gov", "ac", "edu", "or", "ne", "go"]);
export const outletGroup = (d) => { const p = String(d).split("."); if (p.length > 2 && SLD.has(p[p.length - 2])) p.splice(-2); else p.pop(); return p[p.length - 1] || d; };
export function groupDiversity(s) { const g = new Set(s.src.slice(0, 5).map((x) => outletGroup(x[0]))); return Math.min(1, g.size / Math.max(1, Math.min(5, s.src.length))); }
export function geoFor(s, ctx) { return s.g || (s.g = geoOf(s, ctx)); }
const LN21 = Math.log(21);
/* editorial formula (guide section 3): score = 40*C + 25*R + 25*W + 10*D, 0-100. W = topic tier x scope weight (x (1+local_boost) for the owner's boost places; never for flagged stories). */
export function score(s, now, period, loc, ctx) {
  const age = Math.max(0, (now - s.last) / 3600000), decay = Math.pow(0.5, age / PERIODS[period].hl);
  const eff = Math.max(1, s.ne ?? s.n);
  if (POLICY.RANKING === "legacy") {
    const prom = s.rr && s.rr.length ? 0 : 0.5 * Math.min(1, (s.wc || 0) / 1200) + 0.5 * Math.min(1, Math.abs(s.tone || 0) / 8);
    const span = Math.min(3, Math.floor((s.last - s.first) / 86400000));
    const base = loc ? Math.log(Math.max(1, loc.n * (eff / s.n))) + 0.25 * Math.log(eff) : Math.log(eff);
    return 2.2 * base + 1.6 * decay + 0.8 * prom + 0.5 * span;
  }
  const effC = loc ? Math.max(1, loc.n * (eff / s.n)) * Math.pow(eff, 0.25) : eff;   // "from" shards count the country's own outlets (site scope "from")
  const C = Math.min(1, Math.log(1 + effC) / LN21);
  return 40 * C + 25 * decay + 25 * weightOf(s, ctx) + 10 * groupDiversity(s);
}
export function weightOf(s, ctx) {
  const g = ctx ? geoFor(s, ctx) : null;
  let w = topicWeight(s) * (g ? SCOPE_WEIGHT[g.scope] : 0.7);
  if (POLICY.LOCAL_BOOST > 0 && g && !(s.rr && s.rr.length) && POLICY.LOCAL_BOOST_COUNTRIES.some((c) => g.countries.includes(c))) w *= 1 + Math.min(0.5, POLICY.LOCAL_BOOST);
  return Math.min(1, w);
}
export function why(s, now, period, loc) {
  const bits = [s.n + (s.n === 1 ? " outlet" : " outlets")];
  if (loc && loc.n > 0 && loc.n < s.n) bits.push(`${loc.n} in ${loc.name}`);
  if (s.ne !== undefined && s.n >= 10 && s.ne < 0.5 * s.n) bits.push("mostly syndicated copies");
  const span = Math.floor((s.last - s.first) / 86400000);
  if (span >= 1 && period !== "live" && period !== "24h") bits.push(`covered over ${span + 1} days`);
  if (now - s.last < 3 * 3600000 && s.n >= 5) bits.push("still developing");
  if (s.ho === "single-source") bits.push("headline only");
  return bits.join(" · ");
}
/** outlets that count for this shard: the country's own outlets for from-/state/city shards (site scope "from"), all outlets otherwise */
export function localOf(s, key, ctx) {
  const m = /^(?:from-|[st]-)([^-]+(?:~[A-Za-z]+)?)/.exec(key), c = m && ctx.P.countries.get(m[1]);
  return c && c.fips ? { n: s.oc[c.fips] || 0, name: c.name } : null;
}
/** FIPS (GDELT's list) -> ISO 3166-1 alpha-2 for the per-source outletCountry; "unknown" when GDELT's list has no entry (never guessed from the domain ending) */
export function outletIso(fips, ctx) { const c = fips && ctx && ctx.P.byFips.get(fips); return c && ctx.G.iso2Of(c.id) || "unknown"; }
const LANG2 = { eng: "en", fra: "fr", spa: "es", deu: "de", por: "pt", ita: "it", rus: "ru", ara: "ar", zho: "zh", jpn: "ja", kor: "ko", hin: "hi", ind: "id", tur: "tr", nld: "nl", pol: "pl", swe: "sv", nor: "no", dan: "da", fin: "fi", ces: "cs", ell: "el", heb: "he", fas: "fa", ukr: "uk", ron: "ro", hun: "hu", vie: "vi", tha: "th", ben: "bn", urd: "ur", swa: "sw", msa: "ms", tgl: "tl" };
function geoFields(s, ctx, sc) {
  const lg = s.lg || "eng", tier = langTier(lg), out = { lang: LANG2[lg] || lg, languageTier: tier, ...(s.tr ? { translated: true } : {}) };
  if (!ctx) return out;
  const g = geoFor(s, ctx);
  return { ...out, region: g.region, regions: g.regions, countries: g.countries, primaryCountry: g.primaryCountry, scope: g.scope, outletRegions: g.outletRegions,
    ...(sc ? { score: sc.score, weight: sc.weight } : {}) };
}
/** story -> API story object (what the Worker returns inside snippets.feed.v1 "stories"; summaries are added later by the existing AI step) */
export function apiStory(s, now, period, loc, ctx, sc) {
  const lead = s.h;
  return { id: s.id, headline: s.h, ...(s.hr ? { headlineRaw: s.hr } : {}), firstSeen: iso(s.first), updatedAt: iso(s.last), category: s.cat, tags: s.tg.slice(0, 4), outlets: s.n, ...(loc ? { localOutlets: loc.n } : {}), why: why(s, now, period, loc),
    sources: s.src.slice(0, OUT_SRC).map((x) => ({ outlet: x[0], url: x[1], ...(normTitle(x[2]) === normTitle(lead) ? {} : { title: x[2] }), publishedAt: iso(x[3]), outletCountry: outletIso(x[4], ctx) })),
    ...geoFields(s, ctx, sc),
    headlineOnly: s.ho || undefined, needsReview: s.rr.length ? true : undefined, reviewReasons: s.rr.length ? s.rr : undefined, ...(s.rr.length ? { leadOutlet: s.lead } : {}),
    ...(s.rr.length && POLICY.DROP_TONE_FLAGGED ? {} : { tone: s.tone }) };
}

/** place keys a story belongs to (for the keys the site can ask for) */
export function keysOf(s, ctx) {
  const keys = new Set(["world"]);
  const g = geoFor(s, ctx);   // region shards (rg-*): the story's own region, plus every region it names; multi-region has its own shard
  if (g.region) keys.add("rg-" + g.region); for (const r of g.regions) keys.add("rg-" + r);
  for (const f of Object.keys(s.oc)) { const c = ctx.P.byFips.get(f); if (c) { keys.add("from-" + c.id); keys.add("r-" + c.cont.replace(/ /g, "-")); } }
  for (const k of s.pl) {
    if (k.startsWith("about-")) { keys.add(k); continue; }
    const m = /^[st]-([^-]+)-/.exec(k); const c = m && ctx.P.countries.get(m[1]);
    if (c && c.fips && s.oc[c.fips]) keys.add(k);   // state/city shards: stories carried by >= 1 outlet of that country (site scope "from")
  }
  return keys;
}
/** stories -> Map("<key>|<tag>") -> ranked [story]  (list.scores = Map(story -> {score, weight}) for the API; list.diversity = what the caps did, world shards only) */
const SHARD_TAGS = new Set(["technology", "business", "sports", "health", "science", "climate", "politics", "world", "ai", "cricket", "election", "space", "monsoon", "entertainment"]);   // chips + site categories; "crime" only inside "all" (needs-review)
/** The neutral World front page (editorial guide section 3): walk the ranked list top-down and skip a story that would break a cap, so the next-best story fills its place.
    Country cap: <= 30% of the list per primary country (exceptional stories - >= 10 outlets in >= 3 regions, at most 3 - may exceed it).
    Region cap: <= 35% of the first 20 per region (multi-region and unknown are not a region). Then, if fewer than 5 of the 7 regions are in the first 20, the best story of a
    missing region (>= 2 outlets, not flagged) takes the last slot(s) of the 20. Caps never relax legal/review rules: they only choose between stories that already qualify. */
export function diversify(ranked, size, ctx, sc) {
  const capC = countryCapMax(size), capR = regionCapMax(CAPS.regionTopN), pool = ranked.slice(), out = [], cc = new Map(), rc = new Map();
  const note = { size, countryCapMax: capC, regionCapMax: capR, skippedForCountry: 0, skippedForRegion: 0, _sc: new Set(), _sr: new Set(), exceptions: [], swappedForRegions: [] };
  const rank = new Map(ranked.map((s, i) => [s, i]));
  while (out.length < size && pool.length) {
    let pick = -1;
    for (let i = 0; i < pool.length; i++) {
      const s = pool[i], g = geoFor(s, ctx), pc = g.primaryCountry, exc = isExceptional({ outlets: s.n, outletRegionN: g.outletRegionN });
      if (pc && (cc.get(pc) || 0) >= capC && !(exc && note.exceptions.length < CAPS.exceptionMax)) { note._sc.add(s); continue; }
      if (out.length < CAPS.regionTopN && REGIONS.includes(g.region) && (rc.get(g.region) || 0) >= capR) { note._sr.add(s); continue; }
      pick = i; break;
    }
    if (pick < 0) break;
    const s = pool.splice(pick, 1)[0], g = geoFor(s, ctx);
    if (g.primaryCountry) { const n = (cc.get(g.primaryCountry) || 0) + 1; cc.set(g.primaryCountry, n); if (n > capC) note.exceptions.push(s.id); }
    if (out.length < CAPS.regionTopN && g.region) rc.set(g.region, (rc.get(g.region) || 0) + 1);
    out.push(s);
  }
  const head = out.slice(0, CAPS.regionTopN), present = new Set(head.map((s) => geoFor(s, ctx).region).filter((r) => REGIONS.includes(r)));
  if (present.size < CAPS.minRegions && head.length >= CAPS.regionTopN) {
    for (const r of REGIONS.filter((x) => !present.has(x))) {
      if (present.size >= CAPS.minRegions) break;
      const cand = [...pool, ...out.slice(CAPS.regionTopN)].filter((s) => geoFor(s, ctx).region === r && s.n >= 2 && !(s.rr && s.rr.length) && sc.get(s) >= 0.85 * sc.get(head[head.length - 1])).sort((a, b) => rank.get(a) - rank.get(b))[0];
      if (!cand) continue;
      const cnt = new Map(); for (const s of head) { const k = geoFor(s, ctx).region; cnt.set(k, (cnt.get(k) || 0) + 1); }
      const victim = head.slice().reverse().find((s) => (cnt.get(geoFor(s, ctx).region) || 0) > 1);
      if (!victim) continue;
      const hi = head.indexOf(victim); head.splice(hi, 1); head.push(cand); head.sort((a, b) => rank.get(a) - rank.get(b));
      const inOut = out.indexOf(cand); if (inOut >= 0) out.splice(inOut, 1); else pool.splice(pool.indexOf(cand), 1);
      const rest = out.slice(CAPS.regionTopN).filter((x) => x !== cand); out.length = 0; out.push(...head, victim, ...rest);
      present.add(r); note.swappedForRegions.push(r);
    }
  }
  note.skippedForCountry = note._sc.size; note.skippedForRegion = note._sr.size; delete note._sc; delete note._sr;
  return { list: out.slice(0, size), note };
}
export function rankShards(stories, ctx, period, now, { topN = 30, minAll = 3, minTag = 5 } = {}) {
  const win = PERIODS[period].ms, pool = new Map();
  for (const s of stories) {
    if (now - s.last > win || s.hold) continue;
    if (s.rr && s.rr.length && now - s.last > POLICY.FLAGGED_MAX_DAYS * 86400000) continue;   // flagged items live at most FLAGGED_MAX_DAYS in the index
    for (const k of keysOf(s, ctx)) for (const t of ["all", ...s.tg.filter((x) => SHARD_TAGS.has(x))]) { const kk = k + "|" + t; (pool.get(kk) || pool.set(kk, []).get(kk)).push(s); }
  }
  const out = new Map();
  for (const [kk, list] of pool) {
    const tag = kk.slice(kk.indexOf("|") + 1);
    const city = /^t-/.test(kk), need = tag === "all" ? (city ? 2 : minAll) : (city ? 8 : minTag);
    if (list.length < need) continue;
    const lk = kk.slice(0, kk.indexOf("|")), sc = new Map(list.map((s) => [s, score(s, now, period, localOf(s, lk, ctx), ctx)]));
    let ranked;
    if (period === "live") ranked = list.filter((s) => s.n >= 2 || /^(s|t)-/.test(kk) || list.length < 15).sort((a, b) => b.last - a.last);
    else { ranked = list.sort((a, b) => sc.get(b) - sc.get(a)); const multi = ranked.filter((s) => s.n >= 2); if (multi.length >= 8) ranked = multi; }
    const seenT = new Set(), dedup = [];
    for (const s of ranked) { const nt = normTitle(s.h); if (seenT.has(nt)) continue; seenT.add(nt); dedup.push(s); }
    const size = lk === "world" && tag === "all" ? Math.max(topN, POLICY.WORLD_TOP_N) : tag === "all" ? topN : Math.min(topN, 25);
    let top, note = null;
    if (lk === "world") { const r = diversify(dedup, size, ctx, sc); top = r.list; note = r.note; } else top = dedup.slice(0, size);
    if (top.length >= need) {
      const list2 = top; list2.scores = new Map(top.map((s) => [s, { score: +sc.get(s).toFixed(1), weight: +weightOf(s, ctx).toFixed(2) }]));
      if (note) list2.diversity = note; out.set(kk, list2);
    }
  }
  return out;
}
