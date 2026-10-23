// Weekly 5% spot check of UNFLAGGED stories (Legal: section 10).  node spotcheck.mjs [baseUrlOrDir] [--pct 5] > spotcheck-YYYYMMDD.csv
// Samples stories from curated/24h shards (world + India), skips flagged ones, prints id, outlets, headline, url so a human can check for
// crime / named-person / minors content the keyword filter missed. Anything found: add the URL to blocklist.txt (and the Worker's list) and tell Legal.
import { readFile } from "node:fs/promises";
const a = process.argv.slice(2); const base = (a.find((x, i) => !x.startsWith("--") && a[i - 1] !== "--pct") || "https://sjanarda85.github.io/snippets-news-index").replace(/\/$/, "");
const pi = a.indexOf("--pct"); const pct = (pi >= 0 ? Number(a[pi + 1]) : 5) / 100;
const get = async (p) => base.startsWith("http") ? (await fetch(`${base}/${p}`)).json() : JSON.parse(await readFile(`${base}/${p}`, "utf8"));
const rows = []; const seen = new Set();
for (const key of ["world", "from-IN", "about-IN", "r-Asia", "r-Europe", "r-North America"]) for (const per of ["24h", "7d"]) {
  let sh; try { sh = await get(`curated/${per}/${key}/all.json`); } catch { continue; }
  for (const s of sh.stories || []) { if (s.flagged || s.needsReview || seen.has(s.id)) continue; seen.add(s.id); rows.push({ per, key, s }); }
}
const n = Math.max(10, Math.ceil(rows.length * pct)); const pick = rows.sort(() => Math.random() - 0.5).slice(0, n);
const q = (x) => `"${String(x ?? "").replace(/"/g, '""')}"`;
console.log("period,place,id,outlets,headline,url,ok_or_problem");
for (const { per, key, s } of pick) console.log([per, key, s.id, s.outlets, q(s.headline), q(s.sources?.[0]?.url), ""].join(","));
console.error(`${pick.length} of ${rows.length} unflagged stories sampled (${(pct * 100).toFixed(0)}% min 10)`);
