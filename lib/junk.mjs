/* "Non-news junk" filter. Cheap rules only (domain list, URL patterns, headline patterns, stubs, non-English). Tuned on 72 h of real GKG. */
export const JUNK_DOMAINS = new Set(`iheart.com prnewswire.com businesswire.com globenewswire.com einpresswire.com accesswire.com newsfilecorp.com issuewire.com openpr.com send2press.com
pr.com prweb.com einnews.com benzinga.com marketbeat.com themarketsdaily.com dailypolitical.com tickerreport.com etfdailynews.com modernreaders.com thelincolnianonline.com
americanbankingnews.com thecerbatgem.com wkrb13.com wsbeacon.com ledgergazette.com dispatchtribunal.com theenterpriseleader.com stocktitan.net tipranks.com
zazoom.it inewsgr.com bignewsnetwork.com mondaq.com lexology.com jdsupra.com newsbreak.com dailyhunt.in pressreleasepoint.com marketscreener.com investorplace.com
sltrib.com.invalid fool.com.invalid streetinsider.com stockhouse.com tradingview.com seekingalpha.com chartmill.com zacks.com simplywall.st gurufocus.com
mena-fn.com marketsmojo.com news.google.com`.split(/\s+/));
const URL_JUNK = /\/(tag|tags|category|categories|author|authors|topic|topics|search|archive|archives|horoscope[s]?|obituar(y|ies)|classifieds?|coupons?|promo-codes?|jobs?|careers?|weather-forecast|podcasts?|photo-gallery|crossword|lottery|results\/)(\/|$|\?)|\.(pdf|xml|jpg|png)(\?|$)|[?&]s=/i;
const TITLE_JUNK = new RegExp([
  "^(home|index|page not found|404|just a moment|access denied|attention required|untitled|error|log ?in|sign ?in|subscribe|redirect\\w*|loading|welcome)\\b",
  "\\b(horoscope|obituar(y|ies)|death notice|funeral (notice|service)|crossword|wordle|connections hints?|quordle|sudoku|lottery results?|winning numbers|powerball|mega millions|lotto)\\b",
  "\\b(promo codes?|coupon codes?|discount codes?|best deals?|black friday|cyber monday|prime day|deals of the day|buy now|giveaway|sweepstakes)\\b",
  "\\b(shares? (sold|bought|acquired|purchased)|stake (in|raised|lowered|trimmed|boosted|cut)|(raises?|lowers?|cuts?|boosts?|trims?|acquires?|sells?) (stake|position|holdings)|price target|rating (reiterated|reaffirmed|lowered|raised)|institutional investors?|position in)\\b.*\\b(inc|corp|plc|ltd|nyse|nasdaq|holdings?|etf)\\b",
  "\\b(weather forecast|today'?s weather|local weather|traffic report|live stream(ing)?|live blog|watch live)\\b: ?$",
  "^\\W*(photos?|video|videos|gallery|pictures)\\W*$",
  "\\b(press release|sponsored|advertorial|paid post|partner content)\\b"].join("|"), "i");
const nonLatin = (t) => { let n = 0; for (const ch of t) if (ch.charCodeAt(0) > 0x24f) n++; return n / Math.max(1, t.length); };
import { protectedReason } from "./policy.mjs";
/** returns a reason string if the article is junk, else null */
export function junkReason(a) {
  if (JUNK_DOMAINS.has(a.domain) || [...JUNK_DOMAINS].some((d) => a.domain.endsWith("." + d))) return "domain";
  if (!/^https?:\/\//i.test(a.url)) return "url";
  if (URL_JUNK.test(a.url)) return "url-pattern";
  const w = a.title.split(/\s+/).filter(Boolean);
  if (w.length < 4) return "short-title";
  if (a.title.length > 300) return "long-title";
  if (a.title.toLowerCase().replace(/^www\./, "") === a.domain) return "title=domain";
  if (TITLE_JUNK.test(a.title)) return "title-pattern";
  if (nonLatin(a.title) > 0.25) return "non-latin";
  if (a.wc && a.wc < 50) return "stub";
  const pr = protectedReason(a.title); if (pr) return pr;   // minors / sexual-offence victims: never stored
  return null;
}
