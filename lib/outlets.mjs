/* Outlet (source) country: GDELT's own published domain->country lookup (data/DOMAINSBYCOUNTRY-ALLLANGUAGES.TXT, ~33k domains, FIPS 10-4 codes).
   GKG itself carries only the source domain (SourceCommonName) and URL, no country column, so this list is the only GDELT-provided mapping.
   v1.6: NO guessing. The old ccTLD fallback is gone: a domain that is not in the list (or whose parent domain is not) has an UNKNOWN outlet country (null).
   Used for "local outlets" ("from" scope), outlet regions (scope = global/regional) and the per-source outletCountry field. Ingester-side only (too big for the Worker). */
import fs from "node:fs";
export function loadOutlets(file) {
  const m = new Map();
  try { for (const l of fs.readFileSync(file, "utf8").split("\n")) { const [d, f] = l.split("\t"); if (d && f && /^[A-Z]{2}$/.test(f)) m.set(d.toLowerCase(), f); } } catch {}
  return (domain) => {
    let d = domain;
    for (;;) { const f = m.get(d); if (f) return f; const i = d.indexOf("."); if (i < 0 || d.indexOf(".", i + 1) < 0) break; d = d.slice(i + 1); }   // news.foo.co.uk -> foo.co.uk
    return null;
  };
}
