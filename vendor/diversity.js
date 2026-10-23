/* Region / country diversity rules and metrics (editorial guide section 3, ask 19). ONE module shared by the ingest build (ingest/vendor copy) and the Worker
   (stats + spot-check endpoints), so the check that is reported is the rule that was applied. Pure functions; works on API-shaped stories
   ({ region, primaryCountry, countries, outlets, outletRegions, lang, languageTier, headlineOnly, id }). */
export const CAPS = {
  topN: 50, countryShare: 0.30,      // no single country > 30% of the top 50 ...
  regionTopN: 20, regionShare: 0.35, // ... no single region > 35% of the top 20 ...
  minRegions: 5,                     // ... at least 5 of the 7 regions in the top 20 when enough stories qualify
  exceptionOutlets: 10, exceptionRegions: 3, exceptionMax: 3,   // exceptional story: >= 10 outlets in >= 3 regions (at most 3 per top 50)
};
export const REGIONS = ["africa", "asia", "europe", "middle-east", "north-america", "latin-america", "oceania"];
export const MULTI = "multi-region";
export const countryCapMax = (n = CAPS.topN) => Math.max(1, Math.floor(CAPS.countryShare * n));
export const regionCapMax = (n = CAPS.regionTopN) => Math.max(1, Math.floor(CAPS.regionShare * n));
export const outletRegionCount = (s) => (Array.isArray(s.outletRegions) ? s.outletRegions.length : Number(s.outletRegionN) || 0);
export const isExceptional = (s) => (s.outlets || s.n || 0) >= CAPS.exceptionOutlets && outletRegionCount(s) >= CAPS.exceptionRegions;

const share = (m, n) => [...m].sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0]))).map(([k, c]) => ({ key: k, count: c, share: n ? +(c / n).toFixed(3) : 0 }));
/** metrics for a ranked list (the neutral view: no boost applied). Reports shares and whether every cap holds. */
export function diversityReport(stories, { topN = CAPS.topN, regionN = CAPS.regionTopN } = {}) {
  const top = stories.slice(0, topN), top20 = stories.slice(0, regionN), n = top.length, n20 = top20.length;
  const cc = new Map(), rc = new Map(), lc = new Map(); let unknownCountry = 0, unknownRegion = 0;
  for (const s of top) {
    if (s.primaryCountry) cc.set(s.primaryCountry, (cc.get(s.primaryCountry) || 0) + 1); else unknownCountry++;
    const l = s.lang || "en"; lc.set(l, (lc.get(l) || 0) + 1);
  }
  for (const s of top20) { if (s.region) rc.set(s.region, (rc.get(s.region) || 0) + 1); else unknownRegion++; }
  const capMax = countryCapMax(topN), exceptional = top.filter(isExceptional).map((s) => s.id);
  const over = [...cc].filter(([, c]) => c > capMax).map(([k, c]) => ({ country: k, count: c, over: c - capMax }));
  const overExceptional = over.every((o) => top.filter((s) => s.primaryCountry === o.country && isExceptional(s)).length >= o.over);
  const regionsPresent = REGIONS.filter((r) => rc.has(r)), rMax = regionCapMax(regionN);
  const regionOver = [...rc].filter(([k, c]) => REGIONS.includes(k) && c > rMax).map(([k, c]) => ({ region: k, count: c }));
  return {
    topN: n, regionTopN: n20, countryCapMax: capMax, regionCapMax: rMax,
    countryShare: share(cc, n), maxCountry: share(cc, n)[0] || null, unknownCountry,
    countryCapOk: over.length === 0 || (overExceptional && exceptional.length <= CAPS.exceptionMax),
    countriesOverCap: over, exceptionalStories: exceptional.slice(0, CAPS.exceptionMax),
    regionShareTop20: share(rc, n20), regionsPresentTop20: regionsPresent.length, regionCapOk: regionOver.length === 0, regionsOverCap: regionOver, unknownRegionTop20: unknownRegion,
    regionsTarget: CAPS.minRegions, regionCountOk: regionsPresent.length >= CAPS.minRegions,
    languageMix: share(lc, n), headlineOnlyLanguage: top.filter((s) => s.headlineOnly === "language").length,
  };
}
