/* Index resolver: front-end request params -> which index shard to read.  Pure, dependency-free; runs in the Worker and in Node tests.
   SOURCE OF TRUTH is worker/src/resolver.js; ingest/vendor/resolver.js is a copy (ingest/sync-vendor.sh, checked by test-index.mjs).
   places.json (v2): { k: { "<key>": { "<tag>": mask } } }, mask bit i = shard exists for period i of [live, 24h, 7d, 30d]. */
const norm = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
const ALT = { bangalore: "bengaluru", bombay: "mumbai", madras: "chennai", calcutta: "kolkata", cochin: "kochi", trivandrum: "thiruvananthapuram", calicut: "kozhikode",
  trichur: "thrissur", poona: "pune", baroda: "vadodara", mysore: "mysuru", orissa: "odisha", pondicherry: "puducherry", keralam: "kerala", gurgaon: "gurugram", "new york": "new york city" };
/* site topic chips (data-q) + categories -> index tag. Anything else is free text and is NOT in the index. */
export const CHIP_TAG = { climate: "climate", election: "election", elections: "election", economy: "business", cricket: "cricket", "artificial intelligence": "ai", ai: "ai", health: "health",
  space: "space", monsoon: "monsoon", technology: "technology", tech: "technology", business: "business", sports: "sports", sport: "sports", science: "science", politics: "politics",
  world: "world", entertainment: "entertainment" };
export const PERIODS = ["24h", "7d", "30d"];
export const SLOTS = ["live", "24h", "7d", "30d"];
const CONT = { asia: "Asia", europe: "Europe", africa: "Africa", "north america": "North-America", "south america": "South-America", oceania: "Oceania" };
const slug = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
const firstTerm = (place) => String(place || "").split(/\s+OR\s+/i)[0].replace(/["()]/g, "").trim();
const canon = (n) => ALT[norm(n)] || norm(n);

/** legacy front-end timespan (24h | 3d) -> curated period.  3d is not indexed: it is answered with the 7-day ranking (stated in the response) */
export function legacyPeriod(ts) { return ts === "3d" ? "7d" : "24h"; }

export function makeResolver(places) {
  const idx = (places && places.k) || {};
  const has = (key, tag, slot) => { const m = idx[key] && idx[key][tag]; return !!(m && (m & (1 << SLOTS.indexOf(slot)))); };
  /** q = request params (live.js paramsFor + mode, period, topic, key, state).  Returns {ok, key, tag, mode, period, path, requestedKey, fellBackFrom?, fellBackToPeriod?} or {ok:false, reason} */
  function resolve(q) {
    const mode = q.mode === "live" ? "live" : "curated";
    const period = PERIODS.includes(q.period) ? q.period : "24h";
    const raw = norm(q.topic || q.q || "");
    const tag = raw ? CHIP_TAG[raw] : "all";
    if (!tag) return { ok: false, reason: "free-text query is not in the index" };
    if (q.lang && q.lang !== "en") return { ok: false, reason: "index is English-language only" };
    const iso = String(q.country || "").toUpperCase();
    let chain, placeKeys;   // chain: most specific -> least specific; never climbs to "world" for a place request (a Kochi reader must not get world news silently)
    if (q.key) { chain = [String(q.key)]; placeKeys = chain; }
    else if (q.place && iso && !(norm(q.countryName || "") === norm(firstTerm(q.place)) || norm(firstTerm(q.place)) === "united states")) {
      const n = slug(canon(firstTerm(q.place))), st = q.state ? slug(canon(q.state)) : null;
      chain = [`s-${iso}-${n}`, `t-${iso}-${n}` + (st ? "-" + st : ""), `t-${iso}-${n}`];   // a state, else a city (state-disambiguated key first)
      placeKeys = chain.slice();
      if (st && st !== n) chain.push(`s-${iso}-${st}`);
      chain.push("from-" + iso);
    } else if (iso && (q.scope === "about")) { chain = ["about-" + iso]; placeKeys = chain; }
    else if (iso) { chain = ["from-" + iso]; placeKeys = chain; }
    else if (q.region) { chain = ["r-" + (CONT[norm(q.region)] || String(q.region).replace(/ /g, "-"))]; placeKeys = chain; }
    else { chain = ["world"]; placeKeys = chain; }
    const requested = placeKeys.find((k) => idx[k]) || placeKeys[0];
    const slots = mode === "live" ? ["live", period] : [period];   // live shard empty -> the same place's curated shard
    for (const k of chain) for (const sl of slots) if (has(k, tag, sl)) {
      const dir = sl === "live" ? "live" : "curated/" + sl;
      return { ok: true, key: k, tag, mode: sl === "live" ? "live" : "curated", period: sl, path: `${dir}/${k}/${tag}.json`, requestedKey: requested,
        ...(!placeKeys.includes(k) ? { fellBackFrom: requested } : {}), ...(sl !== slots[0] ? { fellBackToPeriod: sl } : {}) };
    }
    /* a topic with too few stories for this place: the same place without the topic is NOT shown silently (the reader asked for the topic) -> not indexed */
    return { ok: false, reason: `no indexed stories for ${chain[0]}|${tag} (${mode}/${period})` };
  }
  resolve.has = has;
  return resolve;
}
