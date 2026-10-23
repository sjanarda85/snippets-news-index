/* Region / country / scope / language fields for stories (editorial guide section 7, asks 15-19). Pure functions, no network.
   Everything here is derived from data the index already stores (place keys, outlet-country counts, headline); nothing is guessed:
   a field that cannot be determined is left empty ("" / []) and counted as "unknown" in the diversity report. */
import fs from "node:fs";
import path from "node:path";
import { norm } from "./places.mjs";

export const REGION_IDS = ["africa", "asia", "europe", "middle-east", "north-america", "latin-america", "oceania"];
export const MULTI = "multi-region";
export const REGION_NAMES = { africa: "Africa", asia: "Asia", europe: "Europe", "middle-east": "Middle East", "north-america": "North America", "latin-america": "Latin America", oceania: "Oceania", [MULTI]: "Multi-region" };
export const SCOPE_WEIGHT = { global: 1.0, regional: 0.85, national: 0.7, "single-country": 0.55, local: 0.4 };

/** country id (map data id) -> ISO2 or "" ; region id or "" */
export function loadGeo(P, dir) {
  const cfg = JSON.parse(fs.readFileSync(path.join(dir, "regions.json"), "utf8"));
  const regionOfIso = (iso) => (iso && (cfg.overrides[iso] || cfg.continentDefault[(P.countries.get(iso) || {}).cont])) || "";
  const iso2Of = (id) => { const c = P.countries.get(id); return c && c.iso2 && /^[A-Z]{2}$/.test(c.iso2) && c.id === c.iso2 ? c.iso2 : ""; };
  /* country names a headline can use (map names + common short forms). Ambiguous words need GKG to confirm the country (see primary()). */
  const names = new Map(), ambiguous = new Set(["chad", "jordan", "georgia", "turkey", "niger", "guinea", "congo", "panama", "mali", "cuba"]);
  for (const c of P.countries.values()) { const iso = iso2Of(c.id); if (iso) names.set(norm(c.name), iso); }
  const extra = { "united states": "US", "united states of america": "US", america: "US", usa: "US", us: "US", "u s": "US", "u s a": "US", uk: "GB", "u k": "GB", britain: "GB", "great britain": "GB", england: "GB", scotland: "GB", wales: "GB",
    "northern ireland": "GB", russia: "RU", uae: "AE", "united arab emirates": "AE", "south korea": "KR", "north korea": "KP", korea: "KR", "dr congo": "CD", drc: "CD", "democratic republic of the congo": "CD", "democratic republic of congo": "CD",
    bosnia: "BA", "ivory coast": "CI", "cote d ivoire": "CI", palestine: "PS", "palestinian territories": "PS", gaza: "PS", "west bank": "PS", "dominican republic": "DO", "south sudan": "SS", "czech republic": "CZ", swaziland: "SZ", eswatini: "SZ",
    burma: "MM", myanmar: "MM", turkiye: "TR", "hong kong": "HK", taiwan: "TW", vietnam: "VN", laos: "LA", syria: "SY", iran: "IR", "north macedonia": "MK", macedonia: "MK", "east timor": "TL", "timor leste": "TL", "cape verde": "CV", "saudi arabia": "SA", "new zealand": "NZ" };
  for (const [k, v] of Object.entries(extra)) names.set(k, v);
  const CASE_SENSITIVE = new Set(["us", "u s", "uk", "u k", "usa", "uae", "drc", "u s a"]);   // only when written in capitals
  return { cfg, regionOfIso, iso2Of, regionName: (r) => REGION_NAMES[r] || r, names, ambiguous, CASE_SENSITIVE };
}

/** countries named in a headline, in order of appearance (ISO2). `confirmed` = ISO2 set GKG says the story is about (confirms ambiguous words). */
export function headlineCountries(G, title, confirmed = new Set()) {
  const words = title.replace(/[“”"()\[\]:;!?,]/g, " ").replace(/['’]s\b/g, "").split(/\s+/).filter(Boolean);
  const out = [];
  for (let i = 0; i < words.length; i++) {
    if (!/^[A-Z]/.test(words[i])) continue;
    for (let n = 4; n >= 1; n--) {
      if (i + n > words.length) continue;
      const raw = words.slice(i, i + n).join(" ").replace(/\.(?=\s|$)/g, ""), key = norm(words.slice(i, i + n).join(" "));
      const iso = G.names.get(key); if (!iso) continue;
      if (G.CASE_SENSITIVE.has(key) && raw.replace(/\./g, "") !== raw.replace(/\./g, "").toUpperCase()) continue;
      if (G.ambiguous.has(key) && !confirmed.has(iso)) continue;
      if (!out.includes(iso)) out.push(iso);
      i += n - 1; break;
    }
  }
  return out;
}

/** story -> geo fields. `s` is the stored story (pl = place keys, oc = outlet counts per outlet-country FIPS, h = headline). */
export function geoOf(s, ctx) {
  const { P, G } = ctx;
  const gkg = [];
  for (const k of s.pl || []) {
    let m = /^about-(.+)$/.exec(k) || /^[st]-([^-]+(?:~[A-Za-z]+)?)-/.exec(k);
    const iso = m && G.iso2Of(m[1]); if (iso && !gkg.includes(iso)) gkg.push(iso);
  }
  const named = headlineCountries(G, s.h, new Set(gkg));
  const countries = [...new Set([...named, ...gkg])].slice(0, 8);
  const primary = named[0] || (gkg.length === 1 ? gkg[0] : "");
  const placeRegions = [...new Set(countries.map((c) => G.regionOfIso(c)).filter(Boolean))];
  /* outlet regions (where the outlets are): from GDELT's domain->country list, FIPS -> country -> region. Unknown outlet countries are not counted. */
  const outletRegions = {}, outletCountries = {};
  for (const [f, n] of Object.entries(s.oc || {})) {
    const c = P.byFips.get(f), iso = c && G.iso2Of(c.id); if (!iso) continue;
    outletCountries[iso] = (outletCountries[iso] || 0) + n;
    const r = G.regionOfIso(iso); if (r) outletRegions[r] = (outletRegions[r] || 0) + n;
  }
  for (const r of Object.keys(outletRegions)) if (outletRegions[r] < 2) delete outletRegions[r];   // a region counts only with >= 2 of its outlets: one stray outlet does not make a story "global"
  const orList = Object.keys(outletRegions), ocN = Object.keys(outletCountries).length;
  const known = Object.values(outletCountries).reduce((a, b) => a + b, 0);
  const subNational = (s.pl || []).some((k) => /^[st]-/.test(k));
  let region = "", scope;
  if (placeRegions.length >= 2) region = MULTI; else if (placeRegions.length === 1) region = placeRegions[0];
  else if (orList.length >= 3) region = MULTI;   // no place named, but outlets in 3+ regions carry it: a global story
  if (orList.length >= 3) scope = "global";
  else if (placeRegions.length >= 2 || countries.length >= 2 || orList.length === 2) scope = "regional";
  else if (countries.length === 1) {
    const own = (outletCountries[countries[0]] || 0) / Math.max(1, known);
    scope = subNational ? "local" : own >= 0.7 || ocN < 2 ? "national" : "single-country";
  } else scope = "national";
  return { region, regions: placeRegions, countries, primaryCountry: region === MULTI && placeRegions.length >= 2 ? "" : primary, scope, outletRegions: orList, outletRegionN: orList.length, scopeKnown: countries.length > 0 || orList.length > 0 };
}

/** topic tier weight (editorial guide section 3): T1 1.0, T2 0.75, T3 0.4, T4 (flagged) 0.5 with no boost, untagged 0.6 */
const T1 = new Set(["business", "politics", "technology", "ai", "health", "climate", "monsoon", "election"]), T2 = new Set(["science", "space", "sports", "cricket", "world"]);
export function topicWeight(s) {
  if (s.rr && s.rr.length) return 0.5;
  let w = 0;
  for (const t of s.tg || []) w = Math.max(w, T1.has(t) ? 1 : T2.has(t) ? 0.75 : t === "entertainment" ? 0.4 : 0);
  return w || 0.6;
}
