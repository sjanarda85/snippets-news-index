/* Place model = the SAME ids/names/fips the front-end uses (site/assets/js/map2.js + live.js), read from site/assets/data:
     countries.topo.json  properties {iso2, iso3, name, cont, fips}   -> country id = iso2 (map2 cidOf)
     admin1/<id>.json     properties {name, code}                      -> state key  s-<ID>-<slug(name)>   (map2 id "IN:Kerala")
     places/<id>.json     {s:[state names], c:[[name,lat,lon,pop,stIdx,cap]]} -> city key t-<ID>-<slug(name)>
   GDELT V2ENHANCEDLOCATIONS rows are mapped onto these (country by FIPS, state/city by name + front-end aliases). */
import fs from "node:fs";
import path from "node:path";

export const slug = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
export const norm = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9& ]+/g, " ").replace(/\s+/g, " ").trim();
/* alternative spellings (live.js ALIASES + map2.js ALT): GDELT/newsrooms use these; value = canonical name in the map data */
export const ALT = { bangalore: "Bengaluru", bombay: "Mumbai", madras: "Chennai", calcutta: "Kolkata", cochin: "Kochi", trivandrum: "Thiruvananthapuram",
  calicut: "Kozhikode", trichur: "Thrissur", poona: "Pune", baroda: "Vadodara", mysore: "Mysuru", orissa: "Odisha", pondicherry: "Puducherry", benares: "Varanasi",
  banaras: "Varanasi", gurgaon: "Gurugram", keralam: "Kerala", "nct of delhi": "Delhi", "new delhi": "New Delhi", "andaman and nicobar islands": "Andaman and Nicobar",
  "jammu and kashmir state": "Jammu and Kashmir", "new york": "New York City", "ho chi minh": "Ho Chi Minh City" };
/* the words a headline may use for a place (query side = live.js ALIASES): used for the "place is in the headline" test */
export const TITLE_TERMS = { Kerala: ["kerala", "keralam"], Thiruvananthapuram: ["thiruvananthapuram", "trivandrum"], Kochi: ["kochi", "cochin"],
  Kozhikode: ["kozhikode", "calicut"], Thrissur: ["thrissur", "trichur"], Bengaluru: ["bengaluru", "bangalore"], Mumbai: ["mumbai", "bombay"],
  Chennai: ["chennai", "madras"], Odisha: ["odisha", "orissa"], Kolkata: ["kolkata", "calcutta"], Delhi: ["delhi"], "New Delhi": ["new delhi", "delhi"],
  "United States of America": ["united states", "u s", "us"], "United Kingdom": ["united kingdom", "britain", "uk", "u k"] };
export const CONTINENTS = ["Asia", "Europe", "Africa", "North America", "South America", "Oceania"];
const SEAS = { "Maldives": "Asia", "British Indian Ocean Ter.": "Asia", "Heard I. and McDonald Is.": "Oceania", "S. Geo. and the Is.": "South America", "Fr. S. Antarctic Lands": "Africa" };

function topo(file) { try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch { return null; } }
export function loadPlaces(siteData) {
  const world = topo(path.join(siteData, "countries.topo.json"));
  const countries = new Map(), byFips = new Map(), byName = new Map(), seen = new Set();
  for (const g of world.objects.countries.geometries) {
    const p = g.properties; if (!p) continue;
    const ok = (v) => v && v !== "-99";
    let id = ok(p.iso2) ? p.iso2 : ok(p.iso3) ? p.iso3 : p.name.replace(/[^A-Za-z]+/g, "-").replace(/^-|-$/g, "");
    let iso2 = ok(p.iso2) ? p.iso2 : "", fips = ok(p.fips) ? p.fips : "";
    if (seen.has(id)) { id += "~" + p.name.replace(/[^A-Za-z]+/g, ""); iso2 = ""; fips = ""; }
    seen.add(id);
    const cont = SEAS[p.name] || (p.cont === "Seven seas (open ocean)" ? "Africa" : p.cont);
    const c = { id, iso2, fips, name: p.name, cont, key: "about-" + id, states: new Map(), cities: new Map(), cityList: [] };
    countries.set(id, c); if (fips && !byFips.has(fips)) byFips.set(fips, c); byName.set(norm(p.name), c);
  }
  for (const c of countries.values()) {
    const a = topo(path.join(siteData, "admin1", c.id + ".json"));
    if (a) for (const g of a.objects.admin1.geometries) { const n = g.properties.name; c.states.set(norm(n), { name: n, key: `s-${c.id}-${slug(n)}`, iso: c.id }); }
    const pl = topo(path.join(siteData, "places", c.id + ".json"));
    if (pl) {
      const dup = new Map();
      for (const r of pl.c) dup.set(norm(r[0]), (dup.get(norm(r[0])) || 0) + 1);
      for (const r of pl.c) {
        const st = r[4] >= 0 ? pl.s[r[4]] : null, n = norm(r[0]);
        const key = `t-${c.id}-${slug(r[0])}` + (dup.get(n) > 1 && st ? "-" + slug(st) : "");
        const city = { name: r[0], state: st, pop: r[3], cap: r[5], key, iso: c.id };
        c.cityList.push(city);
        if (!c.cities.has(n)) c.cities.set(n, []);
        c.cities.get(n).push(city);
      }
    }
  }
  const all = { countries, byFips, byName };
  all.cont = (iso) => (countries.get(iso) || {}).cont;
  all.describe = (key) => {   // key -> {type, name, iso, state?}
    if (key === "world") return { type: "world", name: "World" };
    let m;
    if ((m = /^(from|about)-(.+)$/.exec(key))) { const c = countries.get(m[2]); return c && { type: "country", scope: m[1], name: c.name, iso: c.id }; }
    if ((m = /^r-(.+)$/.exec(key))) return { type: "continent", name: m[1].replace(/-/g, " ") };
    if ((m = /^s-([^-]+(?:~[A-Za-z]+)?)-(.+)$/.exec(key))) { const c = countries.get(m[1]); const s = c && [...c.states.values()].find((x) => x.key === key); return s && { type: "state", name: s.name, iso: c.id, country: c.name }; }
    if ((m = /^t-([^-]+(?:~[A-Za-z]+)?)-(.+)$/.exec(key))) { const c = countries.get(m[1]); const s = c && c.cityList.find((x) => x.key === key); return s && { type: "city", name: s.name, iso: c.id, country: c.name, state: s.state }; }
    return null;
  };
  return all;
}

/** Parse one V2ENHANCEDLOCATIONS value into place hits: [{iso, state?, city?, count, first, name}] (merged per place). */
export function parseLocations(P, raw) {
  if (!raw) return [];
  const hit = new Map();
  for (const ent of raw.split(";")) {
    const f = ent.split("#"); if (f.length < 7) continue;
    const type = +f[0], parts = f[1].split(",").map((x) => x.trim()), fips = f[2], off = +f[f.length - 1] || 0;
    const c = P.byFips.get(fips); if (!c) continue;
    let state = null, city = null;
    const canon = (n) => { const k = norm(n); return ALT[k] ? ALT[k] : n; };
    const findState = (n) => { const k = norm(canon(n)); let s = c.states.get(k); if (s) return s; for (const [kk, v] of c.states) if (k.length > 4 && (kk.startsWith(k) || k.startsWith(kk)) && kk.length > 4) return v; return null; };
    if (type === 2 || type === 5) state = findState(parts[0]);
    else if (type === 3 || type === 4) {
      if (parts.length >= 3) state = findState(parts[1]);
      const cand = c.cities.get(norm(canon(parts[0])));
      if (cand) city = (state && cand.find((x) => x.state === state.name)) || (cand.length === 1 ? cand[0] : cand.slice().sort((a, b) => b.pop - a.pop)[0]);
      if (city && !state && city.state) state = c.states.get(norm(city.state)) || null;
    }
    const keys = [["about-" + c.id, { iso: c.id, name: c.name, lvl: 0 }]];
    if (state) keys.push([state.key, { iso: c.id, name: state.name, lvl: 1 }]);
    if (city) keys.push([city.key, { iso: c.id, name: city.name, lvl: 2 }]);
    for (const [k, meta] of keys) { const h = hit.get(k); if (h) { h.count++; h.first = Math.min(h.first, off); } else hit.set(k, { key: k, ...meta, count: 1, first: off }); }
  }
  return [...hit.values()];
}

/* Place names written in the HEADLINE, found by name (GKG's location list often misses them, e.g. 25 "Kochi/Cochin" headlines vs 3 GKG Kochi hits in 72 h).
   Only for the outlet's country + countries GKG saw; names must be capitalised in the headline; a few ambiguous English words are skipped. */
const AMBIG = new Set("reading mobile orange buffalo jackson bath of long wells mesa salem hope nice normal reading cork turkey chad jordan georgia china sale hell boring plymouth victoria washington lincoln springfield madison marion union independence mars".split(" "));
export function titleHits(P, title, isos) {
  const words = title.replace(/[“”"()\[\]:;!?]/g, " ").replace(/['’]s\b/g, "").split(/\s+/).filter(Boolean);
  const out = [];
  for (const iso of isos) {
    const c = P.countries.get(iso); if (!c) continue;
    for (let i = 0; i < words.length; i++) {
      if (!/^[A-Z]/.test(words[i])) continue;
      for (let n = 1; n <= 3 && i + n <= words.length; n++) {
        const raw = words.slice(i, i + n).join(" ").replace(/[.,]+$/, ""), k0 = norm(raw), k = ALT[k0] ? norm(ALT[k0]) : k0;
        if (!k || (n === 1 && AMBIG.has(k)) || k.length < 4) continue;
        const st = c.states.get(k), ct = c.cities.get(k);
        if (st) out.push({ key: st.key, iso: c.id, lvl: 1, name: st.name });
        if (ct) { const city = ct.slice().sort((a, b) => b.pop - a.pop)[0]; out.push({ key: city.key, iso: c.id, lvl: 2, name: city.name, state: city.state }); }
      }
    }
  }
  return out;
}
