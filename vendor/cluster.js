// COPY of site/assets/js/cluster.js - keep in sync.
/* Snippets: story grouping + light auto-tagging. Shared by the site and the worker
   (worker/src/cluster.js is a copy of this file; keep them in sync).
   Groups articles about the same story by headline similarity. No article text is used. */

const STOP = new Set(("a an the and or but of to in on at for from by with as is are was were be been has have had " +
  "it its this that these those after before over under into amid about than then new says say said will would can could " +
  "may might not no yes up down out more most how why what when who where which live updates update video watch news " +
  "report reports latest today day week year top first last two three us vs via his her their our your they he she we i you").split(" "));

export function normTitle(t) {
  return String(t || "")
    .replace(/\s+[-|–—]\s+[^-|–—]{2,60}$/u, "")      // drop trailing " - Outlet name"
    .toLowerCase()
    .normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[“”‘’"'`]/g, "")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ").trim();
}
export function tokens(t) {
  const out = new Set();
  for (const w of normTitle(t).split(" ")) {
    if (w.length < 3 && !/^\d+$/.test(w)) continue;
    if (STOP.has(w)) continue;
    out.add(w.length > 5 ? w.replace(/(ing|ers|ies|es|s|ed)$/u, "") : w);   // crude stemming
  }
  return out;
}
function sim(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const x of a) if (b.has(x)) inter++;
  const jacc = inter / (a.size + b.size - inter);
  const contain = inter / Math.min(a.size, b.size);
  return Math.max(jacc, inter >= 3 ? contain * 0.8 : 0);
}

/** articles: [{title, url, outlet, domain, publishedAt(ISO), lang, country}] -> clusters */
export function clusterArticles(articles, threshold = 0.42) {
  const seenUrl = new Set();
  const clusters = [];
  for (const a of articles) {
    if (!a || !a.title || !a.url || seenUrl.has(a.url)) continue;
    seenUrl.add(a.url);
    const tk = tokens(a.title);
    let best = null, bestS = 0;
    for (const c of clusters) {
      const s = sim(tk, c.tokens);
      if (s > bestS) { bestS = s; best = c; }
    }
    if (best && bestS >= threshold) {
      best.items.push(a);
      for (const x of tk) best.tokens.add(x);
    } else {
      clusters.push({ tokens: new Set(tk), items: [a] });
    }
  }
  return clusters.map((c) => {
    // one entry per outlet; lead = earliest English-ish headline from the biggest outlet set
    const byOutlet = new Map();
    for (const it of c.items) if (!byOutlet.has(it.domain || it.outlet)) byOutlet.set(it.domain || it.outlet, it);
    const sources = [...byOutlet.values()].sort((x, y) => (y.publishedAt || "").localeCompare(x.publishedAt || ""));
    const lead = [...sources].sort((x, y) => scoreTitle(y.title) - scoreTitle(x.title))[0];
    const times = sources.map((s) => s.publishedAt).filter(Boolean).sort();
    return {
      id: hash(normTitle(lead.title)),
      headline: cleanHeadline(lead.title, lead.domain || lead.outlet),
      sources,
      firstSeen: times[0] || null,
      updatedAt: times[times.length - 1] || null,
      category: categorise(c.items.map((i) => i.title).join(" ")),
    };
  }).sort((a, b) => (b.sources.length - a.sources.length) || (b.updatedAt || "").localeCompare(a.updatedAt || ""));
}
function scoreTitle(t) { const n = normTitle(t).split(" ").length; return (n >= 6 && n <= 16 ? 10 : 0) - Math.abs(11 - n) * 0.3; }
/* Headline cleaning (editorial guide 7.3): strips site-name junk only, never rewords. "A | 100.7 MIX-FM | Today's Hit Music" -> "A"; "A - The Indian Awaaz" -> "A".
   Pipe segments are always separators; a trailing " - X" is removed only when X looks like an outlet name (matches the outlet's domain, has a site word, or is a short capitalised name),
   so "A - 'I want it to work out'" keeps its quote. `domain` (optional) makes the outlet match exact. */
const SITE_WORDS = /\b(news|times|post|herald|tribune|express|hindu|mirror|daily|today|live|tv|fm|radio|network|channel|online|media|journal|chronicle|gazette|telegraph|standard|digest|wire|press|world|india|indian|mix|official|portal|magazine|bulletin|observer|monitor|insider|desk|awaaz|samachar|khabar|sun|star|globe|guardian|review|mail|reporter|courier|bureau|agency|netw?ork|sentinel|bazaar|today)\b/i;
const alnum = (x) => String(x || "").toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "");
function siteLike(seg, domain, restWords) {
  const words = seg.trim().split(/\s+/).filter(Boolean);
  if (!words.length || words.length > 6 || /[.?!:;"“”'‘’]$|^["“'‘]/.test(seg.trim()) || /["“”]/.test(seg)) return false;
  const a = alnum(seg), d = alnum(String(domain || "").replace(/^www\./, "").split(".").slice(0, -1).filter((x) => !/^(co|com|org|net|gov|ac)$/.test(x)).pop());
  if (d && a.length >= 4 && d.length >= 4 && (d.includes(a) || a.includes(d))) return true;
  if (SITE_WORDS.test(seg)) return true;
  return words.length <= 3 && restWords >= 5 && words.every((w) => /^([A-Z][\p{L}0-9'’.&-]*|[0-9][0-9.]*|of|the|and|&)$/u.test(w));
}
export function cleanHeadline(t, domain) {
  let s = String(t || "").replace(/\s+/g, " ").trim();
  const parts = s.split(/\s+\|\s+/);
  if (parts.length > 1 && parts[0].split(/\s+/).length >= 3) s = parts[0].trim();
  for (let i = 0; i < 2; i++) {   // up to two trailing " - Outlet" tails ("A - Section - Outlet")
    const m = /^(.{12,}?)\s+[-–—]\s+([^-–—]{2,60})$/u.exec(s);
    if (!m || !siteLike(m[2], domain, m[1].split(/\s+/).length)) break;
    s = m[1].trim();
  }
  return s;
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return "s" + (h >>> 0).toString(36); }

const CATS = [
  ["Climate", /\b(climate|heatwave|heat wave|flood|cyclone|monsoon|rain|rains|rainfall|drought|wildfire|emission|carbon|cop\d+|glacier|landslide|earthquake|weather|pollution|air quality)\b/i],
  ["Politics", /\b(election|elections|minister|parliament|assembly|congress|senate|president|prime minister|bjp|cpi|udf|ldf|party|vote|poll|governor|government|cabinet|mla|mp|policy|court|supreme court|high court|bill|law)\b/i],
  ["Business", /\b(market|markets|stock|stocks|sensex|nifty|economy|economic|gdp|inflation|rbi|bank|shares|ipo|trade|tariff|budget|revenue|profit|startup|investment|rupee|dollar|oil price|company)\b/i],
  ["Tech", /\b(ai|artificial intelligence|tech|technology|software|smartphone|app|apple|google|microsoft|openai|chip|semiconductor|cyber|startup|isro|space|satellite|rocket|launch)\b/i],
  ["Sport", /\b(cricket|football|match|tournament|league|olympic|world cup|ipl|isl|fifa|tennis|hockey|score|wins|beat|vs|test series|t20|odi|goal)\b/i],
  ["Health", /\b(health|hospital|disease|virus|outbreak|vaccine|covid|nipah|dengue|cancer|medical|doctor|who|patients|mental health)\b/i],
  ["World", /\b(war|ceasefire|un|united nations|nato|summit|diplomat|border|military|attack|strike|missile|refugee|sanction)\b/i],
];
export function categorise(text) {
  for (const [name, re] of CATS) if (re.test(text)) return name;
  return "General";
}
