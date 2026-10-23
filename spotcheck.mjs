// Weekly 5% spot check of UNFLAGGED stories (Legal: section 10).  node spotcheck.mjs [baseUrlOrDir] [--pct 5] > spotcheck-YYYYMMDD.csv
// Samples stories from curated/24h shards (world + every region, v1.6), skips flagged ones, prints id, outlets, headline, url so a human can check for
// crime / named-person / minors content the keyword filter missed. Anything found: hide it (blocklist-tool.mjs / POST /api/admin/hide) and tell Legal.
import { readFile } from "node:fs/promises";
const a = process.argv.slice(2); const base = (a.find((x, i) => !x.startsWith("--") && a[i - 1] !== "--pct") || "https://sjanarda85.github.io/snippets-news-index").replace(/\/$/, "");
const pi = a.indexOf("--pct"); const pct = (pi >= 0 ? Number(a[pi + 1]) : 5) / 100;
const get = async (p) => base.startsWith("http") ? (await fetch(`${base}/${p}`)).json() : JSON.parse(await readFile(`${base}/${p}`, "utf8"));
const rows = []; const seen = new Set();
for (const key of ["world", "rg-africa", "rg-asia", "rg-europe", "rg-middle-east", "rg-north-america", "rg-latin-america", "rg-oceania", "rg-multi-region", "from-IN", "about-IN"]) for (const per of ["24h", "7d"]) {
  let sh; try { sh = await get(`curated/${per}/${key}/all.json`); } catch { continue; }
  for (const s of sh.stories || []) { if (s.flagged || s.needsReview || seen.has(s.id)) continue; seen.add(s.id); rows.push({ per, key, s }); }
}
const n = Math.max(10, Math.ceil(rows.length * pct)); const pick = rows.sort(() => Math.random() - 0.5).slice(0, n);
const q = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
console.log("period,place,id,outlets,region,country,lang,headline,url,ok_or_problem");
for (const { per, key, s } of pick) console.log([per, key, s.id, s.outlets, s.region || "unknown", s.primaryCountry || "unknown", s.lang || "en", q(s.headline), q(s.sources?.[0]?.url), ""].join(","));
// diversity summary of the sampled World shard (country cap check), printed to stderr so the CSV stays clean
try { const w = await get("curated/24h/world/all.json"); if (w.diversity) console.error("World 24h diversity: max country", JSON.stringify(w.diversity.maxCountry), "cap ok:", w.diversity.countryCapOk, "| regions in top 20:", w.diversity.regionsPresentTop20, "| region cap ok:", w.diversity.regionCapOk); } catch {}
console.error(`${pick.length} of ${rows.length} unflagged stories sampled (${(pct * 100).toFixed(0)}% min 10)`);
