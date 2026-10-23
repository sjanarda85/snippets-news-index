/* offline checks: resolver vs the REAL param objects the front-end builds (live.js paramsFor / worker prewarm catalogue) + shard sanity */
import fs from "node:fs";
import { makeResolver } from "./vendor/resolver.js";
const B = process.argv[2] || "build";
const idx = JSON.parse(fs.readFileSync(B + "/places.json", "utf8")), resolve = makeResolver(idx);
if (idx.schema !== "snippets.index.places.v2" || !idx.k.world) { console.error("bad places.json"); process.exit(1); }
const cases = [
  ["World (no q, worldDomains)", { domains: "reuters.com,apnews.com" }],
  ["World + Technology chip q", { q: "artificial intelligence" }],
  ["Country India, scope from", { country: "IN", countryName: "India", fips: "IN" }],
  ["Country India, scope about", { country: "IN", countryName: "India", place: "India", scope: "about" }],
  ["State Kerala (aliases)", { country: "IN", place: '"Kerala" OR "Keralam"' }],
  ["State Kerala, curated 7d", { country: "IN", place: "Kerala OR Keralam", mode: "curated", period: "7d" }],
  ["City Kochi (alias Cochin)", { country: "IN", countryName: "India", place: "Kochi OR Cochin", state: "Kerala" }],
  ["City Kochi curated 24h Technology", { country: "IN", place: "Kochi OR Cochin", state: "Kerala", mode: "curated", period: "24h", topic: "technology" }],
  ["City Bengaluru", { country: "IN", place: "Bengaluru OR Bangalore", mode: "curated", period: "30d" }],
  ["Mumbai climate chip", { country: "IN", place: "Mumbai OR Bombay", q: "climate", mode: "curated" }],
  ["Continent Asia", { region: "Asia", fips: "IN,CH" }],
  ["India + cricket", { country: "IN", q: "cricket", mode: "curated", period: "7d" }],
  ["India + monsoon", { country: "IN", q: "monsoon" }],
  ["Free text q", { country: "IN", q: "kerala floods relief camps" }],
  ["USA Texas", { country: "US", place: "Texas" }],
  ["Unknown village", { country: "IN", place: "Nowhereville" }],
  ["Region chip Africa (key rg-africa)", { key: "rg-africa", mode: "curated", period: "24h" }],
  ["Region chip Latin America, live", { key: "rg-latin-america", mode: "live" }],
  ["Region chip Multi-region", { key: "rg-multi-region", mode: "curated", period: "7d" }],
  ["Kenya (country, about)", { country: "KE", countryName: "Kenya", place: "Kenya", scope: "about" }],
  ["Brazil (country, local outlets)", { country: "BR", countryName: "Brazil", fips: "BR" }],
  ["Germany + climate chip", { country: "DE", countryName: "Germany", place: "Germany", scope: "about", q: "climate" }],
  ["Direct key from map id (IN:Kerala -> s-IN-kerala)", { key: "s-IN-kerala", mode: "curated", period: "30d" }],
];
let bad = 0;
for (const [name, q] of cases) {
  const r = resolve(q);
  const ok = r.ok && fs.existsSync(`${B}/${r.path}`);
  const n = ok ? JSON.parse(fs.readFileSync(`${B}/${r.path}`, "utf8")).count : 0;
  console.log((r.ok ? (ok ? "OK  " : "MISS") : "FALL") + " " + name.padEnd(48) + (r.ok ? `${r.path} (${n} stories)${r.fellBackFrom ? "  [fell back from " + r.fellBackFrom + "]" : ""}` : r.reason));
  if (r.ok && !ok) bad++;
}
// shard invariants
let files = 0, flagged = 0, stories = 0, multi = 0, eligible = 0, longTitle = 0;
for (const d of ["live", "curated"]) for (const f of fs.readdirSync(`${B}/${d}`, { recursive: true })) {
  if (!f.endsWith("all.json") || !/(world|about-IN|from-IN|s-IN-kerala|about-KE|about-BR|rg-[a-z-]+)\//.test(f)) continue;
  const j = JSON.parse(fs.readFileSync(`${B}/${d}/${f}`, "utf8")); files++;
  for (const s of j.stories) { stories++; if (s.outlets >= 2) multi++; if (!s.headlineOnly && !s.needsReview && s.outlets >= 2) eligible++; if (s.needsReview) flagged++; if (!s.id || !s.headline || !s.sources.length || !s.sources.every((x) => /^https?:/.test(x.url) && x.outlet)) bad++; if (s.headline.length > 300) longTitle++; if (JSON.stringify(s).match(/"(summary|description|body)"/)) bad++; }
}
// v1.6 invariants: the World shard carries region / country / language fields, UTC ISO times, and the diversity block with the caps respected
const regionsInIdx = (idx.regions || []).map((r) => r.id);
if (regionsInIdx.length !== 8 || !regionsInIdx.includes("multi-region") || idx.scope !== "global") { console.error("places.json lacks the 7 regions + multi-region / scope=global"); bad++; }
const w = JSON.parse(fs.readFileSync(`${B}/curated/24h/world/all.json`, "utf8"));
const iso = (t) => /^\d{4}-\d\d-\d\dT[\d:.]+(Z|[+-]\d\d:\d\d)$/.test(t || "");
const v16 = w.stories.every((s) => typeof s.region === "string" && Array.isArray(s.countries) && /^(en|[a-z]{2,3})$/.test(s.lang) && /^L[123]$/.test(s.languageTier) && s.sources.every((x) => /^([A-Z]{2}|unknown)$/.test(x.outletCountry)) && iso(s.updatedAt));
if (!v16 || !w.diversity || !w.diversity.countryCapOk || !w.diversity.regionCapOk || w.stories.length < 20) { console.error("World shard v1.6 fields / diversity caps failed", JSON.stringify(w.diversity && { c: w.diversity.countryCapOk, r: w.diversity.regionCapOk, n: w.stories.length })); bad++; }
else console.log(`v1.6: World 24h top ${w.stories.length}: max country ${JSON.stringify(w.diversity.maxCountry)}, regions in top 20: ${w.diversity.regionsPresentTop20}, caps ok`);
console.log(`\ninvariants over ${files} sample shards: stories=${stories} multiOutlet=${multi} summaryEligible(no wire/exclusive/single-source/needs-review)=${eligible} (${(100 * eligible / stories).toFixed(0)}%) needsReview=${flagged} errors=${bad}`);
process.exit(bad ? 1 : 0);
