/* outlet (source) country: GDELT's own domain->country lookup (data/DOMAINSBYCOUNTRY-ALLLANGUAGES.TXT, ~33k domains, FIPS) + ccTLD fallback.
   Used for "local outlets" (sourcecountry:) semantics of the site's default "from" scope. Ingester-side only (too big for the Worker). */
import fs from "node:fs";
const CC = { in: "IN", uk: "UK", au: "AS", nz: "NZ", ca: "CA", ie: "EI", za: "SF", ng: "NI", ke: "KE", pk: "PK", bd: "BG", lk: "CE", np: "NP", sg: "SN", my: "MY", ph: "RP", id: "ID", ae: "AE", sa: "SA",
  de: "GM", fr: "FR", it: "IT", es: "SP", nl: "NL", jp: "JA", cn: "CH", us: "US", gh: "GH", ug: "UG", zm: "ZA", zw: "ZI", tz: "TZ", hk: "HK" };
export function loadOutlets(file) {
  const m = new Map();
  try { for (const l of fs.readFileSync(file, "utf8").split("\n")) { const [d, f] = l.split("\t"); if (d && f && /^[A-Z]{2}$/.test(f)) m.set(d.toLowerCase(), f); } } catch {}
  return (domain) => {
    let d = domain;
    for (;;) { const f = m.get(d); if (f) return f; const i = d.indexOf("."); if (i < 0 || d.indexOf(".", i + 1) < 0) break; d = d.slice(i + 1); }   // news.foo.co.uk -> foo.co.uk
    const tld = domain.slice(domain.lastIndexOf(".") + 1);
    return CC[tld] || null;
  };
}
