// Maintain blocklist.json (the single blocklist read by the ingest job and the Worker).  PUBLIC repo: only hashes and reason codes are written (see vendor/blocklist-core.js).
//   node blocklist-tool.mjs add <url | id:<storyId> | domain:<name> | term:<phrase>> [REASON] [--by role] [--approved-by role]   (prints the private-log line; writes the file)
//   node blocklist-tool.mjs check      validates the file (CI runs this)        node blocklist-tool.mjs hash <url>     prints the SHA-256 of a URL
import fs from "node:fs";
import { compileBlocklist, hideEntry, urlHash } from "./vendor/blocklist-core.js";
const F = new URL("./blocklist.json", import.meta.url), [cmd, arg, reason] = process.argv.slice(2);
const opt = (n, d = "") => { const i = process.argv.indexOf("--" + n); return i > 0 ? process.argv[i + 1] : d; };
const j = JSON.parse(fs.readFileSync(F, "utf8"));
if (cmd === "hash") console.log(urlHash(arg));
else if (cmd === "check") { const bl = compileBlocklist(j); if (bl.problems.length) { console.error("blocklist.json problems:\n - " + bl.problems.join("\n - ")); process.exit(1); } console.log(`blocklist.json ok: ${bl.count} entries`); }
else if (cmd === "add" && arg) {
  const m = /^(domain|term):(.+)$/i.exec(arg);
  const base = hideEntry(m ? "x" : arg, { reason, addedBy: opt("by", "editor"), approvedBy: opt("approved-by", "") });
  const entry = m ? { ...base, type: m[1].toLowerCase(), value: m[2].trim() } : base;
  if (!compileBlocklist({ entries: [entry] }).count) { console.error("invalid entry"); process.exit(1); }
  if (!j.entries.some((e) => e.type === entry.type && e.value === entry.value)) j.entries.push(entry);
  fs.writeFileSync(F, JSON.stringify(j, null, 2) + "\n");
  console.log(`added ${entry.type} entry (${entry.reason}). Private log line (SOP 04): ${entry.addedAt} | ${entry.type} | ${entry.type === "url" ? "sha256:" + entry.value : "value withheld"} | ${entry.reason} | by ${entry.addedBy}`);
  console.log("Commit and push; the Worker and the ingest job pick it up within about 15 minutes. For an instant hide use POST /api/admin/hide.");
} else { console.error("usage: see header of blocklist-tool.mjs"); process.exit(1); }
