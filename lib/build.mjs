/* article -> enriched compact record; articles -> stories (clusters); stories -> ranked shards. Pure functions (no network). */
import { tokens, normTitle, cleanHeadline, clusterItems, storyId, scoreTitle } from "./cluster.mjs";
import { parseLocations, titleHits, norm, TITLE_TERMS } from "./places.mjs";
import { tagsOf, CATEGORY_OF } from "./topics.mjs";
import { junkReason } from "./junk.mjs";
import { POLICY, guiltAsFact } from "./policy.mjs";
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
  return { u: a.url, d: a.domain, t: a.title, ts: a.ts, tn: +a.tone.toFixed(1), wc: a.wc, tg: tagsOf(a.themes, a.title), pl: [...keep], pt: [...pt], oc };
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
    id: storyId(lead.t), h: cleanHeadline(lead.t), first: Math.min(...times), last: Math.max(...times), n: srcAll.length,
    tone: +(members.reduce((s, x) => s + x.tn, 0) / members.length).toFixed(1), wc: Math.max(...members.map((x) => x.wc || 0)),
    tg, pl, oc, ds: srcAll.slice(0, MAX_DS).map((x) => x.d),
    src: null };
  const recent = srcAll.slice().sort((x, y) => y.ts - x.ts).slice(0, MAX_SRC);
  if (!recent.includes(lead)) recent[recent.length - 1] = lead;
  /* legal flags: wire/exclusive/single-source over ALL sources (same guard.js as the Worker); needs-review over the headline + the titles we would show */
  story.ho = headlineOnlyReason({ sources: srcAll.map((x) => ({ title: x.t, domain: x.d, outlet: x.d })) }) || "";
  story.rr = reviewReasons({ sources: recent.map((x) => ({ title: x.t, domain: x.d })), headline: story.h });
  story.lead = lead.d;
  if (story.rr.length) {   // Legal: flagged stories = the publisher's headline unchanged, no tone, no GDELT-only location, held if guilt is stated as fact
    story.h = lead.t.trim();
    if (POLICY.LOCATION_FROM_HEADLINE_ONLY && story.rr.includes("crime-or-court")) { const ptc = cnt((x) => x.pt || []), thr2 = Math.max(1, Math.ceil(members.length * 0.34)); story.pl = [...ptc].filter(([, n]) => n >= thr2).map(([k]) => k); }
    if (members.some((x) => guiltAsFact(x.t))) story.hold = 1;
  }
  story.src = recent.map((x) => [x.d, x.u, x.t, x.ts, x.oc || ""]);
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
      ho: (ss.find((s) => s.ho === "exclusive" || s.ho === "wire") || {}).ho || (ds.length < 2 && lead.n < 2 ? "single-source" : ""), rr: [...new Set(ss.flatMap((s) => s.rr))], tone: lead.tone, ...(ss.some((s) => s.hold) ? { hold: 1 } : {}) };
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
export function score(s, now, period, loc) {
  const age = Math.max(0, (now - s.last) / 3600000), decay = Math.pow(0.5, age / PERIODS[period].hl);
  const prom = s.rr && s.rr.length ? 0 : 0.5 * Math.min(1, (s.wc || 0) / 1200) + 0.5 * Math.min(1, Math.abs(s.tone || 0) / 8);   // flagged stories get no prominence / tone boost
  const span = Math.min(3, Math.floor((s.last - s.first) / 86400000));
  const eff = Math.max(1, s.ne ?? s.n), base = loc ? Math.log(Math.max(1, loc.n * (eff / s.n))) + 0.25 * Math.log(eff) : Math.log(eff);
  return 2.2 * base + 1.6 * decay + 0.8 * prom + 0.5 * span;
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
/** story -> API story object (what the Worker returns inside snippets.feed.v1 "stories"; summaries are added later by the existing AI step) */
export function apiStory(s, now, period, loc) {
  const lead = s.h;
  return { id: s.id, headline: s.h, firstSeen: iso(s.first), updatedAt: iso(s.last), category: s.cat, tags: s.tg.slice(0, 4), outlets: s.n, ...(loc ? { localOutlets: loc.n } : {}), why: why(s, now, period, loc),
    sources: s.src.slice(0, OUT_SRC).map((x) => ({ outlet: x[0], url: x[1], ...(normTitle(x[2]) === normTitle(lead) ? {} : { title: x[2] }), publishedAt: iso(x[3]) })),
    headlineOnly: s.ho || undefined, needsReview: s.rr.length ? true : undefined, reviewReasons: s.rr.length ? s.rr : undefined, ...(s.rr.length ? { leadOutlet: s.lead } : {}),
    ...(s.rr.length && POLICY.DROP_TONE_FLAGGED ? {} : { tone: s.tone }) };
}

/** place keys a story belongs to (for the keys the site can ask for) */
export function keysOf(s, ctx) {
  const keys = new Set(["world"]);
  for (const f of Object.keys(s.oc)) { const c = ctx.P.byFips.get(f); if (c) { keys.add("from-" + c.id); keys.add("r-" + c.cont.replace(/ /g, "-")); } }
  for (const k of s.pl) {
    if (k.startsWith("about-")) { keys.add(k); continue; }
    const m = /^[st]-([^-]+)-/.exec(k); const c = m && ctx.P.countries.get(m[1]);
    if (c && c.fips && s.oc[c.fips]) keys.add(k);   // state/city shards: stories carried by >= 1 outlet of that country (site scope "from")
  }
  return keys;
}
/** stories -> Map("<key>|<tag>") -> ranked [story] */
const SHARD_TAGS = new Set(["technology", "business", "sports", "health", "science", "climate", "politics", "world", "ai", "cricket", "election", "space", "monsoon", "entertainment"]);   // chips + site categories; "crime" only inside "all" (needs-review)
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
    const lk = kk.slice(0, kk.indexOf("|")), sc = new Map(list.map((s) => [s, score(s, now, period, localOf(s, lk, ctx))]));
    let ranked;
    if (period === "live") ranked = list.filter((s) => s.n >= 2 || /^(s|t)-/.test(kk) || list.length < 15).sort((a, b) => b.last - a.last);
    else { ranked = list.sort((a, b) => sc.get(b) - sc.get(a)); const multi = ranked.filter((s) => s.n >= 2); if (multi.length >= 8) ranked = multi; }
    const seenT = new Set(), top = [];
    for (const s of ranked) { const nt = normTitle(s.h); if (seenT.has(nt)) continue; seenT.add(nt); top.push(s); if (top.length >= topN) break; }
    if (top.length >= need) out.set(kk, top.slice(0, tag === "all" ? topN : Math.min(topN, 25)));
  }
  return out;
}
