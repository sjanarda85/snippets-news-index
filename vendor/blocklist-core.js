/* Single blocklist (editorial guide 7.9). SOURCE OF TRUTH: ingest/blocklist.json (public repo, so it holds HASHES, never URLs, and no complaint detail).
   This file is shared by the ingester (ingest/vendor/blocklist-core.js is a copy, synced by ingest/sync-vendor.sh) and the Worker.
   blocklist.json = { "schema": "snippets.blocklist.v1", "entries": [ { "type": "url"|"story"|"domain"|"term", "value": "<sha256 of the normalised URL | story id | domain | phrase>",
                      "addedAt": "<ISO, IST ok>", "addedBy": "<role>", "approvedBy": "<role>", "reason": "<code only: LEGAL|SAFETY|LICENCE|QUALITY|SPAM or HIDE>" } ] }
   Privacy: never write a URL, headline or the real reason for a hide into this file (it is public). Details go to the private log (SOP 04).
   Effects: url hash -> any story with a source URL whose hash matches is removed; story -> that id is removed; domain -> outlet dropped (and sub-domains);
   term -> any story whose headline or source titles contain the phrase (whole words, case-insensitive) is removed. */
export const normUrl = (u) => String(u || "").trim().toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/[?#].*$/, "").replace(/\/+$/, "");

/* Synchronous SHA-256 (the Worker's crypto.subtle is async and the filter runs inside a sync loop). ~100 lines of well-known algorithm; verified against node:crypto in tests. */
const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
export function sha256Hex(str) {
  const msg = new TextEncoder().encode(String(str)), l = msg.length, n = (((l + 9 + 63) >> 6) << 6), buf = new Uint8Array(n);
  buf.set(msg); buf[l] = 0x80;
  const dv = new DataView(buf.buffer); dv.setUint32(n - 8, Math.floor((l * 8) / 4294967296)); dv.setUint32(n - 4, (l * 8) >>> 0);
  const H = new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]), w = new Uint32Array(64);
  const rotr = (x, k) => (x >>> k) | (x << (32 - k));
  for (let o = 0; o < n; o += 64) {
    for (let i = 0; i < 16; i++) w[i] = dv.getUint32(o + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i - 15], b = w[i - 2]; w[i] = (w[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + w[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0; }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0, t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  return [...H].map((x) => x.toString(16).padStart(8, "0")).join("");
}
export const urlHash = (u) => sha256Hex(normUrl(u));

const normDomain = (d) => String(d || "").trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").replace(/\/.*$/, "");
const normTerm = (t) => " " + String(t || "").toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, " ").trim() + " ";
const TYPES = new Set(["url", "story", "domain", "term"]);

/** json (blocklist.json shape; may be null) + extra entries (e.g. the Worker's runtime hides from KV) -> matcher.  Invalid entries are skipped and listed in `problems`. */
export function compileBlocklist(json, extra = []) {
  const entries = [...((json && json.entries) || []), ...extra], problems = [];
  const bl = { urls: new Set(), ids: new Set(), domains: [], terms: [], problems, count: 0, version: "0", added: entries.map((e) => e && e.addedAt).filter(Boolean) };
  for (const e of entries) {
    if (!e || !TYPES.has(e.type) || !e.value) { problems.push("bad entry " + JSON.stringify(e)); continue; }
    if (e.type === "url") { if (!/^[0-9a-f]{64}$/.test(e.value)) { problems.push("url entries must be a SHA-256 hash, not a URL"); continue; } bl.urls.add(e.value); }
    else if (e.type === "story") bl.ids.add(String(e.value));
    else if (e.type === "domain") bl.domains.push(normDomain(e.value));
    else if (e.type === "term") { const t = normTerm(e.value); if (t.trim().length >= 3) bl.terms.push(t); else problems.push("term too short"); }
    bl.count++;
  }
  let h = 5381; for (const x of [...bl.urls, "|", ...bl.ids, "|", ...bl.domains, "|", ...bl.terms].sort().join("\n")) h = ((h * 33) ^ x.charCodeAt(0)) >>> 0;   // short change-detector for the cache key
  bl.version = bl.count ? h.toString(36) : "0";
  return bl;
}
const domainBlocked = (d, list) => { d = normDomain(d); return !!d && list.some((b) => d === b || d.endsWith("." + b)); };
/** story in feed shape ({id, headline, sources:[{url, domain|outlet, title}]}) -> true when it must be removed */
export function matchesBlocklist(s, bl) {
  if (!bl || !bl.count) return false;
  if (bl.ids.has(s.id)) return true;
  const srcs = s.sources || [];
  if (bl.urls.size && srcs.some((x) => bl.urls.has(urlHash(x.url)))) return true;
  if (bl.domains.length && srcs.length && srcs.every((x) => domainBlocked(x.domain || x.outlet, bl.domains))) return true;   // every outlet blocked -> the story goes; mixed stories keep their other sources (see stripBlockedDomains)
  if (bl.terms.length) { const t = normTerm((s.headline || "") + " " + srcs.map((x) => x.title || "").join(" ")); if (bl.terms.some((x) => t.includes(x))) return true; }
  return false;
}
/** removes sources from blocked domains (the outlet opt-out path) */
export const stripBlockedDomains = (sources, bl) => (bl && bl.domains.length ? (sources || []).filter((x) => !domainBlocked(x.domain || x.outlet, bl.domains)) : sources);
export const isBlockedDomain = (d, bl) => !!bl && domainBlocked(d, bl.domains);
/** ingest-side check on a raw article ({u,d,t}) */
export function articleBlocked(a, bl) {
  if (!bl || !bl.count) return false;
  if (bl.urls.size && bl.urls.has(urlHash(a.u))) return true;
  if (bl.domains.length && domainBlocked(a.d, bl.domains)) return true;
  if (bl.terms.length && bl.terms.some((x) => normTerm(a.t).includes(x))) return true;
  return false;
}
/** a ready-made entry for the hide-first path (what to paste into blocklist.json, and the private log line) */
export function hideEntry(urlOrId, { reason = "HIDE", addedBy = "editor", approvedBy = "", now = new Date() } = {}) {
  const v = String(urlOrId || "").trim();
  const isUrl = /^https?:\/\//i.test(v) || /^[\w.-]+\.[a-z]{2,}\/\S+/i.test(v);
  const type = isUrl ? "url" : "story", value = isUrl ? urlHash(v) : v.replace(/^id:/, "");
  return { type, value, addedAt: now.toISOString(), addedBy, approvedBy, reason: /^[A-Z]{3,8}$/.test(reason) ? reason : "HIDE" };
}
