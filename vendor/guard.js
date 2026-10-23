/* Snippets editorial and legal guard-rails for machine summaries (v1.1, after the 22 Oct 2026 legal review).
   Pure functions, so they can be unit-tested offline (see ../test-guard.mjs). */

export const MAX_WORDS = 60, MAX_CHARS = 400, NGRAM = 8;

/* Wire services and exclusives: headline + link only, never a summary. */
/* v1.6 (owner decision D3, global scope): wire = a news agency's own copy, headline + link only. Global and regional agencies, not just the Indian ones.
   Tags are matched in the title ("... | Xinhua", "(dpa)"); codes that double as other words in headlines are matched by DOMAIN only: UPI (India's payments system),
   AAP (a political party), PA, MENA. */
const WIRE_TAG = /(^|[\s:(|\-–—[])(PTI|ANI|IANS|UNI|Reuters|AP|AFP|Associated Press|Agence France-Presse|Press Trust of India|Xinhua|TASS|Kyodo|Yonhap|Anadolu|dpa|ANSA|Bernama|Antara|EFE|WAM|KUNA|IRNA|Lusa|Jiji|Canadian Press|PA Media|Press Association|Agencia EFE|Deutsche Presse-Agentur)(\b|$)/;
export const WIRE_DOMAINS = [
  // global
  "reuters.com", "apnews.com", "afp.com", "upi.com", "dpa.com", "dpa-international.com",
  // South Asia
  "ptinews.com", "aninews.in", "ianslive.in", "uniindia.com", "bssnews.net", "app.com.pk",
  // East and South-East Asia
  "xinhuanet.com", "news.cn", "english.news.cn", "kyodonews.net", "jiji.com", "yna.co.kr", "yonhapnews.co.kr", "bernama.com", "antaranews.com", "pna.gov.ph", "vnanet.vn", "focustaiwan.tw", "cna.com.tw",
  // Europe
  "tass.com", "tass.ru", "ansa.it", "efe.com", "pa.media", "pamediagroup.com", "lusa.pt", "pap.pl", "ritzau.dk", "ntb.no", "tt.se", "stt.fi", "mti.hu", "ctk.cz", "tanjug.rs", "bta.bg", "belta.by",
  // Middle East and Africa
  "aa.com.tr", "wam.ae", "spa.gov.sa", "mena.org.eg", "kuna.net.kw", "irna.ir", "qna.org.qa", "petra.gov.jo", "sana.sy", "wafa.ps", "ena.et", "nampa.org", "sapa.org.za", "newsagencyofnigeria.com.ng", "ghananewsagency.org", "mapexpress.ma", "aps.dz",
  // Americas and Oceania
  "thecanadianpress.com", "cp24.com", "aap.com.au", "plenglish.com", "prensa-latina.cu", "telam.com.ar", "agenciabrasil.ebc.com.br", "efe.com.br", "notimex.gob.mx",
  // press-release distributors: the company's own words, not reporting (headline + link only)
  "prnewswire.com", "businesswire.com", "globenewswire.com", "accesswire.com", "einpresswire.com", "prweb.com"];
const isWireDomain = (host) => { host = String(host || "").toLowerCase().replace(/^www\./, ""); return WIRE_DOMAINS.some((d) => host === d || host.endsWith("." + d)); };
const EXCLUSIVE = /\b(exclusive|scoop|first on)\b/i;
export function headlineOnlyReason(story) {
  const srcs = story.sources || [];
  const outlets = new Set(srcs.map((s) => String(s.domain || s.outlet || "").toLowerCase().replace(/^www\./, "")));
  if (srcs.some((s) => EXCLUSIVE.test(s.title || ""))) return "exclusive";
  if (srcs.some((s) => WIRE_TAG.test(s.title || "") || isWireDomain(s.domain))) return "wire";
  if (outlets.size < 2) return "single-source";   // summaries must draw on several outlets
  return null;
}

/* Health and election claims (editorial guide 4 / 7.4): flagged for human review as well. Title cues only here; the ingester adds GKG theme cues
   (HEALTH_* / ELECTION themes) on top. Flagged = headline-only, no summary, no tone. */
const HEALTH_CLAIM = /\b(vaccin\w*|vaccine|cure[sd]?|treatment|therap(y|ies)|outbreak|epidemic|pandemic|virus(es)?|infection|disease|cancer|covid\w*|dengue|nipah|ebola|marburg|mpox|monkeypox|measles|polio|cholera|zika|hiv|aids|(bird|avian|swine) flu|misdiagnos\w*|diagnos(is|ed)|malaria|tuberculosis|diabetes|diet|medicine|medication|drug|dose|dosage|symptoms?|side effects?|clinical trial|health (ministry|alert|advisory|warning|officials?)|who (says|warns|declares|alert)|icmr|fda|cdc|superfood|immunity|mental health)\b/i;
const ELECTION_CLAIM = /\b(elections?|by-?elections?|polls?|poll(ing)?|exit polls?|ballot\w*|voters?|voting|votes?|evms?|vvpat|election commission|eci|manifesto|candidates?|constituency|vote counting|seat share|rigging)\b/i;
/* Crime, courts, sexual offences, corruption and named people: flag for human review. */
const SENSITIVE = /\b(murder\w*|kill(ed|ing|s)?|rape\w*|sexual|molest\w*|assault\w*|abus(e|ed|ing)|pocso|arrest\w*|detain\w*|accused|alleg\w*|police|fir\b|chargesheet\w*|court|bail|custody|convict\w*|sentenc\w*|acquit\w*|verdict|cbi|enforcement directorate|raid\w*|corrupt\w*|brib\w*|scam\w*|fraud\w*|lynch\w*|stab\w*|shot dead|kidnap\w*|abduct\w*|suicide|dowry|terror\w*|militant\w*|encounter|probe|defam\w*|minor\b|victim\w*)\b/i;
// Two or more capitalised words in a row that are not a known place/organisation phrase -> probably a person's name.
const NOT_PEOPLE = /^(The|A|An|In|On|At|Of|For|And|With|From|By|To|As|After|Before|Over|Under|New|North|South|East|West|Central|United|Supreme|High|Prime|Chief|Union|State|National|Indian|India|World|Asia|Europe|Africa|America|Kerala|Tamil|Uttar|Madhya|Andhra|Himachal|Arunachal|West|Jammu|Delhi|Mumbai|Bengaluru|Lok|Rajya|Reserve|Bank|Stock|Market|Election|Commission|Ministry|Government|Police|Court|Cup|League|Day|Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday|January|February|March|April|May|June|July|August|September|October|November|December|Middle|Latin|Southern|Northern|Eastern|Western|Great|Saudi|Arab|Arabia|Korea|Kong|Hong|Sri|Lanka|Zealand|Papua|Sierra|Leone|Costa|Rica|Puerto|Rico|Cape|Town|Buenos|Aires|Los|Angeles|San|Francisco|Las|Vegas|Washington|London|Beijing|Moscow|Kyiv|Paris|Berlin|Tokyo|Cairo|Lagos|Nairobi|Sydney|Canada|Mexico|Brazil|China|Russia|Japan|Germany|France|Britain|Australia|Kingdom|States|Nations|European|African|Asian|American|British|French|German|Chinese|Russian|Japanese|Korean|Israeli|Iranian|Ukrainian|Palestinian|Gaza|Congress|Senate|House|Parliament|Federal|Bureau|Department|Council|Security|Minister|President|Premier|Secretary|General|Foreign|Defence|Defense|Health|Trade|Finance|Energy|Court|Bundesbank|Central|Euro|Dollar|Pound|Yuan|Yen|Rupee|Peso|Oil|Gold|Wall|Street|Silicon|Valley|Pacific|Atlantic|Indian|Ocean|Sea|River|Lake|Mount|Island|Islands|Republic|Emirates|Zealand|Taiwan|Vietnam|Thailand|Indonesia|Malaysia|Singapore|Philippines|Pakistan|Bangladesh|Nepal|Turkey|Egypt|Iran|Iraq|Syria|Israel|Lebanon|Yemen|Qatar|Kuwait|Oman|Jordan|Nigeria|Kenya|Ghana|Ethiopia|Sudan|Somalia|Uganda|Tanzania|Zimbabwe|Zambia|Argentina|Chile|Colombia|Peru|Venezuela|Cuba|Haiti|Ukraine|Poland|Spain|Italy|Greece|Sweden|Norway|Denmark|Finland|Ireland|Scotland|Wales|England|Netherlands|Belgium|Switzerland|Austria|Hungary|Romania|Serbia|Croatia)$/;
export function reviewReasons(story) {
  const text = (story.sources || []).map((s) => s.title || "").join(" \n ") + " " + (story.headline || "");
  const r = [];
  if (SENSITIVE.test(text)) r.push("crime-or-court");
  if (HEALTH_CLAIM.test(text)) r.push("health-claim");
  if (ELECTION_CLAIM.test(text)) r.push("election-claim");
  // Skip Title-Case headlines (most words capitalised): capitals there say nothing about names.
  const sentenceCase = (story.sources || []).map((s) => s.title || "").filter((t) => { const w = t.split(/\s+/).filter((x) => /^[A-Za-z]/.test(x)); return w.length && w.filter((x) => /^[A-Z]/.test(x)).length / w.length < 0.6; });
  const caps = sentenceCase.join(" \n ").match(/\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)+\b/g) || [];
  if (caps.some((c) => c.split(/\s+/).filter((w) => !NOT_PEOPLE.test(w)).length >= 2)) r.push("named-person");
  return r;
}

/* Copied-wording check: any run of NGRAM (8) consecutive words shared with any input text. */
const words = (t) => String(t || "").toLowerCase().replace(/[’']/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim().split(/\s+/).filter(Boolean);
export function sharedRun(summary, inputs, n = NGRAM) {
  const grams = new Set();
  for (const inp of inputs) { const w = words(inp); for (let i = 0; i + n <= w.length; i++) grams.add(w.slice(i, i + n).join(" ")); }
  const s = words(summary);
  for (let i = 0; i + n <= s.length; i++) { const g = s.slice(i, i + n).join(" "); if (grams.has(g)) return g; }
  return null;
}
/* Longest run of consecutive words shared with any input (editorial guide 7.6 "overlapRun"; same word rules as sharedRun / overlap_check.py). Returns a number. */
export function longestRun(summary, inputs) {
  const s = words(summary); let best = 0;
  for (const inp of inputs) {
    const w = words(inp); if (!w.length || !s.length) continue;
    let prev = new Array(w.length + 1).fill(0);
    for (let i = 1; i <= s.length; i++) {
      const cur = new Array(w.length + 1).fill(0);
      for (let j = 1; j <= w.length; j++) if (s[i - 1] === w[j - 1]) { cur[j] = prev[j - 1] + 1; if (cur[j] > best) best = cur[j]; }
      prev = cur;
    }
  }
  return best;
}
export const wordCount = (t) => words(t).length;
/* Attribution wording ("X reports", "according to X", "police allege"). */
export const hasAttribution = (t) => /\b(reports?|reported|according to|says|said|cites?|allege[sd]?|claims?|quotes?)\b/i.test(t);
/* Hard cap: 60 words / 400 characters, cut at a sentence end where possible. No quotations allowed at all. */
export function capSummary(t) {
  let s = String(t || "").replace(/\s+/g, " ").replace(/^["“]|["”]$/g, "").trim();
  const w = s.split(" ");
  if (w.length > MAX_WORDS) s = w.slice(0, MAX_WORDS).join(" ");
  if (s.length > MAX_CHARS) s = s.slice(0, MAX_CHARS).replace(/\s+\S*$/, "");
  if (!/[.!?]$/.test(s)) { const cut = s.replace(/[^.!?]*$/, "").trim(); s = cut.length > 40 ? cut : s + "…"; }
  return s;
}
export const hasLongQuote = (t) => /["“][^"”]{0,400}["”]/.test(t);

/* Validate a model draft. Returns {ok, text, why}. */
export function checkDraft(draft, inputs) {
  const text = capSummary(draft);
  if (text.split(/\s+/).length < 8) return { ok: false, why: "too-short", text };
  const run = sharedRun(text, inputs); if (run) return { ok: false, why: "copied-wording", run, text };
  if (hasLongQuote(text)) return { ok: false, why: "quotation", text };
  if (!hasAttribution(text)) return { ok: false, why: "no-attribution", text };
  return { ok: true, text };
}

/* robots.txt: is `path` allowed for our user agent? Longest-match Allow/Disallow, groups for "snippetsbot" or "*". */
export function robotsAllows(robotsTxt, path, agent = "snippetsbot") {
  const groups = []; let cur = null, lastWasAgent = false;
  for (const raw of String(robotsTxt || "").split(/\r?\n/)) {
    const line = raw.replace(/#.*/, "").trim(); if (!line) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(line); if (!m) continue;
    const k = m[1].toLowerCase(), v = m[2].trim();
    if (k === "user-agent") { if (!lastWasAgent) { cur = { agents: [], rules: [] }; groups.push(cur); } cur.agents.push(v.toLowerCase()); lastWasAgent = true; continue; }
    lastWasAgent = false;
    if (cur && (k === "allow" || k === "disallow")) cur.rules.push({ allow: k === "allow", p: v });
  }
  const mine = groups.filter((g) => g.agents.some((a) => a !== "*" && agent.includes(a)));
  const use = mine.length ? mine : groups.filter((g) => g.agents.includes("*"));
  let best = null;
  for (const g of use) for (const r of g.rules) {
    if (!r.p) continue;   // "Disallow:" (empty) allows everything
    const re = new RegExp("^" + r.p.replace(/[.+?^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\\\$$/, "$"));
    if (re.test(path) && (!best || r.p.length > best.p.length || (r.p.length === best.p.length && r.allow))) best = r;
  }
  return !best || best.allow;
}
/* Page-level opt-outs in <head>: robots/googlebot-style meta with noai, noimageai, noindex, nosnippet. */
export function metaOptOut(head) {
  const re = /<meta[^>]+name=["'](?:robots|snippetsbot|ai|googlebot)["'][^>]*content=["']([^"']+)["']/gi; let m;
  while ((m = re.exec(head))) if (/\b(noai|noimageai|nosnippet|noindex|none)\b/i.test(m[1])) return m[1];
  return null;
}
