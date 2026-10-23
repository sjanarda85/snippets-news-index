// Offline tests for the v1.6 global-scope ingest: outlet country (unknown stays unknown), region/country/scope, language tiers,
// the editorial score, country/region caps, rg- shards, UTC/ISO fields. No network. Run: node test-global.mjs   (needs no build/)
import path from "node:path";
import { fileURLToPath } from "node:url";
import { loadPlaces } from "./lib/places.mjs";
import { loadGeo, geoOf, headlineCountries, topicWeight, REGION_IDS, MULTI, SCOPE_WEIGHT } from "./lib/geo.mjs";
import { loadOutlets } from "./lib/outlets.mjs";
import { langTier, POLICY } from "./lib/policy.mjs";
import { parseGkg } from "./lib/gdelt.mjs";
import { storiesFromArticles, apiStory, rankShards, keysOf, score, outletIso } from "./lib/build.mjs";
import { diversityReport, CAPS, isExceptional } from "./vendor/diversity.js";
const must = (c, m) => { if (!c) { console.error("FAIL", m); process.exit(1); } console.log("ok  ", m); };
const HERE = path.dirname(fileURLToPath(import.meta.url));
const P = loadPlaces(path.join(HERE, "geo")), G = loadGeo(P, path.join(HERE, "geo"));
const outletCountry = loadOutlets(path.join(HERE, "data/DOMAINSBYCOUNTRY-ALLLANGUAGES.TXT"));
const ctx = { P, G, outletCountry };
const T = Date.parse("2026-10-23T05:00:00Z");

// 15. outlet country: only from GDELT's domain list; unknown is null, never a ccTLD guess
must(outletCountry("bbc.co.uk") === "UK" || outletCountry("bbc.co.uk") === "GB" || !!outletCountry("bbc.co.uk"), "known outlet resolves through GDELT's domain list: " + outletCountry("bbc.co.uk"));
must(outletCountry("totally-unlisted-news-site.example.in") === null && outletCountry("some-blog.example.ke") === null, "unlisted domain -> null (no ccTLD guessing, even for .in / .ke)");
must(outletIso(null, ctx) === "unknown" && outletIso("ZZ", ctx) === "unknown", "outletIso: unknown stays 'unknown'");
must(G.regionOfIso("KE") === "africa" && G.regionOfIso("IN") === "asia" && G.regionOfIso("EG") === "middle-east" && G.regionOfIso("US") === "north-america" && G.regionOfIso("MX") === "latin-america" && G.regionOfIso("AU") === "oceania" && G.regionOfIso("DE") === "europe", "7 regions: ISO -> region mapping");
must(REGION_IDS.length === 7 && MULTI === "multi-region", "7 regions plus multi-region");
must(JSON.stringify(headlineCountries(G, "Floods hit Kenya and Tanzania as Chad closes border", new Set())) === JSON.stringify(["KE", "TZ"]), "headline countries in order; ambiguous 'Chad' needs GKG confirmation");
must(headlineCountries(G, "Jordan scores late as Georgia win", new Set()).length === 0, "'Jordan', 'Georgia' not guessed as countries without GKG");
must(headlineCountries(G, "us open starts", new Set()).length === 0 && headlineCountries(G, "US sanctions Iran", new Set()).join() === "US,IR", "'US' only counts when written in capitals");

// stories + geo + scope
const art = (d, t, o = {}) => ({ u: `https://${d}/${Math.abs([...t].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7))}`, d, t, ts: T, tn: -2, wc: 400, tg: [], pl: [], pt: [], oc: "", ...o });
const mk = (title, domains, o = {}) => storiesFromArticles(domains.map((d) => art(d, title, o)), ctx)[0];
const okDomains = ["bbc.co.uk", "nytimes.com", "theguardian.com", "aljazeera.com", "straitstimes.com", "news24.com"];
const s1 = mk("Kenya and Tanzania agree new border trade rules", okDomains);
const g1 = geoOf(s1, ctx);
must(g1.countries.includes("KE") && g1.countries.includes("TZ") && g1.region === "africa" && g1.primaryCountry === "KE", "headline-named countries -> region africa, primaryCountry first named");
must(["regional", "global"].includes(g1.scope) && SCOPE_WEIGHT[g1.scope] >= 0.85, "two countries in one region -> regional (or global if outlets span 3+ regions)");
const s2 = mk("Quiet news day with nothing from anywhere in particular", okDomains.slice(0, 2));
const g2 = geoOf(s2, ctx);
must(g2.region === "" && g2.countries.length === 0 && g2.primaryCountry === "", "no place, few outlet regions -> region unknown ('' ), not guessed");
const s3 = mk("Kenya election officials publish final voter roll", ["standardmedia.co.ke", "nation.africa", "bbc.co.uk"]);
must(apiStory(s3, T, "24h", null, ctx).region === "africa" && apiStory(s3, T, "24h", null, ctx).primaryCountry === "KE", "apiStory exposes region + primaryCountry");
const api = apiStory(s1, T, "24h", null, ctx, { score: score(s1, T, "24h", null, ctx), weight: 1 });
must(Array.isArray(api.countries) && typeof api.score === "number" && typeof api.weight === "number" && api.sources.every((x) => /^([A-Z]{2}|unknown)$/.test(x.outletCountry)), "apiStory: countries[], score, weight, per-source outletCountry (ISO2 or 'unknown')");
must([...keysOf(s3, ctx)].includes("rg-africa"), "keysOf adds the rg-<region> shard key");
must(topicWeight({ tg: ["business"] }) === 1 && topicWeight({ tg: ["entertainment"] }) === 0.4 && topicWeight({ tg: ["science"] }) === 0.75 && topicWeight({ tg: ["business"], rr: ["health-claim"] }) <= 0.5, "topic tiers T1 1.0 / T2 0.75 / T3 0.4; flagged stories get no boost");

// 16. language
must(langTier("eng") === "L1" && langTier("") === "L1" && langTier("fra") === "L3" && langTier("hin") === "L3", "language tiers: English L1; others L3 until L2 languages are listed");
must(POLICY.TRANSLATION_FILES === false && POLICY.LANG_L2.length === 0, "translation-file ingest and L2 headline-only languages are OFF by default (English-only protected-content/guilt filters)");
const row = (tr) => { const c = new Array(27).fill(""); c[0] = "20261023050000-1"; c[1] = "20261023050000"; c[3] = "x.com"; c[4] = "https://x.com/a"; c[7] = "WB_1;"; c[15] = "0.5,1,1,1,1,1,400"; c[25] = tr; c[26] = "<PAGE_TITLE>Titre de la page</PAGE_TITLE>"; return c.join("\t") + "\n"; };
const ptr = [...parseGkg(row("srclc:fra;eng:GT-FRA 1.0"), "20261023050000")], pen = [...parseGkg(row(""), "20261023050000")];
must(ptr.length === 1 && ptr[0].tr === true && ptr[0].lang === "fra" && pen[0].tr === false && pen[0].lang === "eng", "parseGkg: translated rows carry tr + source language (ISO 639-3, lowercase); English rows are eng");
const sfr = storiesFromArticles([1, 2, 3].map((i) => art(okDomains[i] , "Le gouvernement annonce une nouvelle reforme du travail en France", { lg: "fra", tr: true })), ctx)[0];
const afr = apiStory(sfr, T, "24h", null, ctx);
must(afr.lang === "fr" && afr.languageTier === "L3" && afr.headlineOnly === "language" && afr.translated === true, "non-English story: lang fr, tier L3, headlineOnly=language, translated flag");

// editorial score = 40C + 25R + 25W + 10D
const sc = score(s1, T, "24h", null, ctx);
must(sc > 0 && sc <= 100, "score within 0-100: " + sc.toFixed(1));
const many = mk("Global summit on climate finance ends with new pledge", [...okDomains, "lemonde.fr", "spiegel.de", "smh.com.au", "thehindu.com", "folha.uol.com.br"]);
const few = mk("Local council debates parking rules in a small town", ["standardmedia.co.ke", "nation.africa"]);
must(score(many, T, "24h", null, ctx) > score(few, T, "24h", null, ctx), "more outlets across more regions outrank a thin local story");

// caps: build a pool where one country dominates; rankShards must keep it under the country cap
const pool = [];
for (let i = 0; i < 80; i++) pool.push(mk(`Washington lawmakers debate bill number ${i} about federal spending`, ["nytimes.com", "washingtonpost.com", "cnn.com", "foxnews.com", "usatoday.com"].slice(0, 5), { pl: ["about-US"] }));
const regs = [["Kenya", "KE", ["standardmedia.co.ke", "nation.africa", "bbc.co.uk"]], ["Japan", "JP", ["japantimes.co.jp", "nikkei.com", "straitstimes.com"]], ["Brazil", "BR", ["folha.uol.com.br", "globo.com", "bbc.co.uk"]], ["France", "FR", ["lemonde.fr", "france24.com", "bbc.co.uk"]], ["Australia", "AU", ["smh.com.au", "abc.net.au", "bbc.co.uk"]], ["Egypt", "EG", ["ahram.org.eg", "aljazeera.com", "bbc.co.uk"]]];
for (const [n, iso, ds] of regs) for (let i = 0; i < 3; i++) pool.push(mk(`${n} parliament passes measure ${i} on water supply`, ds, { pl: ["about-" + iso] }));
pool.forEach((s, i) => { s.ts = T - i * 60000; s.lt = T - i * 60000; });
const shards = rankShards(pool, ctx, "24h", T, { topN: 30 });
const world = shards.get("world|all") || shards.get("world");
must(world && world.length >= 20, "rankShards yields a world list: " + (world && world.length));
const stories = world.map((s) => apiStory(s, T, "24h", null, ctx, world.scores && world.scores.get(s)));
const dr = diversityReport(stories.slice(0, CAPS.topN));
must(dr.maxCountry.count <= 15 && dr.countryCapOk && dr.countryShare.length >= 7, "country cap holds even when 80 US stories compete: max " + JSON.stringify(dr.maxCountry) + ", " + dr.countryShare.length + " countries present");
must(world.diversity && world.diversity.skippedForCountry > 0, "the cap reports what it skipped (diversity.skippedForCountry=" + (world.diversity && world.diversity.skippedForCountry) + ")");
must(stories.slice(0, 20).filter((s) => s.region === "north-america").length <= Math.floor(0.35 * 20) + 1, "region cap: North America <= 35% of the top 20");
must(isExceptional({ outlets: 10, outletRegionN: 3 }) && !isExceptional({ outlets: 9, outletRegionN: 3 }) && !isExceptional({ outlets: 12, outletRegionN: 2 }), "exceptional = >=10 outlets in >=3 regions");
const regionShard = [...shards.keys()].find((k) => /^rg-/.test(k.split("|")[0]));
must(!!regionShard, "region shard keys (rg-*) are produced: " + regionShard);
console.log("\nALL INGEST GLOBAL TESTS PASSED");
