/* Story clustering for millions of headlines: same normalisation/tokens/similarity as worker/src/cluster.js (so ids and grouping match the
   site), but with an inverted index so 100k+ articles cluster in seconds instead of O(n^2). */
import { normTitle, tokens, cleanHeadline } from "../vendor/cluster.js";
export { normTitle, tokens, cleanHeadline };

function sim(a, b) {
  if (!a.size || !b.size) return 0;
  let inter = 0; for (const x of a) if (b.has(x)) inter++;
  const jacc = inter / (a.size + b.size - inter), contain = inter / Math.min(a.size, b.size);
  return Math.max(jacc, inter >= 3 ? contain * 0.8 : 0);
}
export function storyId(title) { const s = normTitle(title); let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return "s" + (h >>> 0).toString(36); }
export function scoreTitle(t) { const n = normTitle(t).split(" ").length; return (n >= 6 && n <= 16 ? 10 : 0) - Math.abs(11 - n) * 0.3; }

/** items: [{tokens:Set, ts:number(ms), ...}] in any order (sorted internally by ts). Returns [{items:[...]}]
    Anti-drift: a headline is compared with the cluster's CORE tokens (words shared by >=30% of its members, max 24), not with every word ever
    seen in it; otherwise big clusters grow a 40-word bag that swallows any headline sharing three common words (measured: mega-clusters). */
export function clusterItems(items, { threshold = 0.42, maxGapMs = 40 * 3600000, rareDf = 400 } = {}) {
  const sorted = items.slice().sort((a, b) => a.ts - b.ts);
  const clusters = [], index = new Map();   // token -> [cluster idx]
  const recore = (c) => {
    const min = c.items.length < 3 ? 1 : Math.ceil(c.items.length * 0.3);
    const core = [...c.cnt].filter(([, n]) => n >= min).sort((a, b) => b[1] - a[1]).slice(0, 24);
    c.core = new Set(core.map(([t]) => t));
  };
  for (const it of sorted) {
    const tk = it.tokens, cnt = new Map();
    for (const t of tk) { const l = index.get(t); if (l && l.length <= rareDf) for (const ci of l) cnt.set(ci, (cnt.get(ci) || 0) + 1); }
    let best = -1, bestS = 0;
    for (const [ci, n] of cnt) {
      if (n < 2 && tk.size > 3) continue;           // one shared word is never enough
      const c = clusters[ci];
      if (it.ts - c.last > maxGapMs) continue;     // an old story is not extended by a headline a day and a half later
      const s = sim(tk, c.core);
      if (s > bestS) { bestS = s; best = ci; }
    }
    if (best >= 0 && bestS >= threshold) {
      const c = clusters[best]; c.items.push(it); c.last = Math.max(c.last, it.ts);
      for (const t of tk) { c.cnt.set(t, (c.cnt.get(t) || 0) + 1); if (!c.idx.has(t)) { c.idx.add(t); (index.get(t) || index.set(t, []).get(t)).push(best); } }
      recore(c);
    } else {
      const ci = clusters.length, c = { items: [it], cnt: new Map([...tk].map((t) => [t, 1])), idx: new Set(tk), last: it.ts, core: new Set(tk) };
      clusters.push(c);
      for (const t of tk) (index.get(t) || index.set(t, []).get(t)).push(ci);
    }
  }
  return clusters;
}
