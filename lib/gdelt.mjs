/* GDELT 2.1 GKG access: file names, download (with fallback host), single-file zip reader, row parser. Node 20+, no dependencies. */
import zlib from "node:zlib";
import fs from "node:fs";
import path from "node:path";

const HOSTS = [   // data.gdeltproject.org is a CNAME of the GCS bucket; the newest ~hour of files sometimes 404 there but exist on the GCS URL
  "https://storage.googleapis.com/data.gdeltproject.org/gdeltv2/",
  "https://data.gdeltproject.org/gdeltv2/"];
const UA = "SnippetsIngest/0.1 (news headline index; +https://snippets-news.saksham-snippets.workers.dev)";

export const stampOf = (d) => d.toISOString().replace(/[-:T]/g, "").slice(0, 14);                 // 20261023041500
export const dateOfStamp = (s) => new Date(Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)));
export function stampsBack(endStamp, count) {
  const end = dateOfStamp(endStamp).getTime(), out = [];
  for (let i = 0; i < count; i++) out.push(stampOf(new Date(end - i * 900000)));
  return out.reverse();   // oldest first
}
export async function latestStamp() {
  const r = await fetch(HOSTS[1] + "lastupdate.txt", { headers: { "user-agent": UA } });
  const m = /(\d{14})\.gkg\.csv\.zip/.exec(await r.text());
  if (!m) throw new Error("lastupdate.txt: no gkg line");
  return m[1];
}
/** Download one GKG zip (null if not published/404). translation=true -> *.translation.gkg.csv.zip */
export async function downloadGkg(stamp, { translation = false, dir = null } = {}) {
  const name = `${stamp}${translation ? ".translation" : ""}.gkg.csv.zip`;
  if (dir) { const f = path.join(dir, name); if (fs.existsSync(f) && fs.statSync(f).size > 1000) return fs.readFileSync(f); }
  for (const h of HOSTS) {
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        const r = await fetch(h + name, { headers: { "user-agent": UA } });
        if (r.status === 404) break;
        if (!r.ok) throw new Error("http " + r.status);
        const buf = Buffer.from(await r.arrayBuffer());
        if (buf.length < 4 || buf.readUInt32LE(0) !== 0x04034b50) throw new Error("not a zip");
        if (dir) fs.writeFileSync(path.join(dir, name), buf);
        return buf;
      } catch (e) { if (attempt === 2) break; await new Promise((r) => setTimeout(r, 800 * (attempt + 1))); }
    }
  }
  return null;
}
/** Minimal reader for GDELT's single-entry zip files (deflate). */
export function unzipFirst(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error("zip: no end record");
  const cd = buf.readUInt32LE(e + 16);
  const method = buf.readUInt16LE(cd + 10), csize = buf.readUInt32LE(cd + 20), lho = buf.readUInt32LE(cd + 42);
  const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
  const data = buf.subarray(start, start + csize);
  return method === 0 ? data : zlib.inflateRawSync(data);
}

const ENT = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };
export function decodeEntities(s) {
  return s.replace(/&(?:#x([0-9a-f]+)|#(\d+)|([a-z]+));/gi, (m, hx, dc, nm) => {
    try { if (hx) return String.fromCodePoint(parseInt(hx, 16)); if (dc) return String.fromCodePoint(+dc); } catch { return ""; }
    return ENT[(nm || "").toLowerCase()] ?? m;
  });
}
const tagOf = (x, t) => { const i = x.indexOf("<" + t + ">"); if (i < 0) return ""; const j = x.indexOf("</" + t + ">", i); return j < 0 ? "" : x.slice(i + t.length + 2, j); };
const pubTs = (s) => /^\d{14}$/.test(s) ? Date.UTC(+s.slice(0, 4), +s.slice(4, 6) - 1, +s.slice(6, 8), +s.slice(8, 10), +s.slice(10, 12), +s.slice(12, 14)) : null;

/** GKG 2.1 columns used: 0 id, 1 date, 3 source domain, 4 url, 8 V2Themes, 10 V2EnhancedLocations, 15 V2Tone, 25 TranslationInfo, 26 Extras(XML).
 *  Deliberately NOT read/kept: persons, organisations, quotations, images, GCAM (not needed, and quotations/images are publisher content). */
export function* parseGkg(text, stamp) {
  const batchMs = dateOfStamp(stamp).getTime();
  let pos = 0;
  while (pos < text.length) {
    let nl = text.indexOf("\n", pos); if (nl < 0) nl = text.length;
    const line = text.slice(pos, nl); pos = nl + 1;
    if (!line) continue;
    const c = line.split("\t");
    if (c.length < 27) continue;
    const ex = c[26];
    const title = decodeEntities(tagOf(ex, "PAGE_TITLE")).replace(/\s+/g, " ").trim();
    if (!title) continue;
    const tone = c[15] ? c[15].split(",") : [];
    const tr = /srclc:(\w+)/.exec(c[25]);
    const pt = pubTs(tagOf(ex, "PAGE_PRECISEPUBTIMESTAMP"));
    let ts = pt && pt <= batchMs + 3600000 && pt > batchMs - 14 * 86400000 ? pt : batchMs;   // publisher timestamp when sane, else the batch time
    yield { url: c[4], domain: c[3].toLowerCase().replace(/^www\./, ""), title, ts, batch: batchMs,
      themes: c[7], locs: c[10], tone: tone.length ? +tone[0] : 0, wc: tone.length >= 7 ? +tone[6] : 0, lang: tr ? tr[1] : "eng" };
  }
}
