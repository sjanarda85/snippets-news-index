/* GKG themes (+ headline words where GKG has no theme, e.g. sport/entertainment) -> topic tags.
   Broad topics = site categories; "chip" tags = exactly what the site's topic chips send as q (climate, election, economy, cricket,
   artificial intelligence, health, space, monsoon). q -> tag in CHIP_TAG. Free-text q that is not here is NOT in the index (live GDELT DOC fallback). */
const T = (re) => new RegExp(re, "i");
const RULES = [
  // [tag, theme regex (on ';'-joined theme list), headline regex]
  ["technology", /(^|;)(SOC_EMERGINGTECH|TECH_[A-Z]+|CYBER_ATTACK|WB_133_INFORMATION_AND_COMMUNICATION_TECHNOLOGIES|WB_135_TRANSPORT|ECON_BITCOIN|SURVEILLANCE)(;|$)/,
    T("\\b(a\\.?i\\.?|artificial intelligence|chatgpt|openai|gemini|generative|chatbot|llm|machine learning|google|apple|iphone|android|microsoft|nvidia|samsung|meta|tesla|software|smartphone|semiconductor|chips?|cyber\\w*|hack\\w*|startup|robot\\w*|data cent(er|re)s?|5g|cloud|tech|technology|crypto\\w*|bitcoin|gadget|laptop|quantum|drone)\\b")],
  ["ai", null, T("\\b(a\\.?i\\.?|artificial intelligence|chatgpt|openai|generative ai|chatbot|llms?|machine learning|deepseek|anthropic|copilot|agentic)\\b")],
  ["science", /(^|;)(SCIENCE|WB_1[0-9]*_SCIENCE[A-Z_]*|ENV_SPECIESENDANGERED)(;|$)/, T("\\b(nasa|isro|scientists?|astronom\\w*|researchers?|fossil|planet|telescope|species|physics|study finds|space|satellite|rocket|moon|mars)\\b")],
  ["space", null, T("\\b(nasa|isro|spacex|space|satellite|rocket|moon|mars|astronaut\\w*|orbit|launch(es|ed)? (mission|vehicle)|telescope|asteroid|comet|cosmic)\\b")],
  ["business", /(^|;)(ECON_[A-Z_]+|WB_698_TRADE|WB_1104_MACROECONOMIC[A-Z_]*|EPU_ECONOMY[A-Z_]*|ECON_STOCKMARKET)(;|$)/,
    T("\\b(stocks?|shares|sensex|nifty|markets?|econom\\w+|inflation|gdp|bank|banks|rbi|ipo|earnings|profit|revenue|rupee|dollar|tariffs?|trade|budget|company|companies|investors?|oil prices?|mergers?|acquisition|startup)\\b")],
  ["sports", null, T("\\b(cricket|football|soccer|ipl|nba|nfl|mlb|nhl|tennis|hockey|golf|f1|formula (1|one)|rugby|badminton|boxing|ufc|wrestling|athletics|olympic\\w*|paralympic\\w*|t20|odi|test match|premier league|champions league|la liga|serie a|bundesliga|world cup|grand slam|tournament|semi-?final|quarter-?final|playoffs?|coach|goal|innings|wickets?|batter|batsman|bowler|striker|quarterback|touchdown|match report|beat|beats|defeat\\w*|wins?|vs\\.?)\\b")],
  ["cricket", null, T("\\b(cricket|ipl|t20i?|odi|test (match|series)|ranji|bcci|icc|wickets?|innings|batter|batsman|bowler|kohli|rohit sharma|dhoni)\\b")],
  ["health", /(^|;)(HEALTH_PANDEMIC|HEALTH_VACCINATION|UNGP_HEALTHCARE|WB_621_HEALTH_NUTRITION_AND_POPULATION|HEALTH_[A-Z]+)(;|$)/,
    T("\\b(health\\w*|hospitals?|disease|virus|outbreak|vaccin\\w+|covid|nipah|dengue|cancer|medical|doctors?|patients?|mental health|obesity|diabetes|surgery|drug|fda|who warns|clinic\\w*|nutrition|pandemic|flu)\\b")],
  ["politics", /(^|;)(ELECTION|ELECTION_FRAUD|LEGISLATION|GOV_[A-Z_]+|DEMOCRACY|CONSTITUTIONAL|POLITICAL_TURMOIL|TAKE_OFFICE|RESIGNATION|APPOINTMENT|VETO|RATIFY)(;|$)/,
    T("\\b(election\\w*|minister\\w*|parliament|assembly|congress|senate|president|prime minister|bjp|cpi\\(?m?\\)?|udf|ldf|party|votes?|polls?|governor|government|cabinet|mla|mp|policy|bill|lawmakers?|opposition|campaign|ballot)\\b")],
  ["election", /(^|;)(ELECTION|ELECTION_FRAUD)(;|$)/, T("\\b(elections?|polls?|ballot|voters?|voting|candidates?|by-?election|constituency|manifesto|exit polls?)\\b")],
  ["world", /(^|;)(ARMEDCONFLICT|CEASEFIRE|SANCTIONS|REFUGEES|ALLIANCE|NEGOTIATIONS|MILITARY|WMD|BLOCKADE|SOVEREIGNTY|BORDER|IMMIGRATION|UNREST_BELLIGERENT|SEIGE)(;|$)/,
    T("\\b(war|ceasefire|un|united nations|nato|summit|diplomat\\w*|border|military|missile|refugees?|sanctions?|invasion|treaty|peace talks?|airstrikes?|hostages?|gaza|ukraine|russia|israel|iran|china)\\b")],
  ["climate", /(^|;)(ENV_CLIMATECHANGE|UNGP_CLIMATE_CHANGE_ACTION|NATURAL_DISASTER[A-Z_]*|DISASTER_[A-Z_]+|ENV_GREEN|ENV_SOLAR|ENV_COAL|WATER_SECURITY|DISASTER_FIRE)(;|$)/,
    T("\\b(climate|heat ?wave|floods?|flooding|cyclone|hurricane|typhoon|monsoon|rain\\w*|drought|wildfires?|emissions?|carbon|cop ?\\d+|glaciers?|landslides?|earthquakes?|weather|pollution|air quality|global warming|sea level|storm)\\b")],
  ["monsoon", null, T("\\b(monsoon|rainfall|heavy rains?|imd|deluge|orange alert|red alert)\\b")],
  ["entertainment", null, T("\\b(film|movie|movies|actor|actress|bollywood|hollywood|tollywood|mollywood|kollywood|song|album|series|season \\d|netflix|prime video|box office|trailer|celebrity|concert|oscars?|grammys?|emmys?|singer|director|show|episode|streaming|premiere|teaser|ott|bigg boss)\\b")],
  ["crime", /(^|;)(SOC_GENERALCRIME|CRIME_[A-Z_]+|ARREST|RAPE|KILL|TRIAL|TERROR|KIDNAP|ORGANIZED_CRIME|CORRUPTION|DRUG_TRADE|GENDER_VIOLENCE|HUMAN_TRAFFICKING)(;|$)/,
    T("\\b(murder\\w*|killed|arrest\\w*|police|court|accused|convicted|sentenced|rape|assault|fraud|scam|theft|robbery|bail|custody|suicide|stabb\\w*|shot dead|gang)\\b")],
];
/* site topic chip q -> tag (live.js / index.html data-q values; "economy" is a chip that means business) */
export const CHIP_TAG = { climate: "climate", election: "election", elections: "election", economy: "business", cricket: "cricket", "artificial intelligence": "ai", ai: "ai",
  health: "health", space: "space", monsoon: "monsoon", technology: "technology", tech: "technology", business: "business", sports: "sports", sport: "sports", science: "science",
  politics: "politics", world: "world", entertainment: "entertainment", crime: "crime" };
export const TOPIC_LABEL = { technology: "Technology", ai: "AI", science: "Science", space: "Space", business: "Business", sports: "Sports", cricket: "Cricket", health: "Health",
  politics: "Politics", election: "Elections", world: "World", climate: "Climate", monsoon: "Monsoon", entertainment: "Entertainment", crime: "Crime & courts" };
/* theme-only tags for broad topics need a headline cue too when the theme is generic (ECON_*, SCIENCE, HEALTH_*): keeps "Technology" clean */
const NEED_BOTH = new Set(["technology", "science", "health"]);
export function tagsOf(themes, title) {
  const out = [];
  for (const [tag, th, re] of RULES) {
    const byTheme = th ? th.test(themes) : false, byTitle = re.test(title);
    if (NEED_BOTH.has(tag) ? (byTitle || (byTheme && tag === "science")) : (byTheme || byTitle)) out.push(tag);
  }
  return out;
}
/* single display category used by the site's category chips (worker/src/cluster.js categorise names) */
export const CATEGORY_OF = { technology: "Tech", ai: "Tech", science: "Tech", space: "Tech", business: "Business", sports: "Sport", cricket: "Sport", health: "Health", politics: "Politics",
  election: "Politics", world: "World", climate: "Climate", monsoon: "Climate", entertainment: "General", crime: "General" };
