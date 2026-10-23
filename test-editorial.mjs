// Offline tests for the v1.5 ingest changes: headline cleaning, health/election flags from GKG themes, flagged-story handling, single blocklist.json. Run: node test-editorial.mjs
import fs from "node:fs";
import { storiesFromArticles, apiStory } from "./lib/build.mjs";
import { cleanHeadline } from "./vendor/cluster.js";
import { compileBlocklist, articleBlocked, matchesBlocklist, urlHash } from "./vendor/blocklist-core.js";
const must = (c, m) => { if (!c) { console.error("FAIL", m); process.exit(1); } console.log("ok  ", m); };
const T = Date.parse("2026-10-23T05:00:00Z");
const art = (d, t, tg = [], o = {}) => ({ u: `https://${d}/${Math.abs([...t].reduce((a, c) => (a * 31 + c.charCodeAt(0)) | 0, 7))}`, d, t, ts: T, tn: -2, wc: 400, tg, pl: ["world"], pt: [], oc: "", ...o });
const one = (arts) => storiesFromArticles(arts, {})[0];

must(cleanHeadline("Earthquake hits Tibet | 100.7 MIX-FM | Today's Hit Music", "mix1007.com") === "Earthquake hits Tibet", "cleanHeadline strips '| site | tagline'");
must(cleanHeadline("A - 'I want it to work out'", "x.com") === "A - 'I want it to work out'", "cleanHeadline keeps a quote after ' - '");
const h = one([art("a.com", "Hospitals brace for flu surge across the state | Daily Dose News", ["health"]), art("b.com", "Hospitals brace for flu surge across the state", ["health"]), art("c.com", "Hospitals brace for flu surge across state", ["health"])]);
must(h.rr.includes("health-claim") && h.h === "Hospitals brace for flu surge across the state" && h.hr, "GKG health theme -> health-claim flag; headline cleaned; raw kept (hr)");
const hs = apiStory(h, T + 3600000, "24h", null);
must(hs.needsReview && hs.reviewReasons.includes("health-claim") && hs.tone === undefined && hs.headlineRaw.includes("Daily Dose"), "flagged story: needsReview, no tone, headlineRaw in the API shape");
const e = one([art("a.com", "Parties file nominations for the state assembly polls", ["election"]), art("b.com", "Parties file nominations for the state assembly polls", ["election"]), art("c.com", "Parties file nominations for state assembly polls", ["election"])]);
must(e.rr.includes("election-claim"), "GKG election theme -> election-claim flag");
const n = one([art("a.com", "Monsoon rains lash the coast as rivers rise", ["weather"]), art("b.com", "Monsoon rains lash the coast as rivers rise", ["weather"]), art("c.com", "Monsoon rains lash coast as rivers rise", ["weather"])]);
must(!n.rr.length && !n.hr && apiStory(n, T, "24h", null).tone !== undefined && !("headlineRaw" in apiStory(n, T, "24h", null)), "ordinary story: no flags, tone kept, no headlineRaw when nothing was cleaned");
const j = JSON.parse(fs.readFileSync("blocklist.json", "utf8"));
must(compileBlocklist(j).problems.length === 0 && !fs.existsSync("blocklist.txt"), "blocklist.json is valid; the old blocklist.txt is gone (one file)");
const BL = compileBlocklist({ entries: [{ type: "url", value: urlHash("https://a.com/x") }, { type: "domain", value: "bad.example" }, { type: "term", value: "forbidden phrase" }] });
must(articleBlocked({ u: "https://www.a.com/x?utm=1", d: "a.com", t: "t" }, BL) && articleBlocked({ u: "https://s.bad.example/1", d: "s.bad.example", t: "t" }, BL) && articleBlocked({ u: "https://q.com/1", d: "q.com", t: "A forbidden phrase appears" }, BL) && !articleBlocked({ u: "https://q.com/2", d: "q.com", t: "Fine" }, BL), "ingest drops blocked articles (url hash, domain, term) before clustering");
must(matchesBlocklist({ id: "s", headline: "x", sources: [{ url: "https://a.com/x", domain: "a.com" }] }, BL), "story-level check shares the same code as the Worker");
console.log("\nALL INGEST EDITORIAL TESTS PASSED");
