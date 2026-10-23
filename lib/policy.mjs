/* Legal / editorial policy constants for the index (Legal follow-up 23 Oct 2026, section 10 of plans/snippets-legal-review.md).
   Everything the owner or Legal may want to tune is here. Changing a value changes the next build; nothing else needs editing. */
export const POLICY = {
  ATTRIBUTION: "Contains data from The GDELT Project, https://www.gdeltproject.org/",
  LIVE_WINDOW_H: 6,                // Live shards: stories whose newest article is this recent (Legal cap: ~48 h)
  CURATED_MAX_DAYS: 30,            // Curated history (Legal cap: 30 days)
  FLAGGED_MAX_DAYS: 7,             // crime / court / named-person ("needs review") stories are deleted from the index after this many days (state included)
  DROP_PROTECTED: true,            // minors in conflict with the law / sexual-offence victims: dropped at ingest, never stored (conservative keyword filter)
  HOLD_GUILT_AS_FACT: true,        // a flagged story whose headline states guilt as fact about a person, with no hedge, is held back (not published)
  DROP_TONE_FLAGGED: true,         // no GDELT tone on flagged stories (tone could read as a judgment about a named person)
  FLAG_LABEL: "Reported by {outlet}. Allegation, not established.",   // shown by the Worker/front-end on flagged cards; the publisher's headline is never rewritten
  LOCATION_FROM_HEADLINE_ONLY: true, // crime stories are placed on a state/city page only if the place is named in an outlet's headline, never from GDELT's place field alone
  NO_PERSON_ORG_LISTS: true,       // GKG persons / organisations are never read or stored (documentation constant; the parser does not extract them)
  /* --- global scope (v1.6; editorial guide 02/03, owner decisions D5/D8/D9/D10) --- */
  RANKING: "editorial",            // "editorial" = 40*C + 25*R + 25*W + 10*D (scope-weighted, guide section 3); "legacy" = the v1.0 formula (rollback switch)
  WORLD_TOP_N: 50,                 // the neutral World front page holds the top 50 (country cap is measured on it)
  LOCAL_BOOST: 0,                  // 0 = neutral (default). 0-0.50: W x (1+boost) for the places in LOCAL_BOOST_COUNTRIES (owner-chosen). Reader-chosen boost is applied by the Worker, never here.
  LOCAL_BOOST_COUNTRIES: [],       // ISO2 codes; only used when LOCAL_BOOST > 0
  /* Language tiers: L1 = headline + summary (verified), L2 = headline only (original headline shown as-is with its language tag), L3 = not shown.
     English is the only L1 at launch. Other languages need BOTH: SNIPPETS_TRANSLATIONS=1 (also read GDELT's *.translation.gkg.csv.zip files) and the language listed
     in SNIPPETS_LANG_L2 (comma-separated ISO 639-3, e.g. "fra,spa"). Both are OFF by default: the protected-content and guilt filters below are English-word lists,
     so a non-English headline would bypass them until a reviewer who reads that language signs the language off (editorial guide 3, language handling). */
  TRANSLATION_FILES: process.env.SNIPPETS_TRANSLATIONS === "1",
  LANG_L2: (process.env.SNIPPETS_LANG_L2 || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean),
};
export const langTier = (lang3) => (!lang3 || lang3 === "eng" ? "L1" : POLICY.LANG_L2.includes(String(lang3).toLowerCase()) ? "L2" : "L3");

/* --- protected content: dropped entirely (JJ Act s.74, POCSO s.23, BNS s.72). Errs on the side of dropping. --- */
const SEXUAL = /\b(rape[sd]?|raping|rapist\w*|gang-?rape\w*|sexual(ly)?\s+(assault\w*|abus\w*|harass\w*|exploit\w*|offen[cs]\w*|violen\w*)|molest\w*|pocso|sodomy|incest\w*|paedophil\w*|pedophil\w*|child\s+(sex|porn\w*|abuse)|sex\s+(crime|offen\w+|traffick\w*)|indecent\s+assault|outrag\w+\s+(of\s+)?modesty|eve-?teas\w*|stalking\s+of)\b/i;
const MINOR = /\b(minors?|juveniles?|underage|under-age|schoolgirls?|schoolboys?|(teen(age)?(r|d)?|school|college)\s+(girl|boy|student)s?|girl\s+aged|boy\s+aged|\d{1,2}-year-old\s+(girl|boy|child|student|daughter|son)|toddlers?|infants?|newborns?|babies|baby|child(ren)?|kids?)\b/i;
const CRIMEISH = /\b(murder\w*|kill(ed|ing|s)?|dead|death|died|rape\w*|assault\w*|abus\w*|arrest\w*|detain\w*|accused|alleg\w*|police|fir\b|court|bail|custody|convict\w*|sentenc\w*|kidnap\w*|abduct\w*|suicide|trafficking|stab\w*|shot|beaten|attack\w*|missing|body|found|victim\w*|assaulted|burn\w*|drown\w*|lynch\w*|trapped)\b/i;
export function protectedReason(title) {
  if (!POLICY.DROP_PROTECTED) return null;
  if (SEXUAL.test(title)) return "protected-sexual-offence";
  if (MINOR.test(title) && CRIMEISH.test(title)) return "protected-minor";
  return null;
}
/* --- guilt stated as fact about a person (past-tense crime verb, no hedge) --- */
const GUILT = /\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+)*\s+(killed|murdered|stabbed|raped|stole|robbed|cheated|defrauded|embezzled|looted|assaulted|molested|kidnapped|abducted|shot dead|bribed|beat to death|strangled|poisoned|burgled)\b/;
const HEDGE = /\b(alleg\w*|accus\w*|claim\w*|suspect\w*|arrest\w*|booked|held|charged|probe\w*|police\s+(say|said|suspect)|reportedly|reported|appears?|may have|might|could|questioned|detained|trial|convicted|sentenced|court|acquit\w*|found guilty|says?|said)\b|\?/i;
export function guiltAsFact(title) { return POLICY.HOLD_GUILT_AS_FACT && GUILT.test(title) && !HEDGE.test(title); }
