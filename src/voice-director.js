/**
 * Phone Director (Mike 2026-10-22): a FIXED script for calls. Code decides every step and writes every
 * line; nothing is improvised. Order (Mike's rule — identity first, then the need, then follow-up):
 *   1. Name of the caller ("May I know your name, please?")
 *   2. Identity: serial number -> record; no serial -> company (not asked again if already said) ->
 *      branch / department -> machine -> CONFIRMED with the caller.
 *   3. The need: ink / toner / cartridge (how many, which colours) or repair (what is wrong) or
 *      follow-up; then the machine condition.
 *   4. Follow-up: contact number (read back digit by digit), email (read back).
 *   5. Short spoken summary -> yes -> saved (same save as chat: src/business-engines.js) -> reference.
 * Lists are never read; serials are never spoken. Numbers are spoken digit by digit.
 * State lives on the conversation (customer_profile.voice_call) and starts fresh with each call.
 * Off with VOICE_DIRECTOR=off (calls then go through the old Closer + Director path).
 */
const { prisma } = require("./db");
const be = require("./business-engines");
const branchMatch = require("./branch-match");
const { parseSupplyItems } = require("./supply-items");

const FLOW = "customer_service.create_service_request";
const tool = (key) => { const [e, o] = key.split("."); return be.logicalToolName(e, o); };

// Common Filipino first names (unisex names left out on purpose); others asked to SEA-LION.
const MEN = new Set("paul john mark michael mike jose juan carlo carlos james joseph daniel ryan kevin christian angelo miguel rafael gabriel joshua jerome jomar ronald roberto robert rodel ramon antonio eduardo edgar eric francis gerald jeffrey jeff jayson jason kenneth leo luis manuel marlon nestor noel oscar patrick peter ramil rey richard rommel ruben samuel vincent victor william arnold alvin allan benjamin bryan brian carl cesar danilo dennis dominic emmanuel ferdinand george henry jerry jimmy joel jonathan julius lawrence lester louie mario martin nathan paolo ralph renato ricardo rolando ronnie sergio steven tony wilfredo edwin mateo andrew adrian aaron albert arnel arturo bernard boy dante efren elmer ernesto felix fernando gilbert gregorio jaime jesus jojo jonel jose lito marvin melvin nelson orlando pedro reynaldo rodrigo romeo rudy teodoro virgilio willy zaldy darwin jerwin mhark jhon rogelio armando alfredo".split(" "));
const WOMEN = new Set("karen maria mary anne ann ana anna grace joy jenny jennifer jessica kristine christine catherine kathleen liza lisa mae marie michelle nicole rose rosa sarah sheila shiela angela angelica april carmen charlotte cherry claire cristina diana elena ella emily gina hazel irene jasmine jocelyn joan joanna judith julie karla lea leah lorna lourdes lucy lyn marissa maricel marilyn melissa mila nancy nina norma pamela patricia pia precious rachel rhea rica rowena ruby ruth sandra sofia sophia stephanie susan teresa tess vanessa veronica vilma wendy yvonne aileen alma amy andrea arlene beth carla celia cora daisy dolores edna elizabeth evelyn faith flor gemma gloria helen imelda ivy jane janet jean josephine kate katherine laura linda liezl lilia luz margarita marlene merly mylene nerissa rebecca rosario sally shirley thelma trisha vicky zenaida princess analyn mariel camille bea kaye mylyn rosemarie ma marites lorena ofelia remedios corazon".split(" "));

/* ------------------------------- speech helpers ------------------------------- */
const DIGIT_WORDS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
function spokenDigits(t) { // "thirty thirty five" -> 3035, "zero nine one seven" -> 0917
  const ONES = { zero: 0, oh: 0, o: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13, fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18, nineteen: 19 };
  const TENS = { twenty: 20, thirty: 30, forty: 40, fourty: 40, fifty: 50, sixty: 60, seventy: 70, eighty: 80, ninety: 90 };
  const SMALL = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9 };
  let src = String(t || "").toLowerCase().replace(/-/g, " ");
  src = src.replace(/\b(one|two|three|four|five|six|seven|eight|nine)\s+thousand(?:\s+(?:and\s+)?(one|two|three|four|five|six|seven|eight|nine))?\b/g, (m, a, b) => `${SMALL[a]}00${b ? SMALL[b] : 0}`);
  const toks = src.match(/[a-z]+|\d+/g) || [];
  let out = "", run = "";
  for (let i = 0; i < toks.length; i += 1) {
    const w = toks[i];
    if (/^\d+$/.test(w)) { run += w; continue; }
    if ((w === "double" || w === "triple") && ONES[toks[i + 1]] !== undefined && ONES[toks[i + 1]] < 10) { run += String(ONES[toks[i + 1]]).repeat(w === "double" ? 2 : 3); i += 1; continue; }
    if (TENS[w] !== undefined) {
      const next = ONES[toks[i + 1]];
      if (next !== undefined && next > 0 && next < 10) { run += String(TENS[w] + next); i += 1; } else run += String(TENS[w]);
      continue;
    }
    if (w === "hundred" && run) { run += "00"; continue; }
    if (ONES[w] !== undefined && !(w === "o" && !run)) { run += String(ONES[w]); continue; }
    if (run) { out += ` ${run} `; run = ""; }
    out += ` ${w} `;
  }
  if (run) out += ` ${run} `;
  return out.replace(/\s+/g, " ").trim();
}
const digitsIn = (t) => spokenDigits(t).replace(/[^0-9]/g, "");
/** "09175769817" -> "zero nine one seven, five seven six, nine eight one seven" (never one big number). */
function sayDigits(d) {
  const s = String(d || "").replace(/\D/g, "");
  const groups = s.length === 11 ? [s.slice(0, 4), s.slice(4, 7), s.slice(7)] : s.match(/.{1,3}/g) || [];
  return groups.map((g) => g.split("").map((c) => DIGIT_WORDS[Number(c)]).join(" ")).join(", ");
}
function sayEmail(e) {
  return String(e || "").replace(/\./g, " dot ").replace(/@/g, " at ").replace(/_/g, " underscore ").replace(/-/g, " dash ").replace(/\s+/g, " ").trim();
}
const NATO = { alpha: "a", alfa: "a", bravo: "b", charlie: "c", delta: "d", echo: "e", foxtrot: "f", golf: "g", hotel: "h", india: "i", juliet: "j", juliett: "j",
  kilo: "k", lima: "l", mike: "m", november: "n", oscar: "o", papa: "p", quebec: "q", romeo: "r", sierra: "s", tango: "t", uniform: "u", victor: "v", whiskey: "w", xray: "x", yankee: "y", zulu: "z" };
const DOMAINS = ["gmail.com", "yahoo.com", "yahoo.com.ph", "hotmail.com", "outlook.com", "icloud.com", "live.com", "ymail.com"];
/** Letters the caller spelled ("P, N, D" / "P as in Peter" / "papa india") -> "pnd". */
function spelledLetters(t) {
  const toks = String(t || "").toLowerCase().replace(/\bas in \w+/g, " ").match(/[a-z0-9]+|[._@-]/g) || [];
  let out = "", singles = 0;
  for (const w of toks) {
    if (/^[a-z]$/.test(w) || /^\d$/.test(w)) { out += w; singles += 1; }
    else if (NATO[w]) { out += NATO[w]; singles += 1; }
    else if (w === "underscore" || w === "_") out += "_";
    else if (w === "dot" || w === "period") out += ".";
    else if (w === "dash" || w === "hyphen" || w === "-") out += "-";
  }
  return singles >= 3 ? out : "";
}
/** Domain said ("at yahoo dot com") -> "yahoo.com". */
function domainFrom(t) {
  const x = String(t || "").toLowerCase().replace(/\s+dot\s+/g, ".").replace(/\s*\.\s*/g, ".");
  const m = x.match(/(?:\bat\s+|@)([a-z0-9-]+(?:\.[a-z]{2,}){1,2})\b/);
  if (m) return m[1];
  const d = DOMAINS.find((dd) => x.includes(dd.split(".")[0]));
  return d || "";
}
/** "a b c" spelled for a read-back: "p, i, n, e, d, a, m, i, k, e, b, at yahoo dot com". */
// Spelling (only when the caller asks): a full stop after each letter so the voice pauses, grouped by name part.
function spellEmail(e) {
  const [local, domain] = String(e || "").toLowerCase().split("@");
  const parts = sayEmailWords(`${local}@x`).replace(/ at x$/, "").split(" ");
  const spelled = parts.map((w) => (["dot", "underscore", "dash"].includes(w) ? w : /^(zero|one|two|three|four|five|six|seven|eight|nine)$/.test(w) ? w : w.toUpperCase().split("").join(". "))).join(". ");
  return `${spelled}. at ${String(domain || "").replace(/\./g, " dot ")}`;
}
function dice(a, b) {
  const grams = (t) => { const g = []; for (let i = 0; i < t.length - 1; i += 1) g.push(t.slice(i, i + 2)); return g; };
  const A = grams(a), B = grams(b); if (!A.length || !B.length) return 0;
  let hit = 0; const pool = [...B]; for (const g of A) { const i = pool.indexOf(g); if (i >= 0) { hit += 1; pool.splice(i, 1); } }
  return (2 * hit) / (A.length + B.length);
}
/** A misheard email close to one we know ("peneda_mike_b@yahoo.com" ~ "pinedamikeb@yahoo.com") -> the known one. */
function closestKnownEmail(heard, known) {
  const norm = (e) => String(e || "").toLowerCase().split("@")[0].replace(/[^a-z0-9]/g, "");
  const h = norm(heard); if (h.length < 3) return "";
  let best = "", score = 0;
  for (const k of known) { const sc = Math.max(dice(h, norm(k)), norm(k).includes(h) && h.length >= 4 ? 0.8 : 0); if (sc > score) { score = sc; best = k; } }
  return score >= 0.5 ? best : "";
}
/* -------- emails read back as words (Mike 2026-10-23: not letter by letter, it sounds foreign) -------- */
const EMAIL_WORDS = () => new Set([...MEN, ...WOMEN, ...PH_SURNAMES.toLowerCase().split(/,\s*/).map((w) => w.replace(/\s+/g, "")),
  "dela", "delos", "de", "del", "san", "santa", "mike", "jun", "jr", "sr", "admin", "info", "sales", "office", "accounting", "hr", "service", "support", "marga", "biz", "mail", "inc", "corp", "group", "ph"]);
let _emailWords = null;
function sayEmailWords(e) {
  const dict = _emailWords || (_emailWords = EMAIL_WORDS());
  const DIG = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
  const [local, domain] = String(e || "").toLowerCase().split("@");
  const out = [];
  for (const part of local.split(/([._-])/)) {
    if (part === ".") { out.push("dot"); continue; }
    if (part === "_") { out.push("underscore"); continue; }
    if (part === "-") { out.push("dash"); continue; }
    for (const run of part.match(/[a-z]+|\d+/g) || []) {
      if (/^\d+$/.test(run)) { out.push(run.split("").map((d) => DIG[Number(d)]).join(" ")); continue; }
      const pieces = [];
      let i = 0;
      while (i < run.length) {   // longest known name / word first, else one letter
        let hit = "";
        for (let j = run.length; j >= i + 3; j -= 1) if (dict.has(run.slice(i, j))) { hit = run.slice(i, j); break; }
        if (hit) { pieces.push(hit); i += hit.length; } else { pieces.push(run[i]); i += 1; }
      }
      // "jeffry" -> jeff r y, "care" -> c a r e: two or more loose letters -> say the part as one word
      if (pieces.filter((x) => x.length === 1).length >= 2 && /[aeiou]/.test(run) && run.length >= 3) out.push(run);
      else out.push(...pieces);
    }
  }
  // letters left alone next to each other are read as one word if it sounds like one ("jo" stays "j o")
  return `${out.join(" ")} at ${String(domain || "").replace(/\./g, " dot ")}`.replace(/\s+/g, " ").trim();
}
/* -------- listening modes for speech-to-text (Mike 2026-10-23) -------- */
// Sent to Pitch with the reply; Pitch passes it to the speech model for the caller's NEXT answer only.
const PH_SURNAMES = "Pineda, Santos, Reyes, Cruz, Dela Cruz, Bautista, Garcia, Mendoza, Ramos, Aquino, Castillo, Villanueva, Fernandez, Lopez, Gonzales, Torres, Flores, Rivera, Navarro, Marquez, Domingo, Ocampo, Manalo, Mercado, Soriano";
function emailContext(st) {
  const known = (st.known_emails || []).slice(0, 4);
  const name = String(st.callername || st.name || "").replace(/^(sir|ma'?am)\s+/i, "");
  const domains = [...new Set((st.machine?.emails || []).map((e) => String(e).split("@")[1]).filter(Boolean))].slice(0, 2);
  return [
    "Email address, spelled the way people say it on the phone: name parts and numbers joined, then at, then the domain.",
    "Examples: maria santos at gmail dot com = mariasantos@gmail.com. juan underscore dela cruz two three at yahoo dot com = juan_delacruz23@yahoo.com. j reyes eighty one at outlook dot com = jreyes81@outlook.com.",
    known.length ? `Known emails: ${known.join(", ")}.` : "",
    name ? `Caller name: ${name}.` : "",
    `Domains: ${[...domains, "gmail.com", "yahoo.com", "yahoo.com.ph", "outlook.com", "hotmail.com", "icloud.com", "ymail.com"].join(", ")}.`,
    "Endings are said as: dot com, dot com dot ph, dot ph, dot net, dot org, dot edu dot ph, dot gov dot ph.",
    `Names: ${PH_SURNAMES}.`
  ].filter(Boolean).join(" ").slice(0, 700);
}
function asrFor(st) {
  const k = st.ask?.k || "";
  if (["email", "emailAgain", "emailConfirm", "emailKnown", "emailLetters", "spellEmail"].includes(k)) return { mode: "email", context: emailContext(st), candidates: (st.known_emails || []).slice(0, 6) };
  if (["name", "nameAgain"].includes(k)) return { mode: "name", context: `The caller says their first name, maybe with Sir or Ma'am. Common Filipino first names: John, Mark, Michael, Mike, Jose, Juan, Carlo, James, Joseph, Daniel, Ryan, Kevin, Christian, Angelo, Miguel, Rafael, Joshua, Jerome, Ronald, Robert, Ramon, Antonio, Eduardo, Francis, Jeffrey, Jayson, Kenneth, Leo, Noel, Patrick, Rey, Richard, Maria, Mary, Anne, Ana, Grace, Joy, Jenny, Jennifer, Kristine, Catherine, Liza, Mae, Michelle, Nicole, Rose, Sarah, Sheila, Angela, April, Carmen, Claire, Cristina, Hazel, Irene, Joan, Lea, Lorna, Marissa, Maricel.` };
  if (["phone", "phoneAgain"].includes(k)) return { mode: "digits", context: "Phone number said digit by digit: zero nine one seven, five seven six, nine eight one seven. Philippine mobile numbers start with zero nine and have eleven digits." };
  if (["serial", "serialAgain"].includes(k)) return { mode: "serial", context: "Machine serial number: letters and numbers said one by one, for example E seven six nine nine eight E nine H three seven one four five eight." };
  return null;
}
function parseEmail(t) {
  let s = ` ${String(t || "").toLowerCase()} `.replace(/[,]/g, " ");
  s = s.replace(/\s+(at|@)\s+/g, "@").replace(/\s+(dot|period|tuldok)\s+/g, ".").replace(/\s+underscore\s+/g, "_").replace(/\s+(dash|hyphen)\s+/g, "-");
  s = s.replace(/\s*@\s*/g, "@").replace(/\s*\.\s*(com|net|org|ph|biz|gov|edu|co)\b/g, ".$1");
  // "my email is vineda myd at yahoo dot com" -> vinedamyd@yahoo.com (every word after the intro, joined)
  const at = s.indexOf("@");
  if (at > 0) {
    let localWords = s.slice(0, at).trim().split(/\s+/);
    const intro = localWords.findLastIndex((w) => /^(is|ay|email|address|e-mail|it's|its|po)$/.test(w));
    if (intro >= 0) localWords = localWords.slice(intro + 1);
    const local = localWords.join("").replace(/[^a-z0-9._%+-]/g, "");
    const dm = s.slice(at + 1).match(/^[a-z0-9.-]+\.[a-z]{2,}/);
    if (local && dm) return `${local}@${dm[0]}`.replace(/\.+$/, "");
  }
  const m = s.match(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/);
  if (m) return m[0].replace(/\.+$/, "");
  // "michael marga at gmail dot com" -> join the words before @
  const parts = s.trim().split("@");
  if (parts.length === 2) {
    const local = parts[0].trim().split(/\s+/).slice(-3).join("").replace(/^(is|ay|my|email|address)+/, "");
    const domain = parts[1].trim().split(/\s+/)[0].replace(/[^a-z0-9.-]/g, "");
    if (local && /\.[a-z]{2,}$/.test(domain)) return `${local}@${domain}`;
  }
  return "";
}
const YES = /^\s*(yes|yeah|yep|yup|ya|yah|oo|opo|oho|tama|correct|that'?s (right|correct|it)|right|sure|ok(ay)?|sige|go ahead|proceed|confirm(ed)?|affirmative|uh[- ]?huh)\b/i;
const NO = /^\s*(no|nope|nah|hindi|mali|wrong|incorrect|not (that|it|correct|right)|that'?s not)\b/i;
const REPEAT = /\b(repeat|again|ulit|pardon|did not hear|didn'?t hear|can'?t hear|cannot hear|hindi ko (narinig|marinig)|di ko (narinig|marinig)|i (can'?t|cannot|did not|didn'?t) understand|what did you say|come again|sorry\?)\b/i;
const DONT_KNOW = /\b(don'?t|do not|di ko|hindi ko|wala(ng)?|no|can'?t|cannot)\b.{0,20}\b(know|have|alam|serial|see|find|sticker|number)\b|\bno serial\b|\bno sticker\b|\bwala\b/i;
const TAGALOG = /\b(po|opo|ako|namin|kami|yung|ang|ng|pwede|puwede|gusto|kailangan|wala|meron|salamat|sira|kasi|lang|naman|kayo|ninyo|nyo|ba)\b/gi;
const NAME_STOP = new Set(["from", "of", "at", "and", "here", "po", "calling", "sa", "taga", "the", "speaking", "i", "need", "want", "can"]);

const COMPANY_FILLER = /\b(po|lang|mismo|sa|yung|ang|ng|kami|namin|ito|iyon|yun|company|kompanya|the|our|is|it'?s|we are|we're|from|taga|name|pangalan|ay|i think|siguro)\b/gi;
function cleanCompany(t) {
  return String(t || "").replace(COMPANY_FILLER, " ").replace(/[.,!?]+/g, " ").replace(/\s+/g, " ").trim().slice(0, 50);
}
/** One of several search results only when it really looks like what was said. */
function closeCompany(list, q) {
  const qw = String(q || "").toLowerCase().split(/\s+/).filter((w) => w.length >= 3);
  const score = (name) => { const n = String(name || "").toLowerCase(); return qw.filter((w) => n.includes(w)).length; };
  const ranked = list.map((x) => ({ x, s: score(x.name) })).sort((a, b) => b.s - a.s);
  return ranked[0] && ranked[0].s >= Math.max(1, Math.ceil(qw.length / 2)) ? ranked[0].x : null;
}
function capital(w) { return String(w || "").toLowerCase().replace(/(^|[\s'-])([a-zñ])/g, (m, a, b) => a + b.toUpperCase()); }
function nameFrom(text, loose) {
  const t = String(text || "").replace(/[.!?,]+/g, " ").trim();
  const m = t.match(/\b(?:my name is|name'?s|this is|i am|i'm|ako si|ako po si|si|it'?s|pangalan ko(?: ay)?|call me)\s+((?:sir|ma'?am|mr|ms|mrs)\.?\s+)?([a-zñ][a-zñ'-]+(?:\s+[a-zñ][a-zñ'-]+)?)/i);
  let raw = m ? `${m[1] || ""}${m[2]}` : "";
  if (!raw && loose) {
    const ws = t.split(/\s+/).filter(Boolean);
    if (ws.length && ws.length <= 3 && !YES.test(t) && !NO.test(t) && !/\d/.test(t)) raw = ws.join(" ");
  }
  if (!raw) return "";
  const ws = raw.split(/\s+/);
  const keep = [];
  for (const w of ws) { if (NAME_STOP.has(w.toLowerCase())) break; keep.push(w); }
  return capital(keep.join(" ")).slice(0, 40);
}
function companyFrom(text) {
  const m = String(text || "").match(/\b(?:from|company is|company name is|our company is|my company is|taga|we are|we're|this is .{1,20}? (?:of|from))\s+([a-z0-9&.' -]{2,50})/i);
  if (!m) return "";
  const stop = /\s+(and|but|can|could|i|we|po|na|kami|so|please|want|need|for|to|ako|branch|office|department)\b.*$/i;
  return m[1].replace(stop, "").replace(/[.,!?]+$/, "").trim().slice(0, 50);
}
function needFrom(text) {
  const t = String(text || "").toLowerCase();
  if (/\b(follow ?up|status|update|delivery|deliver|ni-?follow|kailan (darating|dadating)|when will|still waiting|naghihintay)\b/.test(t)) return "followup";
  if (/\btoners?\b/.test(t)) return "toner";
  if (/\bcartridges?\b/.test(t)) return "cartridge";
  if (/\b(inks?|tinta)\b/.test(t)) return "ink";
  if (/\b(repair|fix|broken|sira|jam|jammed|not printing|error|service|technician|maintenance|ayaw|problem|issue|check(up)?)\b/.test(t)) return "service";
  return "";
}
function conditionFrom(text) {
  const t = String(text || "").toLowerCase();
  if (/\bbest mode\b/.test(t)) return 4;
  if (/\b(not|isn'?t|is not|won'?t|doesn'?t|does not|can'?t|cannot|hindi|ayaw|di)\s+(\w+\s+){0,3}(print|printing|work|working|turn|on|gumagana|nagpi-?print|nag ?print|mag ?print)|\b(dead|down|sira|no print|patay)\b/.test(t)) return 3;
  if (/\b(streak|streaks|lines?|faded|fade|blur|blurry|smudge|smudges|jam|jamming|problem|issue|light|spots?|malabo|guhit|kupas|error)\b/.test(t)) return 2;
  if (/\b(working|works|okay|ok|fine|normal|good|maayos|gumagana|running|spare|reserve|stock|nagpi-?print|printing)\b/.test(t)) return 1;
  return 0;
}
const CONDITION_LABEL = { 1: "working normally", 2: "printing with a problem", 3: "not printing", 4: "printing in best mode only" };

async function sealionJSON(prompt) {
  const url = process.env.VOICE_DIRECTOR_LLM_URL || "http://192.168.100.105:8090/v1/chat/completions";
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(7000),
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }], temperature: 0, max_tokens: 120 }) });
    const data = await res.json();
    const text = String(data?.choices?.[0]?.message?.content || "");
    const m = text.match(/\{[\s\S]*\}/);
    return m ? JSON.parse(m[0]) : null;
  } catch { return null; }
}

/* ------------------- understanding the caller + speaking naturally ------------------- */
// SEA-LION reads what the caller MEANT (code still decides the step), and says each line in its own
// natural words (code still decides what is said). Lists, numbers, emails and summaries stay exact.
async function sealionText(prompt, maxTokens = 90, ms = 3500) {
  const url = process.env.VOICE_DIRECTOR_LLM_URL || "http://192.168.100.105:8090/v1/chat/completions";
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, signal: AbortSignal.timeout(ms),
      body: JSON.stringify({ messages: [{ role: "user", content: prompt }], temperature: 0.4, max_tokens: maxTokens }) });
    const data = await res.json();
    return String(data?.choices?.[0]?.message?.content || "").trim();
  } catch { return ""; }
}
/**
 * Mediator (Mike 2026-10-23): the AI reads every detail the caller mentioned in this sentence — not only the
 * answer to the current question — and hands them to the Director as candidates. The Director validates each
 * one (records, formats) and keeps only valid required fields.
 */
async function mediate(question, text, lang) {
  if (!text) return {};
  const raw = await sealionText(`You help a phone assistant. Read what the caller said and pull out every detail they gave.\n` +
    `The assistant had asked: "${question || "(start of call)"}"\nThe caller said: "${text}"\n` +
    `Reply ONLY JSON. Include ONLY the keys the caller actually gave (copy their own words, never guess). Possible keys:\n` +
    `{"intent":"answer|dont_know|wants_list|wants_count|yes|no|repeat|question|other","pick":null,` +
    `"name":null,"serial":null,"company":null,"branch":null,"model":null,"need":"ink|toner|cartridge|service|followup|null",` +
    `"items":null,"condition":null,"problem":null,"phone":null,"email":null}\n` +
    `intent: dont_know = they do not know / cannot find it / it is not there; wants_list = they ask you to read the options; wants_count = they ask how many. ` +
    `pick = the number of the option they chose ("the second one" = 2). items = quantities and colours of ink/toner ("two cyan"). ` +
    `condition = how the machine is working. problem = what is wrong with the machine. phone = the phone number words or digits. email = the email words. Always include intent.`, 120, 3500);
  try { const m = raw.match(/\{[\s\S]*\}/); const j = m ? JSON.parse(m[0]) : {}; for (const k of Object.keys(j)) if (j[k] === "null" || j[k] === "") j[k] = null; return j; } catch { return {}; }
}
async function understand(question, text) {
  if (!question || !text) return {};
  const raw = await sealionText(`A caller on a phone line was asked: "${question}"\nThe caller answered: "${text}"\n` +
    `What does the caller mean? Reply ONLY JSON {"intent":"answer|dont_know|wants_list|wants_count|yes|no|repeat|question|other","pick":null}.\n` +
    `answer = they gave the information asked. dont_know = they do not know it, cannot find it, it is not there, no sticker. ` +
    `wants_list = they ask you to tell / read / give the options, list, branches, departments or models. wants_count = they ask how many there are. ` +
    `yes / no = a plain yes or no. repeat = they did not hear. pick = the number of the option they chose ("the second one" = 2), else null.`, 60, 3000);
  try { const m = raw.match(/\{[\s\S]*\}/); return m ? JSON.parse(m[0]) : {}; } catch { return {}; }
}
const GOALS = {
  name: () => "do NOT greet again (you already greeted them); acknowledge in a few words what they said they need, then ask for their name",
  nameAgain: () => "say you did not catch their name and ask for it again",
  serial: (a) => `thank them, using "${a}", and ask if they have the serial number of the machine (it is on a sticker on the machine)`,
  serialAgain: () => "ask them to say the serial number slowly, one letter or number at a time",
  serialNotFound: () => "say you could not find that serial number in the records, and ask for their company name",
  company: (a) => `say that is fine${a ? `, using "${a}"` : ""}, and ask for their company name`,
  companyAgain: () => "say you could not find that company in the records and ask them to say the company name again",
  companyIs: (c) => `ask if their company is ${c}`,
  branch: (c) => `say you found ${c} in the records, and ask which branch or department the machine is in (they can also give the address)`,
  branchAgain: () => "say you did not find that one, and ask which branch or department it is, or the city or building of the machine",
  branchIs: (b) => (b === "main office" ? "ask if the machine is at their main office" : `ask if the machine is at the ${b} branch`),
  branchAddress: () => "say that is okay, and ask for the address, the city or the building where the machine is",
  branchTie: (n) => `say there are ${n} branches with that name, and ask which printer model it is (written on the front of the machine)`,
  model: () => "ask which printer model it is (the model is written on the front of the machine)",
  modelIs: (m) => `ask if it is the ${m}`,
  identity: (c, b, m) => `confirm the request is for ${c}, ${b}, the ${m}, and ask if that is correct`,
  need: (a) => `ask${a ? ` ${a}` : ""} what they need today, for example ink, toner or a repair`,
  items: (k) => `ask how many ${k} they need and which colours`,
  itemsColor: (k) => `ask which colour of ${k} they need`,
  itemsQty: (c) => `ask how many ${c} they need`,
  problem: () => "ask what the problem with the machine is",
  condition: () => "ask, as an open question (not yes/no), how the machine is working right now",
  conditionAgain: () => "ask if it is printing normally, printing with a problem, or not printing at all",
  phone: () => "ask for the best phone number to reach them",
  phoneAgain: () => "say you did not get the complete number and ask them to say it again, one digit at a time",
  email: () => "ask for the email address where the updates should be sent",
  emailAgain: () => "say you did not get the email and ask them to say it again slowly, for example juan dot cruz at gmail dot com",
  change: () => "ask what they would like to change",
  openAgain: () => "ask if that open request is still needed, already done, or no longer needed",
  yesNo: () => "kindly ask whether that was a yes or a no",
  repeat: (last) => `they did not hear you: say again, slowly and simply, what you just asked ("${last}")`,
  branchList: (c, n, items, more) => `tell them you have ${n} branches for ${c}, read them in this order with their numbers: ${items}${more ? " (and say there are a few more)" : ""}; then ask which one is theirs`,
  modelList: (b, items) => `tell them the printers you have at ${b}, with their numbers: ${items}; then ask which one it is`,
  phoneCaller: (d) => `ask if the number they are calling from is the best one to reach them; say the number digit by digit exactly like this: ${d}`,
  phoneConfirm: (d) => `read back the number digit by digit exactly like this: ${d}, and ask if it is correct`,
  emailConfirm: (e) => `read back the email as normal words, exactly like this: ${e}, and ask if it is correct (do not spell it letter by letter)`,
  emailKnown: (e) => `ask if the updates can go to the email we already have for them: ${e} (say it as normal words exactly like this, not letter by letter)`,
  spellEmail: (e) => `spell the email slowly, letter by letter, exactly like this: ${e}; then ask if it is correct`,
  emailLetters: (l) => `say you got these letters so far: ${l}; ask them to continue spelling, and to finish with the part after "at" (for example at yahoo dot com)`,
  emailOnFile: () => "say that is okay: the updates will go to the email the company has on file for their branch",
  summary: (what, m, cond, d) => `confirm the request briefly: ${what} for their ${m}; their machine is ${cond}; WE will contact THEM at ${d} (say the number digit by digit exactly). Then ask if you should submit it`,
  summaryFollow: (m, d) => `confirm they are following up on their request for their ${m} and that OUR team will update THEM at ${d} (digit by digit exactly). Then ask if you should pass it to the team`,
  saved: (ref) => (ref ? `say the request is saved; give the reference number exactly like this: ${ref}; say it will also be sent by text and email; then ask if there is anything else` : "say the request is saved and the reference number will be sent by text and email; then ask if there is anything else"),
  passed: () => "say you saved all their details and flagged the request as urgent to the team (do not promise a call back); then ask if there is anything else",
  followPassed: () => "say you flagged their follow-up as urgent to the team (do not promise a call back); then ask if there is anything else",
  error: () => "say sorry, the system could not save the request right now, and that you flagged it as urgent to the team with all their details (do not promise a call back); then ask if there is anything else",
  anything: () => "thank them for calling and say goodbye warmly",
  openAsk: (what) => `before continuing, tell them they still have an open request for ${what}, and ask if it is still needed, already done, or no longer needed`
};
// Words that must appear in Anne's line for each step (names, company, models). Missing -> the fixed line is used.
const KEEP = {
  serial: (a) => [a], company: (a) => (a ? [a] : []), companyIs: (c) => [c], branch: (c) => [c],
  branchIs: (b) => (b === "main office" ? ["main office"] : [b]), modelIs: (m) => [m], identity: (c, b, m) => [b, m],
  items: (k) => [k], itemsColor: (k) => [k], need: (a) => (a ? [a] : []),
  branchList: (c, n, items) => items.split(";").map((x) => x.replace(/^\s*\d+,\s*/, "").split(",")[0].trim()).filter(Boolean),
  modelList: (b, items) => items.split(";").map((x) => x.replace(/^\s*\d+,\s*(the\s+)?/i, "").trim()).filter(Boolean),
  phoneCaller: (d) => [d], phoneConfirm: (d) => [d], emailConfirm: (e) => [e], emailKnown: (e) => [e], spellEmail: (e) => [e], emailLetters: (l) => [l],
  summary: (what, m, cond, d) => [m, d, ...String(what).split(/\s+and\s+|\s+at\s+/).map((x) => x.trim())], summaryFollow: (m, d) => [m, d], saved: (ref) => (ref ? [ref] : []),
  openAsk: (what) => [String(what).split(/[ ,]/).filter((w) => w.length > 2).slice(-2).join(" ")]
};
// Every reply is written by the AI from a nudge. A backup sentence is used only when SEA-LION does not answer.
// What each step's reply must be ABOUT (the Director checks the AI asked the right thing).
const TOPIC = {
  name: /\b(name|pangalan)\b/i, nameAgain: /\b(name|pangalan)\b/i, serial: /\bserial\b/i, serialAgain: /\bserial\b/i,
  company: /\b(company|kumpanya|kompanya)\b/i, companyAgain: /\b(company|kumpanya|kompanya)\b/i, serialNotFound: /\b(company|kumpanya|kompanya)\b/i,
  branch: /\b(branch|department|address|sangay|departamento)\b/i, branchAgain: /\b(branch|department|address|city|building)\b/i,
  branchAddress: /\b(address|city|building|lungsod)\b/i, model: /\bmodel\b/i, items: /\b(how many|how much|ilan|colou?rs?|kulay)\b/i,
  itemsColor: /\b(colou?rs?|kulay)\b/i, itemsQty: /\b(how many|how much|ilan)\b/i, problem: /\b(problem|issue|wrong|problema|sira|nangyari)\b/i,
  condition: /\b(work|working|print|printing|gumagana|nagpi-?print|kumusta)\b/i, conditionAgain: /\b(print|printing|nagpi-?print)\b/i,
  phone: /\b(number|numero|contact)\b/i, phoneAgain: /\b(number|numero|digit)\b/i, email: /\b(email|e-mail)\b/i, emailAgain: /\b(email|e-mail|spell)\b/i, emailKnown: /\b(email|e-mail|updates|send)\b/i,
  need: /\b(need|kailangan|help|tulong)\b/i, openAsk: /\b(still|needed|done|kailangan|tapos)\b/i, openAgain: /\b(still|needed|done|kailangan|tapos)\b/i,
  identity: /\b(correct|right|tama|tamang)\b/i
};
const PROMISE = /\b(call you back|we'?ll call|we will call|someone will call|tatawag(an)?|babalikan|will contact you shortly|technician will (come|visit)|deliver(ed)? (today|tomorrow))\b/i;
function reviewReply(out, { key, goal, keep, line }) {
  const why = [];
  if (TOPIC[key] && !TOPIC[key].test(out)) why.push(`it did not ask about what you were told to ask (${goal})`);
  const allowed = `${goal} ${keep.join(" ")} ${line}`;
  for (const n of out.match(/\d+/g) || []) if (!allowed.includes(n)) why.push(`it contains the number ${n}, which you were not given`);
  if (PROMISE.test(out) && !/call|contact|deliver/i.test(goal)) why.push("it promises something you were not told to promise");
  if ((out.match(/\?/g) || []).length > 1) why.push("it asks more than one question");
  if (/\b(contact|call|reach|update|email|text) (them|him|her)\b/i.test(out) || /\bwill contact us\b/i.test(out)) why.push("talk TO the caller: say 'we will contact you', never 'them' or 'us'");
  return why;
}
async function natural(line, { key, args, heard, lang, company, prev, first, history, address }) {
  let goal = GOALS[key] ? GOALS[key](...(args || [])) : null;
  if (!goal) return line;
  if (first) goal = `first tell them ${first}, then ${goal}`;
  const long = ["branchList", "modelList", "summary", "summaryFollow", "saved"].includes(key);
  const keep = (KEEP[key] ? KEEP[key](...(args || [])) : []).filter(Boolean);
  const prompt = `You are Anne, a warm and friendly phone assistant of ${company || "the company"}, speaking on a live phone call.\n` +
    `Speak ${lang === "tl" ? "Taglish (mostly Tagalog, polite, with po)" : "natural, simple English"}, like a real person on the phone: short, warm, never stiff.\n` +
    (history ? `The call so far:\n${history}\n` : (prev ? `What you said last: "${prev}"\n` : "")) +
    `The caller just said: "${heard || ""}"\n` +
    `What you must do now: ${goal}.\n` +
    (keep.length ? `Use these exactly: ${keep.join(", ")}.\n` : "") +
    (address ? `Address the caller as "${address}" in this reply (once, naturally).\n` : "") +
    `${key === "anything" ? "Do not ask any question." : "Ask only ONE question."}${long ? " Keep it short and clear." : " At most 2 short sentences. Do not read lists."} ` +
    `You are in the middle of the call: never say hi or hello. Say items, models and numbers exactly as given — do not add words like cartridge or bottle. ` +
    `Do not promise anything that is not in your task. Do not repeat what you said last word for word. Reply with what you say, nothing else.`;
  let feedback = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const out = (await sealionText(prompt + feedback, long ? 160 : 80, long ? 4500 : 3000)).replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ");
    if (!out || out.length > (long ? 520 : 260) || /\{|\}|what you must do|caller just said|the call so far/i.test(out)) { feedback = "\nYour previous answer was not usable. Reply with only what you say to the caller."; continue; }
    const norm = (t) => String(t).toLowerCase().replace(/[,.;:!?'"’-]/g, " ").replace(/\s+/g, " ").trim();
    const low = norm(out);
    const why = reviewReply(out, { key, goal, keep, line });
    if (/\?\s*$/.test(line) && !out.includes("?")) why.push("it must end with the question");
    const missing = keep.filter((w) => !low.includes(norm(w)));
    if (missing.length) why.push(`it must say exactly: ${missing.join(", ")}`);
    if (!why.length) return out;
    console.log("[voice-director] reply sent back (step %s): %s | %s", key, why.join("; "), out.slice(0, 120));
    feedback = `\nYour previous answer was: "${out}". It was rejected because ${why.join("; ")}. Write it again correctly.`;
  }
  console.warn("[voice-director] AI reply not usable for step %s — backup sentence used", key);
  return first ? `${line}` : line;
}
const ORDINAL = { first: 1, "1st": 1, one: 1, una: 1, isa: 1, unang: 1, second: 2, "2nd": 2, two: 2, pangalawa: 2, dalawa: 2, ikalawa: 2, third: 3, "3rd": 3, three: 3, pangatlo: 3, tatlo: 3, ikatlo: 3,
  fourth: 4, "4th": 4, four: 4, "pang-apat": 4, apat: 4, fifth: 5, "5th": 5, five: 5, lima: 5, sixth: 6, "6th": 6, six: 6, anim: 6 };
const ORDINAL_WORDS = { first: 1, "1st": 1, una: 1, unang: 1, second: 2, "2nd": 2, pangalawa: 2, ikalawa: 2, third: 3, "3rd": 3, pangatlo: 3, ikatlo: 3,
  fourth: 4, "4th": 4, "pang-apat": 4, ikaapat: 4, fifth: 5, "5th": 5, panglima: 5, sixth: 6, "6th": 6, pang_anim: 6 };
const CARDINAL_WORDS = { one: 1, isa: 1, two: 2, dalawa: 2, three: 3, tatlo: 3, four: 4, apat: 4, five: 5, lima: 5, six: 6, anim: 6 };
function pickNumber(text, n) {
  const t = String(text || "").toLowerCase();
  // "the second one" = 2: ordinals first, then "number two" / a bare "two" / "2"
  for (const [w, v] of Object.entries(ORDINAL_WORDS)) if (new RegExp(`(^|[^a-z0-9])${w}([^a-z0-9]|$)`).test(t) && v <= n) return v;
  if (/\b(last|huli)\b/.test(t)) return n;
  const m = t.match(/\b(\d)\b/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= n) return Number(m[1]);
  const short = t.replace(/[^a-z\s]/g, " ").split(/\s+/).filter(Boolean);
  const numbered = t.match(/\b(?:number|no|option|yung|ang|sa)\s+(one|isa|two|dalawa|three|tatlo|four|apat|five|lima|six|anim)\b/);
  if (numbered) { const v = CARDINAL_WORDS[numbered[1]]; if (v <= n) return v; }
  if (short.length <= 3) for (const w of short) if (CARDINAL_WORDS[w] && CARDINAL_WORDS[w] <= n) return CARDINAL_WORDS[w];
  return 0;
}
const WANTS_LIST = /\b(list|options|choices|tell me (the|what|which)|read (them|the)|what are (the|they|your)|which (ones|branches|departments)|how many|ilan|ano(-| )?ano|anu-ano|sabihin mo|i can choose|let me choose|give me the)\b/i;
const SPELL_EARLY = /\b(spell|letter by letter|isa-?isahin)\b/i;
const NOT_THERE = /\b(not there|isn'?t there|not here|wala dito|walang sticker|no sticker|can'?t find|cannot find|don'?t see|can'?t see|cannot see|faded|tanggal|natanggal)\b/i;

/* --------------------------------- the lines --------------------------------- */
const LINES = {
  en: {
    name: () => "May I know your name, please?",
    nameAgain: () => "Sorry, I didn't catch your name. May I know your name, please?",
    serial: (a) => `Thank you, ${a}. Do you have the serial number of the machine? It is on the sticker on the machine.`,
    serialAgain: () => "Please say the serial number one letter or number at a time.",
    serialNotFound: () => "I couldn't find that serial number in our records. What is your company name?",
    company: (a) => `No problem${a ? `, ${a}` : ""}. What is your company name?`,
    companyAgain: () => "Sorry, I couldn't find that company in our records. Could you say the company name again, please?",
    companyIs: (c) => `Is that ${c}?`,
    branch: (c) => `I have ${c} in our records. Which branch or department is the machine in? You can also tell me the address.`,
    branchAgain: () => "Sorry, I didn't find that one. Which branch or department is it? Or the city or building where the machine is.",
    branchIs: (b) => b === "main office" ? "Is it your main office?" : `Is it the ${b} branch?`,
    model: () => "Which printer model is it? The model is written on the front of the machine.",
    branchTie: (n) => `We have ${n} branches with that name. Which printer model is it? The model is written on the front of the machine.`,
    branchList: (c, n, items, more) => `We have ${n} branches for ${c}: ${items}${more ? ", and a few more" : ""}. Which one is yours?`,
    branchAddress: () => "No problem. Can you tell me the address, the city, or the building where the machine is?",
    modelList: (b, items) => `At ${b} we have ${items}. Which one is it?`,
    yesNo: () => "Sorry, is that a yes or a no?",
    modelIs: (m) => `Is it the ${m}?`,
    identity: (c, b, m) => `So this is for ${c}, ${b}, the ${m}. Is that correct?`,
    need: (a) => `Thank you${a ? `, ${a}` : ""}. What do you need today? For example ink, toner, or a repair.`,
    items: (k) => `How many ${k} do you need, and in which colours?`,
    itemsColor: (k) => `Which colour of ${k} do you need?`,
    itemsQty: (c) => `How many ${c} do you need?`,
    problem: () => "What is the problem with the machine?",
    condition: () => "How is the machine working right now?",
    conditionAgain: () => "Is it printing normally, printing with a problem, or not printing at all?",
    phoneCaller: (d) => `Is ${d} the best number to reach you?`,
    phone: () => "What is the best number to reach you?",
    phoneAgain: () => "Sorry, I didn't get the complete number. Please say it again, one digit at a time.",
    phoneConfirm: (d) => `That is ${d}. Is that correct?`,
    email: () => "What email address should we send the updates to?",
    emailAgain: () => "Sorry, I didn't get the email. Please say it again, for example juan dot cruz at gmail dot com.",
    emailConfirm: (e) => `That is ${e}. Is that correct?`,
    emailOnFile: () => "That's okay. We will send the updates to the email we have on file for your branch.",
    emailKnown: (e) => `Can we send the updates to ${e}?`,
    spellEmail: (e) => `Sure. It is ${e}. Is that correct?`,
    emailLetters: (l) => `I have ${l} so far. Please continue, and end with the part after at.`,
    summary: (what, m, cond, d) => `Let me confirm: ${what} for your ${m}, and the machine is ${cond}. We will contact you at ${d}. Shall I submit this request?`,
    summaryFollow: (m, d) => `Let me confirm: you are following up on your request for the ${m}. Our team will update you at ${d}. Shall I pass this to our team?`,
    saved: (ref) => `Done. Your request is saved.${ref ? ` Your reference number is ${ref}.` : ""} We will also send it to you by text and email. Is there anything else?`,
    passed: () => "Thank you. I have saved all your details and flagged your request as urgent to our team. Is there anything else?",
    followPassed: () => "Thank you. I have flagged your follow-up as urgent to our team. Is there anything else?",
    change: () => "Okay. What would you like to change?",
    anything: () => "Thank you for calling Marga Enterprises. Have a nice day!",
    error: () => "Sorry, our system could not save your request right now. I have flagged it as urgent to our team with all your details. Is there anything else?",
    openAsk: (what) => `Before we continue: you still have an open request for ${what}. Is it still needed, already done, or no longer needed?`,
    openAgain: () => "Is that request still needed, already done, or no longer needed?",
    openKept: () => "Okay, that request stays open.",
    openDone: () => "Thank you, I have marked it as done.",
    openCancelled: () => "Okay, I have cancelled it."
  },
  tl: {
    name: () => "Ano po ang pangalan nila?",
    nameAgain: () => "Pasensya na po, hindi ko nakuha. Ano po ulit ang pangalan nila?",
    serial: (a) => `Salamat po, ${a}. Meron po ba kayong serial number ng machine? Nasa sticker po ito ng machine.`,
    serialAgain: () => "Pakisabi po ulit ang serial number, isa-isang letra o numero.",
    serialNotFound: () => "Hindi ko po makita ang serial number na iyon sa records namin. Ano po ang pangalan ng company ninyo?",
    company: (a) => `Okay lang po${a ? `, ${a}` : ""}. Ano po ang pangalan ng company ninyo?`,
    companyAgain: () => "Pasensya na po, hindi ko po makita ang company na iyon. Pakisabi po ulit ang pangalan ng company?",
    companyIs: (c) => `${c} po ba?`,
    branch: (c) => `Nakita ko po ang ${c} sa records namin. Saang branch o department po ang machine? Pwede rin po ang address.`,
    branchAgain: () => "Pasensya na po, hindi ko po nakita. Saang branch o department po ito? O saang city o building ang machine?",
    branchIs: (b) => b === "main office" ? "Sa main office po ba ninyo?" : `Sa ${b} branch po ba?`,
    model: () => "Anong model po ang printer? Nakasulat po ito sa harap ng machine.",
    branchTie: (n) => `May ${n} branch po kami na ganyan ang pangalan. Anong model po ang printer? Nakasulat po ito sa harap ng machine.`,
    branchList: (c, n, items, more) => `May ${n} branch po kami para sa ${c}: ${items}${more ? ", at iba pa" : ""}. Alin po doon ang sa inyo?`,
    branchAddress: () => "Okay lang po. Pwede po bang sabihin ang address, city, o building kung nasaan ang machine?",
    modelList: (b, items) => `Sa ${b} po, meron kaming ${items}. Alin po doon?`,
    yesNo: () => "Pasensya na po, oo po ba o hindi?",
    modelIs: (m) => `Ang ${m} po ba?`,
    identity: (c, b, m) => `Para po sa ${c}, ${b}, ang ${m}. Tama po ba?`,
    need: (a) => `Salamat po${a ? `, ${a}` : ""}. Ano po ang kailangan ninyo ngayon? Halimbawa po ink, toner, o repair.`,
    items: (k) => `Ilang ${k} po ang kailangan, at anong kulay?`,
    itemsColor: (k) => `Anong kulay po ng ${k}?`,
    itemsQty: (c) => `Ilan pong ${c}?`,
    problem: () => "Ano po ang problema ng machine?",
    condition: () => "Kumusta po ang machine ngayon, gumagana po ba?",
    conditionAgain: () => "Normal po ba ang print, may problema sa print, o hindi na po nagpi-print?",
    phoneCaller: (d) => `Itong ${d} po ba ang pinakamagandang number para makontak kayo?`,
    phone: () => "Ano po ang number na pwede naming tawagan?",
    phoneAgain: () => "Pasensya na po, hindi ko nakuha ang buong number. Pakisabi po ulit, isa-isang digit.",
    phoneConfirm: (d) => `${d} po. Tama po ba?`,
    email: () => "Saang email po namin ipapadala ang updates?",
    emailAgain: () => "Pasensya na po, hindi ko nakuha ang email. Pakisabi po ulit, halimbawa juan dot cruz at gmail dot com.",
    emailConfirm: (e) => `${e} po. Tama po ba?`,
    emailOnFile: () => "Okay lang po. Ipapadala po namin ang updates sa email na naka-file sa branch ninyo.",
    emailKnown: (e) => `Pwede po ba naming ipadala ang updates sa ${e}?`,
    spellEmail: (e) => `Sige po. Ito po ay ${e}. Tama po ba?`,
    emailLetters: (l) => `Nakuha ko po ang ${l}. Pakituloy po, at tapusin sa part pagkatapos ng at.`,
    summary: (what, m, cond, d) => `Kumpirmahin ko lang po: ${what} para sa ${m}, at ang machine ay ${cond}. Kokontakin po namin kayo sa ${d}. I-submit ko na po ba?`,
    summaryFollow: (m, d) => `Kumpirmahin ko lang po: nag-fofollow up po kayo sa request para sa ${m}. Ia-update po kayo ng team namin sa ${d}. Ipapasa ko na po ba?`,
    saved: (ref) => `Tapos na po. Naka-save na ang request ninyo.${ref ? ` Ang reference number po ay ${ref}.` : ""} Ipapadala rin po namin ito sa text at email. May iba pa po ba?`,
    passed: () => "Salamat po. Naka-save na po ang lahat ng details ninyo at na-flag ko na po bilang urgent sa team namin. May iba pa po ba?",
    followPassed: () => "Salamat po. Na-flag ko na po bilang urgent sa team ang follow-up ninyo. May iba pa po ba?",
    change: () => "Sige po. Ano po ang gusto ninyong baguhin?",
    anything: () => "Salamat po sa pagtawag sa Marga Enterprises. Ingat po!",
    error: () => "Pasensya na po, hindi ma-save ng system ang request ngayon. Na-flag ko na po bilang urgent sa team kasama ang lahat ng details ninyo. May iba pa po ba?",
    openAsk: (what) => `Bago po tayo magpatuloy: may bukas pa po kayong request para sa ${what}. Kailangan pa po ba ito, tapos na po ba, o hindi na kailangan?`,
    openAgain: () => "Kailangan pa po ba ang request na iyon, tapos na po ba, o hindi na kailangan?",
    openKept: () => "Sige po, mananatiling bukas ang request na iyon.",
    openDone: () => "Salamat po, na-mark ko na pong tapos.",
    openCancelled: () => "Sige po, na-cancel ko na po."
  }
};
const CONDITION_TL = { 1: "gumagana nang normal", 2: "may problema sa print", 3: "hindi nagpi-print", 4: "best mode lang nagpi-print" };

function sayReference(ref) { // SR-2026-000010 -> "S R, two zero two six, zero zero zero zero one zero"
  const m = String(ref || "").match(/^([A-Z]+)-?(\d+)-?(\d+)$/i);
  if (!m) return String(ref || "");
  const plain = (d) => String(d).split("").map((c) => DIGIT_WORDS[Number(c)]).join(" ");
  return `${m[1].toUpperCase().split("").join(" ")}, ${plain(m[2])}, ${plain(m[3])}`;
}
function sayBranch(branch, company) { // "Bosch Inc. - Additional" -> "Additional"; same as company -> "main office"
  const b = String(branch || "").trim(), c = String(company || "").trim();
  if (!b) return "";
  let rest = c && b.toLowerCase().startsWith(c.toLowerCase()) ? b.slice(c.length) : b;
  rest = rest.replace(/^[\s,.\-–—]+/, "").trim();
  return rest || "main office";
}
function sayModel(model) { // "HP3035" -> "H P thirty thirty-five" is done by Pitch; keep letters spaced for clarity
  return String(model || "").replace(/-/g, " ").trim();
}


/* ------------------------------ call order (tenant panel) ------------------------------ */
// Steps of a phone request. Defaults = Mike's order. A step whose field the business's system REQUIRES to
// save (its action's input_schema.required) cannot be switched off. Open requests always come after identity.
const CALL_STEPS = [
  { key: "name", label: "Caller's name", fields: ["callername"] },
  { key: "identity", label: "Identify the machine (serial, or company + branch / department)", fields: ["customerid", "branchid", "machineid"] },
  { key: "open_requests", label: "Open requests on that machine (still needed, done, cancel)", fields: [] },
  { key: "need", label: "What they need (ink / toner: how many + colours; repair: what is wrong)", fields: ["category", "description"] },
  { key: "condition", label: "Machine condition", fields: ["fieldworkmachinestatusid"] },
  { key: "phone", label: "Contact number (read back digit by digit)", fields: ["callerphone"] },
  { key: "email", label: "Email for updates (read back)", fields: ["calleremail"] }
];
function requiredSteps(flow) {
  const req = new Set(flow?.action?.input_schema?.required || []);
  return CALL_STEPS.filter((s) => s.key === "identity" || s.key === "need" || s.fields.some((f) => req.has(f))).map((s) => s.key);
}
function callOrder(pitchCfg, flow) {
  const saved = Array.isArray(pitchCfg?.call_order) ? pitchCfg.call_order : [];
  const required = new Set(requiredSteps(flow));
  const known = new Set(CALL_STEPS.map((s) => s.key));
  let keys = saved.map((x) => x && x.key).filter((k) => known.has(k));
  for (const s of CALL_STEPS) if (!keys.includes(s.key)) keys.push(s.key);
  const on = {};
  for (const k of keys) { const row = saved.find((x) => x && x.key === k); on[k] = required.has(k) || !row || row.on !== false; }
  // open requests need a known machine: always after identity
  if (keys.indexOf("open_requests") < keys.indexOf("identity")) { keys = keys.filter((k) => k !== "open_requests"); keys.splice(keys.indexOf("identity") + 1, 0, "open_requests"); }
  return { steps: keys.filter((k) => on[k]), on, serial_first: pitchCfg?.call_serial_first !== false, required: [...required] };
}
/* ---------------------------------- engine ----------------------------------- */
async function loadState(conversation) {
  const fresh = await prisma.conversation.findUnique({ where: { id: conversation.id }, select: { customer_profile: true, ai_history_from: true } });
  const profile = fresh?.customer_profile || {};
  // One call = turns less than 5 minutes apart (same rule as the fresh start in /api/internal/pitch/turn).
  // Not keyed to ai_history_from: saving a request moves that marker in the middle of the call.
  const vc = profile.voice_call;
  const st = vc && vc.at && Date.now() - Number(vc.at) < 5 * 60 * 1000 ? vc : { stage: "start", tries: {} };
  return { st, profile };
}
async function saveState(conversationId, st) {
  const fresh = await prisma.conversation.findUnique({ where: { id: conversationId }, select: { customer_profile: true } });
  st.at = Date.now();
  await prisma.conversation.update({ where: { id: conversationId }, data: { customer_profile: { ...(fresh?.customer_profile || {}), voice_call: st } } }).catch(() => {});
}

// Sir / Ma'am + first name (Settings > Channels > Mobile Phone: "Address callers as Sir / Ma'am", default on).
async function titleFor(first, useTitles) {
  const low = String(first || "").toLowerCase();
  if (!useTitles) return "";
  if (MEN.has(low)) return "Sir";
  if (WOMEN.has(low)) return "Ma'am";
  const g = await sealionJSON(`In the Philippines, is "${first}" more likely a man's or a woman's first name? You MUST choose one. Reply only JSON: {"title":"Sir"} for a man or {"title":"Ma'am"} for a woman.`);
  const raw = String(g?.title || "").toLowerCase();
  return /ma'?am|mam|woman/.test(raw) ? "Ma'am" : "Sir";
}

/**
 * One caller turn. Returns { reply } or null when the voice script does not apply (no service flow).
 */
async function turn({ conversation, companyId, message, caller }) {
  const flows = await require("./director").loadFlows(companyId);
  const flow = flows.find((f) => f.key === FLOW);
  if (!flow) return null;
  const phoneRow = await prisma.tenantChannel.findFirst({ where: { company_id: companyId, channel_key: "mobile_phone" }, select: { config: true } }).catch(() => null);
  const instructions = String(phoneRow?.config?.instructions || phoneRow?.config?.pitch?.instructions || "");
  const { st } = await loadState(conversation);
  const text = String(message || "").trim();
  const companyName = (await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }).catch(() => null))?.name || "";
  const call = (key, args) => be.executeBusinessEngineTool({ companyId, conversationId: conversation.id, name: tool(key), args, requestedBy: "voice_director" });
  // Anything the call cannot finish: urgent email + text to the business, repeated until handled (src/escalations.js).
  const escalate = (title, extra = {}) => require("./escalations").raise({ companyId, conversationId: conversation.id, title,
    details: { "Caller": st.callername || st.name || "", "Contact number": st.phone || String(caller || ""), "Email": st.email || "",
      "Company": st.customer?.name || st.company_q || "", "Branch / department": st.branch?.name || st.location_said || "",
      "Machine": st.machine ? `${st.machine.model || ""} — serial ${st.machine.serial || ""}` : "", "Need": st.need || "",
      "Items": (st.items || []).map((i) => `${i.quantity} ${i.unit || "pc"} ${i.item}`).join(", "), "Problem": st.problem || "",
      "Machine condition": CONDITION_LABEL[st.condition] || "", ...extra } }).catch((e) => console.error("[voice-director] escalation failed: %s", e.message));

  // Language: Tagalog when the caller speaks it (sticky); an explicit request wins.
  if (/\b(english|ingles)\b/i.test(text) && text.length < 80) st.lang = "en";
  else if (/\b(tagalog|filipino)\b/i.test(text) && text.length < 80) st.lang = "tl";
  else if (!st.lang_fixed && (text.match(TAGALOG) || []).length >= 2) st.lang = "tl";
  if (/\b(english|ingles|tagalog|filipino)\b/i.test(text) && text.length < 80) st.lang_fixed = true;
  const L = LINES[st.lang === "tl" ? "tl" : "en"];
  const say = async (line) => {
    st.last_line = line; st.hist = [...(st.hist || []), { who: "Anne", text: line }].slice(-10);
    const label = st.asr_label || null; st.asr_label = null;
    await saveState(conversation.id, st);
    return { reply: line, asr: asrFor(st), asr_label: label };
  };
  if (text) st.hist = [...(st.hist || []), { who: "Caller", text }].slice(-10);

  // Speech-to-text noise: on silence it can echo its hint words ("Toner, ink, printer, copier, Ricoh ...").
  {
    const hints = new Set([...(phoneRow?.config?.pitch?.asr_words || []), "toner", "ink", "printer", "copier", "ricoh", "brother", "canon", "konica", "epson", "serial", "number", "paper", "jam"].map((w) => String(w).toLowerCase()));
    const ws = text.toLowerCase().match(/[a-z]+/g) || [];
    if (ws.length >= 5 && ws.filter((w) => hints.has(w)).length / ws.length >= 0.6 && st.last_line) { st.hist.pop(); st._repeat_now = true; }
  }
  if (st.ask && REPEAT.test(text) && st.last_line && !(SPELL_EARLY.test(text) && ["emailConfirm", "emailKnown"].includes(st.ask?.k)) && !parseEmail(text) && !spelledLetters(text) && !(digitsIn(text).length >= 7)) st._repeat_now = true;
  if (st.ask && /^\s*(english|ingles|tagalog|filipino)( please| po)?\W*$/i.test(text) && st.ask) return say(L[st.ask.k](...(st.ask.a || [])));

  // Opportunistic: what the caller already said is kept, never asked again.
  if (!st.need) st.need = needFrom(text) || "";
  if (!st.company_q && !st.customer) { const c = cleanCompany(companyFrom(text)); if (c.length >= 3) st.company_q = c; }
  if (!st.name) { const n = nameFrom(text, false); if (n) st.name = n; }
  // Items only from need-talk (first sentence, the need question) — never from a model, serial or number
  // answer ("MP C three thousand three" is not "3 cyan").
  const needTalk = !st.ask || ["need"].includes(st.ask.k);
  if (needTalk && ["ink", "toner", "cartridge"].includes(st.need) && !st.items && digitsIn(text).length < 3) {
    const p = parseSupplyItems(text, st.need);
    if (p.items?.length) st.items = p.items;
  }

  const talk = async (k, ...a) => {
    let line = L[k] ? L[k](...a) : "";
    st.turns_since_name = (st.turns_since_name || 0) + 1;
    const first = st.first_tell || ""; st.first_tell = "";
    if (process.env.VOICE_NATURAL !== "off") {
      const history = (st.hist || []).slice(-6).map((h) => `${h.who}: ${h.text}`).join("\n");
      const useName = st.address && k !== "name" && k !== "nameAgain" && k !== "anything" && st.turns_since_name >= 2;
      line = await natural(line, { key: k, args: a, heard: text, lang: st.lang, company: companyName, prev: st.last_line, first, history, address: useName ? st.address : "" });
      if (st.address && line.includes(st.address)) st.turns_since_name = 0;
    } else if (first) line = `${first} ${line}`;
    return say(line);
  };
  const ask = async (k, ...a) => { st.ask = { k, a }; return talk(k, ...a); };
  if (st._repeat_now) { st._repeat_now = false; return talk("repeat", st.last_line); }
  const YESNO_Q = ["companyIs", "branchIs", "modelIs", "phoneConfirm", "emailConfirm", "emailKnown", "phoneCaller", "summary", "summaryFollow"];
  const SPELL = /\b(spell|letter by letter|isa-?isahin|i-?spell|say (it|that) again|repeat (it|that))\b/i;
  if (st.stage !== "done" && YESNO_Q.includes(st.ask?.k) && !YES.test(text) && !NO.test(text) && !REPEAT.test(text) && !WANTS_LIST.test(text) && !DONT_KNOW.test(text) && !NOT_THERE.test(text) && !SPELL.test(text) && !(["emailConfirm", "emailKnown"].includes(st.ask?.k) && (parseEmail(text) || spelledLetters(text) || domainFrom(text)))
      && !(["phoneConfirm", "phoneCaller"].includes(st.ask.k) && digitsIn(text).length >= 7) && !(st.ask.k === "emailConfirm" && parseEmail(text))) {
    st.tries.yesno = (st.tries.yesno || 0) + 1;
    if (st.tries.yesno <= 2) return talk("yesNo");
  }
  if (YES.test(text) || NO.test(text)) st.tries.yesno = 0;
  const answer = st.ask?.k || "";   // which question this message answers
  // What the caller MEANT (SEA-LION), only when the plain words are not clear.
  // Mediator reads every detail in the sentence; the Director accepts only valid required fields.
  let meant = {};
  if (text && !(YES.test(text) && text.split(/\s+/).length <= 3) && !(NO.test(text) && text.split(/\s+/).length <= 2)) meant = await mediate(st.last_line || "", text, st.lang);
  const accepted = [], rejected = [];
  {
    const asked = answer;
    // name — only a real name (1-3 words, letters), never while another question is open unless clearly given
    if (!st.name && meant.name && /^[a-zñ][a-zñ'. -]{1,40}$/i.test(String(meant.name).trim()) && String(meant.name).replace(/[^a-zñ]/gi, "").length >= 2 && String(meant.name).trim().split(/\s+/).length <= 3
        && (["name", "nameAgain"].includes(asked) || nameFrom(text, false))) { st.name = capital(String(meant.name).trim()); accepted.push(`name ${st.name}`); }
    // company — kept as a search; the Director checks it against the records in the identity step
    if (!st.customer && !st.company_q && meant.company && !["name", "nameAgain"].includes(asked)) { const c = cleanCompany(meant.company); if (c.length >= 3) st.company_q = c; }
    // serial — accepted only if it is found in the records
    if (!st.machine && !st.identity_ok && meant.serial && !["serial", "serialAgain"].includes(asked)) {
      const cand = spokenDigits(String(meant.serial)).toUpperCase().replace(/[^A-Z0-9]/g, "");
      if (cand.length >= 6 && /\d/.test(cand)) {
        const found = await call("customer_service.find_machine", { serialnumber: cand }).catch(() => null);
        const list = found?.ok ? (found.facts?.machines || []) : [];
        if (list.length === 1 && !found.facts?.fuzzy) {
          const m = list[0];
          st.customer = { id: m.customerId, name: m.customerName };
          st.branch = { id: m.branchId, name: m.branchName, address: m.branchAddress || m.address || "" };
          st.machine = { id: m.id, model: m.model, serial: m.serial, emails: m.emails || [] };
          st.from_serial = true; accepted.push(`the machine from the serial number (${m.customerName})`);
        } else rejected.push("the serial number they said was not found in the records");
      }
    }
    // need
    if (!st.need && ["ink", "toner", "cartridge", "service", "followup"].includes(meant.need)) st.need = meant.need;
    // items — validated by the item reader (quantity + colour); never from a model / serial / number answer
    if (["ink", "toner", "cartridge"].includes(st.need) && !st.items && meant.items && !["model", "modelList", "serial", "serialAgain", "phone", "phoneAgain", "phoneConfirm", "phoneCaller", "branchList"].includes(asked)) {
      const pi = parseSupplyItems(String(meant.items), st.need);
      if (pi.items?.length) { st.items = pi.items; accepted.push(`the items (${pi.items.map((i) => `${i.quantity} ${i.item}`).join(", ")})`); }
    }
    // machine condition — must map to one of the 4 conditions
    if (!st.condition && meant.condition) { const c = conditionFrom(String(meant.condition)); if (c) { st.condition = c; accepted.push(`the machine condition (${CONDITION_LABEL[c]})`); } }
    if (["service", ""].includes(st.need || "") && !st.problem && meant.problem) { if (!st.need) st.need = "service"; st.problem = String(meant.problem).slice(0, 300); accepted.push("the problem"); }
    // phone — must be a complete PH number; read back later before it is used
    if (!st.phone && !st.phone_heard && meant.phone && !["phone", "phoneAgain", "phoneConfirm", "phoneCaller"].includes(asked)) {
      const d = digitsIn(String(meant.phone));
      if (/^09\d{9}$/.test(d) || /^0?2\d{7,8}$/.test(d)) st.phone_heard = d;
      else if (d.length >= 5) rejected.push(`the phone number they said is incomplete (${d.length} digits)`);
    }
    // email — must be a valid address; read back later before it is used
    if (!st.email && !st.email_heard && meant.email && !["email", "emailAgain", "emailConfirm"].includes(asked)) {
      const e = parseEmail(String(meant.email));
      if (e) st.email_heard = e; else rejected.push("the email they said was not complete");
    }
  }
  if (rejected.length) st.first_tell = `kindly that ${rejected.join(" and ")}`;
  if (accepted.length) console.log("[voice-director] mediator accepted: %s", accepted.join("; "));
  const dontKnow = DONT_KNOW.test(text) || NOT_THERE.test(text) || meant.intent === "dont_know";
  const wantsList = WANTS_LIST.test(text) || ["wants_list", "wants_count"].includes(meant.intent);
  const address = () => st.address || st.name || "";

  // ---- The Director runs the steps in the order the business set (Settings > Channels > Mobile Phone >
  // Call order). Each step returns a reply when it still needs something, else nothing (done).
  const isSupply = () => ["ink", "toner", "cartridge"].includes(st.need);
  async function step_name() {
  // The caller corrects the title ("Ma'am po ako", "it's sir"): switch right away.
  if (st.address && phoneRow?.config?.pitch?.address_title !== false) {
    const first = st.address.replace(/^(Sir|Ma'am)\s+/, "");
    if (/\b(ma'?am po|ma'?am ako|i'?m a (woman|lady|girl)|babae (po )?ako|it'?s ma'?am|not sir|hindi (po )?sir)\b/i.test(text)) st.address = `Ma'am ${first}`;
    else if (/\b(sir po|sir ako|i'?m a (man|guy|boy)|lalaki (po )?ako|it'?s sir|not ma'?am|hindi (po )?ma'?am)\b/i.test(text)) st.address = `Sir ${first}`;
  }
  // ---- 1. Name ----
  if (!st.name && ["name", "nameAgain"].includes(answer)) {
    let n = nameFrom(text, true);
    if (!n) { const g = await sealionJSON(`The caller was asked their name and said: "${text}". Reply only JSON {"name":"<first name or full name, or empty>"}.`); n = capital(String(g?.name || "").trim()).slice(0, 40); }
    if (n && n.replace(/^(sir|ma'?am|mr|ms|mrs)\.?\s+/i, "").replace(/[^a-zñ]/gi, "").length >= 2) st.name = n;
  }
  if (st.name && !st.address) {
    const first = st.name.replace(/^(sir|ma'?am|mr|ms|mrs)\.?\s+/i, "").split(/\s+/)[0];
    const given = (st.name.match(/^(sir|mr)\b/i) && "Sir") || (st.name.match(/^(ma'?am|ms|mrs)\b/i) && "Ma'am") || "";
    const title = given || await titleFor(first, phoneRow?.config?.pitch?.address_title !== false);
    st.address = title ? `${title} ${capital(first)}` : capital(first);
    st.callername = st.name.replace(/^(sir|ma'?am|mr|ms|mrs)\.?\s+/i, "");
    await prisma.conversation.update({ where: { id: conversation.id }, data: { customer_name: st.callername } }).catch(() => {});
  }
  if (!st.name) { const k = st.tries.name ? "nameAgain" : "name"; st.tries.name = (st.tries.name || 0) + 1; return ask(k); }

  }
  async function step_identity() {
  // ---- 2. Identity ----
  if (!st.identity_ok) {
    // Serial answer
    if (["serial", "serialAgain"].includes(answer)) {
      if (dontKnow && !/[0-9]{3,}/.test(digitsIn(text))) st.no_serial = true;
      else {
        const cand = spokenDigits(text).toUpperCase().replace(/\b(THE|SERIAL|NUMBER|IS|IT'?S|ITS|MY|PO|AY|YUNG|ANG)\b/g, " ").replace(/[^A-Z0-9]/g, "");
        if (cand.length >= 6) {
          const found = await call("customer_service.find_machine", { serialnumber: cand }).catch(() => null);
          const list = found?.ok ? (found.facts?.machines || []) : [];
          if (list.length === 1 && !found.facts?.fuzzy) {
            const m = list[0];
            st.customer = { id: m.customerId, name: m.customerName };
            st.branch = { id: m.branchId, name: m.branchName, address: m.branchAddress || m.address || "" };
            st.machine = { id: m.id, model: m.model, serial: m.serial, emails: m.emails || [] };
            st.from_serial = true; st.asr_label = { kind: "serial", value: m.serial };
          } else {
            st.tries.serial = (st.tries.serial || 0) + 1;
            if (st.tries.serial >= 2) { st.no_serial = true; return ask("serialNotFound"); }
            return ask("serialAgain");
          }
        } else {
          st.tries.serial = (st.tries.serial || 0) + 1;
          if (st.tries.serial >= 2) st.no_serial = true; else return ask("serialAgain");
        }
      }
    }
    if (!st.machine && !st.no_serial) return ask("serial", address());

    // Company answer
    if (!st.customer && ["company", "companyAgain", "serialNotFound"].includes(answer) && !YES.test(text) && !NO.test(text)) {
      const c = cleanCompany(companyFrom(text) || text);
      if (c.length >= 3) st.company_q = c;
    }
    if (!st.customer && answer === "companyIs") {
      if (YES.test(text)) st.customer = st.company_pick;
      else { st.company_pick = null; st.company_q = ""; return ask("companyAgain"); }
    }
    if (!st.customer && st.company_q && st.company_q !== st.company_looked) {
      st.company_looked = st.company_q;
      const found = await call("customer_service.find_customer", { q: st.company_q }).catch(() => null);
      const list = found?.ok ? (found.facts?.customers || []) : [];
      if (list.length === 1) st.customer = { id: list[0].id, name: list[0].name };
      else if (list.length > 1 && closeCompany(list, st.company_q)) {
        const best = closeCompany(list, st.company_q);
        st.company_pick = { id: best.id, name: best.name };
        return ask("companyIs", best.name);
      } else {
        st.tries.company = (st.tries.company || 0) + 1;
        st.company_q = "";
        return ask("companyAgain");
      }
    }
    if (!st.customer) return ask("company", address());

    // Branch / department. The caller may ask for the list, or not know the name: then the list is read
    // (Mike 2026-10-23). "No" to a branch NEVER keeps that branch.
    if (!st.branch) {
      if (!st.machines) {
        const found = await call("customer_service.list_customer_machines", { customerid: Number(st.customer.id) || st.customer.id }).catch(() => null);
        st.machines = (found?.ok ? (found.facts?.machines || []) : []).map((m) => ({ id: m.id, model: m.model, serial: m.serial, branchId: m.branchId, branchName: m.branchName, address: m.branchAddress || "", emails: m.emails || [] }));
      }
      const groups = [];
      for (const m of st.machines) { let g = groups.find((x) => x.id === m.branchId); if (!g) groups.push(g = { id: m.branchId, name: m.branchName, address: m.address, machines: [] }); g.machines.push(m); }
      if (!groups.length) { st.tries.company = 9; st.stage = "done"; await escalate("Caller's company has no machines in the records", {}); return talk("error"); }
      const opts = groups.map((g) => {
        const models = [...new Set(g.machines.map((m) => sayModel(m.model)).filter(Boolean))];
        return { id: g.id, name: g.name, address: g.address, machines: g.machines, short: sayBranch(g.name, st.customer.name), label: `${sayBranch(g.name, st.customer.name)}, with the ${models.join(" and ") || "machine"}` };
      });
      const setBranch = (o) => {
        st.branch = { id: o.id, name: o.name, address: o.address };
        const named = o.machines.filter((m) => String(m.model || "").trim());   // machines with no model on record do not count
        const models = new Set(named.map((m) => String(m.model).toUpperCase()));
        if (o.machines.length === 1) st.machine = o.machines[0];
        else if (models.size === 1) st.machine = named[0];
        else if (!named.length) { st.machine = o.machines[0]; st.verify_branch = true; }
      };
      const readList = (only) => {
        const list = only || opts.filter((o) => !(st.rejected_branches || []).includes(o.id));
        st.branch_list = list.map((o) => o.id);
        const shown = list.slice(0, 6);
        return ask("branchList", st.customer.name, list.length, shown.map((o, i) => `${i + 1}, ${o.label}`).join("; "), list.length > 6);
      };
      const byModel = (list) => { // a model the caller said ("the HP 3035") picks among the options
        const said = digitsIn(text), low = text.toLowerCase().replace(/[^a-z0-9]/g, "");
        return list.filter((o) => o.machines.some((m) => { const md = String(m.model || "").toLowerCase(); const mdig = md.replace(/\D/g, ""); const mc = md.replace(/[^a-z0-9]/g, "");
          return (said.length >= 3 && mdig && (mdig.includes(said) || said.includes(mdig))) || (mc && low.includes(mc)); }));
      };
      if (opts.length === 1) setBranch(opts[0]);
      else if (answer === "branchList") {
        const list = (st.branch_list || []).map((id) => opts.find((o) => String(o.id) === String(id))).filter(Boolean);
        if (pickNumber(text, 99) > Math.min(list.length, 6)) return readList(list);
        const n = pickNumber(text, Math.min(list.length, 6)) || (Number(meant.pick) >= 1 && Number(meant.pick) <= list.length ? Number(meant.pick) : 0);
        let chosen = n ? list[n - 1] : null;
        if (!chosen) { const hit = byModel(list); if (hit.length === 1) chosen = hit[0]; }
        if (!chosen) {
          const pool = list.map((o) => ({ id: o.id, name: `${o.name} ${o.address}`, o }));
          const hits = branchMatch.match(text, pool, pool, { allowPlain: true, companyName: st.customer.name });
          if (hits.length === 1 || (hits.length > 1 && hits[0].score > hits[1].score)) chosen = hits[0].branch.o;
        }
        if (chosen) { setBranch(chosen); st.picked_from_list = true; }
        else if (wantsList || REPEAT.test(text)) return readList(list);
        else if (dontKnow || NO.test(text)) return ask("branchAddress");
        else { st.tries.branchList = (st.tries.branchList || 0) + 1; if (st.tries.branchList >= 2) return ask("branchAddress"); return readList(list); }
      } else if (answer === "branchIs") {
        if (YES.test(text) || meant.intent === "yes") setBranch(opts.find((o) => String(o.id) === String(st.branch_pick?.id)) || opts[0]);
        else { st.rejected_branches = [...(st.rejected_branches || []), st.branch_pick?.id]; st.branch_pick = null; return readList(); }
      } else if (["branch", "branchAgain", "branchAddress", "branchTie"].includes(answer)) {
        st.location_said = [st.location_said, text].filter(Boolean).join(" / ").slice(0, 300);
        if (wantsList || (dontKnow && answer !== "branchAddress")) return readList();
        const pool = opts.filter((o) => !(st.rejected_branches || []).includes(o.id)).map((o) => ({ id: o.id, name: `${o.name} ${o.address}`, o }));
        const said = String(text).replace(/\b(po|lang|sa|yung|ang|ng|kami|namin|ito|dito|doon|nasa|we are|we're|at the|in the|located|branch|department|dept|office)\b/gi, " ").replace(/\s+/g, " ").trim();
        const plain = pool.find((b) => b.o.short === "main office");
        const restWords = branchMatch.words(said).filter((w) => !branchMatch.words(st.customer.name).includes(w) && !/^(mismo|main|head|original|same|company)$/.test(w));
        const modelHit = byModel(pool.map((b) => b.o));
        if (plain && (/\b(mismo|main|head office|original|same)\b/i.test(said) || (said && !restWords.length && !dontKnow))) { st.branch_pick = plain.o; return ask("branchIs", "main office"); }
        if (modelHit.length === 1) setBranch(modelHit[0]);
        else {
          const hits = YES.test(text) || NO.test(text) ? [] : branchMatch.match(said, pool, pool, { allowPlain: true, companyName: st.customer.name });
          const top = hits.filter((h) => h.score === hits[0]?.score).map((h) => h.branch.o);
          if (top.length === 1) { st.branch_pick = top[0]; return ask("branchIs", top[0].short); }
          if (top.length > 1) return readList(top);           // same-name branches: read just those, with their machines
          if (answer === "branchAddress") { // even the address did not match: closest one, saved for the admin to verify
            const near = branchMatch.closestByText(st.location_said, pool, pool, 1, st.customer.name)[0] || pool[0];
            setBranch(near.o); st.verify_branch = true;
          } else return readList();                            // no match: read the list instead of asking again
        }
      }
      if (!st.branch) return st.branch_list ? readList() : ask("branch", st.customer.name);
    }
    // Machine within the branch: model asked openly; "I don't know" / "what do you have" -> the models are read.
    if (!st.machine) {
      const inBranch = (st.machines || []).filter((m) => String(m.branchId) === String(st.branch.id) && !(st.skip_models || []).includes(m.id) && String(m.model || "").trim());
      if (inBranch.length && new Set(inBranch.map((m) => String(m.model).toUpperCase())).size === 1 && answer !== "modelIs") st.machine = inBranch[0];
      const byModelM = () => { const said = digitsIn(text), low = text.toLowerCase().replace(/[^a-z0-9]/g, "");
        return inBranch.filter((m) => { const md = String(m.model || "").toLowerCase(); const mdig = md.replace(/\D/g, ""); const mc = md.replace(/[^a-z0-9]/g, "");
          return (said.length >= 3 && mdig && (mdig.includes(said) || said.includes(mdig))) || (mc && low.includes(mc)); }); };
      const modelsSaid = () => { const ms = [...new Set(inBranch.map((m) => sayModel(m.model)).filter(Boolean))]; st.model_list = ms; return ask("modelList", sayBranch(st.branch.name, st.customer.name), ms.map((m, i) => `${i + 1}, the ${m}`).join("; ")); };
      if (answer === "modelIs") {
        if (YES.test(text) || meant.intent === "yes") st.machine = st.machine_pick;
        else { st.skip_models = [...(st.skip_models || []), st.machine_pick?.id]; st.machine_pick = null; return modelsSaid(); }
      } else if (answer === "model" || answer === "modelList") {
        const hit = byModelM();
        const n = answer === "modelList" ? (pickNumber(text, (st.model_list || []).length) || Number(meant.pick) || 0) : 0;
        const byPick = n && st.model_list?.[n - 1] ? inBranch.find((m) => sayModel(m.model) === st.model_list[n - 1]) : null;
        if (byPick) st.machine = byPick;
        else if (hit.length >= 1) { st.machine_pick = hit[0]; return ask("modelIs", sayModel(hit[0].model)); }
        else if (wantsList || dontKnow || answer === "model") return modelsSaid();
        else { st.machine = inBranch[0]; st.verify_branch = true; }
      }
      if (!st.machine) return inBranch.length ? ask("model") : (st.machine = (st.machines || []).find((m) => String(m.branchId) === String(st.branch.id)), ask("identity", st.customer.name, sayBranch(st.branch.name, st.customer.name), sayModel(st.machine?.model || "printer")));
    }
    // Confirm identity (going straight on to the need counts as yes)
    if (answer === "identity") {
      if (YES.test(text) || needFrom(text) || conditionFrom(text) >= 2 || (!NO.test(text) && digitsIn(text).length < 3 && parseSupplyItems(text, st.need || "ink").items?.length)) {
        st.identity_ok = true;
        if (!st.need) st.need = needFrom(text) || "";
        if (!YES.test(text) && ["ink", "toner", "cartridge"].includes(st.need) && !st.items) { const p = parseSupplyItems(text, st.need); if (p.items?.length) st.items = p.items; }
        if (!YES.test(text) && st.need === "service" && !st.problem && text.length > 8) { st.problem = text.slice(0, 300); st.condition = conditionFrom(text) || 0; }
      }
      else if (NO.test(text) && !(needFrom(text) || conditionFrom(text))) {
        if (st.from_serial) Object.assign(st, { customer: null, branch: null, machine: null, machines: null, from_serial: false, no_serial: true, company_q: "", company_looked: "" });
        else { st.rejected_branches = [...(st.rejected_branches || []), st.branch?.id].filter(Boolean); Object.assign(st, { branch: null, machine: null, branch_pick: null, machine_pick: null, branch_list: null }); }
        st.ask = { k: "branch", a: [st.customer?.name] };
        if (!st.customer) return ask("company", address());
        await saveState(conversation.id, st);
        return turn({ conversation, companyId, message: "list please", caller });
      }
    }
    if (!st.identity_ok) return ask("identity", st.customer.name, sayBranch(st.branch?.name || "", st.customer.name), sayModel(st.machine?.model || "printer"));
  }

  }
  async function step_open_requests() {
  // ---- 2b. Open requests on this machine (Mike 2026-10-23: the Director settles them on the call) ----
  if (!st.open_checked) {
    const cases = require("./cases");
    if (!st.open_cases) {
      const rows = await prisma.businessOperationRequest.findMany({ where: { company_id: companyId, case_status: { in: cases.OPEN_CASE } }, orderBy: { created_at: "desc" }, take: 200 });
      st.open_cases = rows.filter((r) => String(r.requested_arguments?.customerid) === String(st.customer.id) && (!st.machine?.id || String(r.requested_arguments?.machineid) === String(st.machine.id)))
        .slice(0, 3).map((r) => ({ id: r.id, ref: r.reference || null, summary: cases.caseSummary(r) }));
      st.open_cases_seen = st.open_cases.map((c) => `${c.summary}${c.ref ? ` (${c.ref})` : ""}`);
    }
    const cur = st.open_cases[0];
    if (cur && ["openAsk", "openAgain"].includes(answer)) {
      const t = text.toLowerCase();
      const done = /\b(done|already (got|received|delivered|fixed)|received|delivered|natanggap|dumating|tapos|naayos|ok na|okay na)\b/.test(t);
      const cancel = /\b(no longer|not needed|don'?t need|do not need|cancel|hindi na (kailangan|po kailangan)|di na kailangan|wag na|huwag na)\b/.test(t);
      const keep = !done && !cancel && (YES.test(text) || /\b(still|kailangan pa|need it|needed|pending|waiting|hinihintay)\b/.test(t));
      const row = await prisma.businessOperationRequest.findUnique({ where: { id: cur.id } });
      let line = "";
      if (keep) { await cases.addHistory(cur.id, { type: "still_needed", note: "caller confirmed on a phone call" }); line = "that request stays open"; }
      else if (done) {
        let closed = false;
        if (row?.case_status === "ticket_open" && row.reference) { const r = await cases.ticketAction({ companyId, conversationId: conversation.id, operationKey: "close_service_request", args: { ticketReference: row.reference, reason: "Caller confirmed it was received / done (phone call)", closedBy: "Anne (phone, caller confirmed)" }, actor: "voice" }).catch(() => ({ ok: false })); closed = r.ok || /already/i.test(String(r.detail)); }
        await cases.setCase(cur.id, { case_status: "done", closed_at: new Date() });
        await cases.addHistory(cur.id, { type: "done", note: `caller confirmed on a phone call${closed ? "; closed in the system" : ""}` });
        if (row?.reference && !closed) escalate(`Close ${row.reference} in your system: the caller said it is done`, { "Request": cur.summary });
        line = "you marked that request as done";
      } else if (cancel) {
        let cancelled = false;
        if (row?.case_status === "ticket_open" && row.reference) { const r = await cases.ticketAction({ companyId, conversationId: conversation.id, operationKey: "cancel_service", args: { ticketReference: row.reference, reason: "Caller said it is no longer needed (phone call)", cancelledBy: "Anne (phone, caller confirmed)" }, actor: "voice" }).catch(() => ({ ok: false })); cancelled = r.ok; }
        await cases.setCase(cur.id, { case_status: "cancelled", closed_at: new Date() });
        await cases.addHistory(cur.id, { type: "cancelled", note: `caller said it is no longer needed (phone call)${cancelled ? "; schedule cancelled in the system" : ""}` });
        if (row?.reference && !cancelled) escalate(`Cancel ${row.reference} in your system: the caller does not need it anymore`, { "Request": cur.summary });
        line = "you cancelled that request as they asked";
      } else return ask("openAgain");
      st.open_cases.shift();
      if (st.open_cases.length) { st.first_tell = line; return ask("openAsk", st.open_cases[0].summary); }
      st.open_checked = true;
      st.first_tell = line;
    } else if (cur) return ask("openAsk", cur.summary);
    else st.open_checked = true;
  }

  }
  async function step_need() {
  // ---- 3. The need ----
  if (!st.need && answer === "need") st.need = needFrom(text) || (text.length > 3 ? "service" : "");
  if (!st.need) return ask("need", address());
  const supply = isSupply();
  if (supply && !st.items) {
    if (["items", "itemsColor", "itemsQty"].includes(answer)) {
      let p = parseSupplyItems(text, st.need);
      if (!p.items?.length && answer === "itemsQty" && st.pending_colors?.length) {
        const n = Number(digitsIn(text)) || 0;
        if (n > 0 && n <= 50) p = { items: st.pending_colors.map((c) => ({ item: `${c} ${capital(st.need)}`, quantity: n, unit: "pc" })) };
      }
      if (!p.items?.length && answer === "itemsColor" && st.pending_qty) p = parseSupplyItems(`${st.pending_qty} ${text}`, st.need);
      if (!p.items?.length && st.need === "toner" && /\b(black|itim|only|lang|mono|laser)\b/i.test(text) && (st.pending_qty || Number(digitsIn(text)))) p = { items: [{ item: "Black Toner", quantity: st.pending_qty || Number(digitsIn(text)), unit: "pc" }] };
      if (p.items?.length) st.items = p.items;
      else if (p.needColor) { st.pending_qty = p.quantity; return ask("itemsColor", st.need); }
      else if (p.needQty) { st.pending_colors = p.colors; return ask("itemsQty", `${p.colors.join(" and ").toLowerCase()} ${st.need}`); }
    }
    if (!st.items) return ask("items", st.need);
  }
  if (st.need === "service" && !st.problem) {
    if (answer === "problem") st.problem = text.slice(0, 300);
    else if (st.need_text) st.problem = st.need_text;
    if (!st.problem) return ask("problem");
  }
  }
  async function step_condition() {
  if (st.need !== "followup" && !st.condition) {
    if (["condition", "conditionAgain"].includes(answer)) {
      st.condition = conditionFrom(text) || 0;
      // the AI may have asked it as yes/no ("Is it printing normally?")
      if (!st.condition && YES.test(text) && /\b(normal|normally|okay|ok|fine|working|well|maayos|gumagana|smooth)\b/i.test(st.last_line || "") && !/\b(problem|not|hindi)\b/i.test(st.last_line || "")) st.condition = 1;
      if (!st.condition && YES.test(text) && /\b(not printing|hindi nagpi-?print|down)\b/i.test(st.last_line || "")) st.condition = 3;
    }
    if (!st.condition && st.need === "service" && st.problem) st.condition = conditionFrom(st.problem) || 0;
    if (!st.condition) return ask(answer === "condition" ? "conditionAgain" : "condition");
  }

  }
  async function step_phone() {
  // ---- 4. Contact number and email ----
  if (!st.phone) {
    const callerDigits = String(caller || "").replace(/\D/g, "").replace(/^63/, "0");
    if (answer === "phoneCaller") {
      if (YES.test(text)) st.phone = st.caller_digits;
      else if (digitsIn(text).length >= 7) st.phone_heard = digitsIn(text);
      else return ask("phone");
    } else if (["phone", "phoneAgain"].includes(answer)) st.phone_heard = digitsIn(text);
    else if (answer === "phoneConfirm") {
      if (YES.test(text)) { st.phone = st.phone_heard; st.asr_label = { kind: "digits", value: st.phone }; }
      else { st.phone_heard = digitsIn(text).length >= 7 ? digitsIn(text) : ""; if (!st.phone_heard) return ask("phoneAgain"); }
    }
    if (!st.phone && st.phone_heard) {
      const d = st.phone_heard;
      const ok = /^09\d{9}$/.test(d) || /^0?2\d{7,8}$/.test(d) || /^\d{7,8}$/.test(d);
      if (!ok) { st.phone_heard = ""; return ask("phoneAgain"); }
      return ask("phoneConfirm", sayDigits(d));
    }
    if (!st.phone) {
      if (/^09\d{9}$/.test(callerDigits) && !st.caller_offered) { st.caller_offered = true; st.caller_digits = callerDigits; return ask("phoneCaller", sayDigits(callerDigits)); }
      return ask("phone");
    }
  }
  }
  async function step_email() {
  if (st.email || st.need === "followup") return null;
  // Emails we already know for this caller / machine: the caller's earlier requests (same number), the
  // customer memory, and the branch's emails on record. Asking "send to <known>?" beats dictation.
  if (!st.known_emails) {
    const phone = String(st.phone || caller || "").replace(/\D/g, "").replace(/^63/, "0");
    const rows = phone.length >= 10 ? await prisma.$queryRawUnsafe(
      `select lower(requested_arguments->>'calleremail') as e, max(created_at) as at from business_operation_requests
        where company_id=$1 and requested_arguments->>'callerphone' like $2 and coalesce(requested_arguments->>'calleremail','') <> ''
          and coalesce(case_status,'') <> 'cancelled' and status not in ('cancelled','failed')
        group by 1 order by 2 desc limit 5`,
      companyId, `%${phone.slice(-10)}`).catch(() => []) : [];
    const prof = (await prisma.conversation.findUnique({ where: { id: conversation.id }, select: { customer_profile: true } }).catch(() => null))?.customer_profile || {};
    st.caller_emails = [...new Set([...rows.map((r) => String(r.e).toLowerCase()), String(prof.known?.calleremail || "").toLowerCase()].filter((e) => e.includes("@")))];
    st.known_emails = [...new Set([...st.caller_emails, ...((st.machine?.emails || []).map((e) => String(e).toLowerCase()))])];
  }
  const tries = () => (st.tries.email = (st.tries.email || 0) + 1);
  const propose = (e) => { st.email_heard = e; return ask("emailConfirm", sayEmailWords(e)); };

  if (answer === "emailKnown") {
    if (YES.test(text) || meant.intent === "yes") { st.email = st.email_heard; return null; }
    if (SPELL.test(text)) return talk("spellEmail", spellEmail(st.email_heard));
    st.email_heard = ""; // no: ask for the right one (anything they said is read below)
  }
  if (answer === "emailConfirm" && (YES.test(text) || meant.intent === "yes") && st.email_heard) { st.email = st.email_heard; st.asr_label = { kind: "email", value: st.email }; return null; }
  if (answer === "emailConfirm" && SPELL.test(text) && st.email_heard) return talk("spellEmail", spellEmail(st.email_heard));

  if (["email", "emailAgain", "emailConfirm", "emailKnown", "emailLetters"].includes(answer)) {
    if (/\b(no email|none|wala(ng)? email|don'?t have|do not have)\b/i.test(text)) {
      const onFile = (st.machine?.emails || [])[0];
      if (onFile) { st.email = onFile; st.email_on_file = true; st.first_tell = "that is okay: the updates will go to the email the company has on file"; return null; }
    }
    // a question back ("do you need my email?") without an email in it: ask for it again, kindly
    // "Did you get my email?" / "I already told you": read back the email already heard, never ask from zero
    if (st.email_heard && (/\b(get|got|have|told|said|gave|already|kanina|sinabi|binigay)\b/i.test(text) || /\?\s*$/.test(text)) && !parseEmail(text) && !spelledLetters(text) && !SPELL.test(text)) return propose(st.email_heard);
    if (/\?\s*$|^\s*(do|can|what|why|ano|bakit)\b/i.test(text) && !parseEmail(text) && !spelledLetters(text) && !SPELL.test(text)) return ask("email");
    // spelled letter by letter, maybe over several turns
    const letters = spelledLetters(text);
    const dom = domainFrom(text);
    if (letters || answer === "emailLetters") {
      st.email_letters = `${st.email_letters || ""}${letters}`.slice(0, 64);
      if (dom && st.email_letters) { const e = `${st.email_letters.replace(/[@.]+$/, "")}@${dom}`; st.email_letters = ""; const k = closestKnownEmail(e, st.known_emails); return propose(k || e); }
      if (st.email_letters) return ask("emailLetters", st.email_letters.split("").join(", "));
    }
    const heard = parseEmail(text) || meant.email && parseEmail(String(meant.email)) || "";
    if (heard) { const k = closestKnownEmail(heard, st.known_emails); return propose(k || heard); }
    // only a name part heard ("pineda mike b") with a known domain: match it to a known email
    const k = closestKnownEmail(text.replace(/\b(my|email|address|is|at|dot|com|yahoo|gmail)\b/gi, " "), st.known_emails);
    if (k && text.length > 3) return propose(k);
    if (tries() >= 3) {
      const fallback = st.caller_emails[0] || (st.machine?.emails || [])[0];
      if (fallback) { st.email = fallback; st.email_on_file = true; st.first_tell = "that is okay: the updates will go to the email the company has on file for them"; return null; }
      st.stage = "done";
      await escalate("Caller's email could not be captured on the call", { "What the caller said": text });
      return talk("passed");
    }
    return ask("emailAgain");
  }
  // first time at this step: offer the email we already know for this caller
  if (st.email_heard) return propose(closestKnownEmail(st.email_heard, st.known_emails) || st.email_heard);
  if (st.caller_emails.length) { st.email_heard = st.caller_emails[0]; return ask("emailKnown", sayEmailWords(st.caller_emails[0])); }
  return ask("email");
  }

  const STEPS = { name: step_name, identity: step_identity, open_requests: step_open_requests, need: step_need, condition: step_condition, phone: step_phone, email: step_email };
  const order = callOrder(phoneRow?.config?.pitch, flow);
  if (!order.serial_first && !st.machine && !st.serial_cfg_applied) { st.no_serial = true; st.serial_cfg_applied = true; }
  for (const key of order.steps) {
    if (key === "name" && !st.name && !order.on.name) continue;
    const out = await STEPS[key]();
    if (out) return out;
  }
  const supply = isSupply();
  if (!st.identity_ok) return null; // identity is always required to save
  // ---- 5. Summary -> save ----
  const kindWord = st.need === "toner" ? "toner" : st.need === "cartridge" ? "cartridge" : "ink";
  const NUMW = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve"];
  const what = supply ? st.items.map((i) => `${NUMW[i.quantity] || i.quantity} ${i.item.toLowerCase()}`).join(st.lang === "tl" ? " at " : " and ") : (st.lang === "tl" ? "pa-repair ng machine" : "a repair visit");
  const cond = (st.lang === "tl" ? CONDITION_TL : CONDITION_LABEL)[st.condition] || "";
  if (st.stage === "done") {
    if (NO.test(text) || /\b(that'?s all|wala na|nothing|okay na|thank you|thanks|salamat)\b/i.test(text)) return talk("anything");
    // Another request on the same call: start the need again, identity kept.
    Object.assign(st, { stage: "need", need: needFrom(text) || "", items: null, problem: "", condition: 0, confirm_id: null, ask: null });
    return turn({ conversation, companyId, message, caller });
  }
  if (st.need === "followup") {
    if (answer === "summaryFollow" && YES.test(text)) {
      await escalate("Customer is following up on a request (phone call)", { "Open requests": (st.open_cases_seen || []).join(" | ") || "none found for this machine" });
      st.stage = "done"; return talk("followPassed");
    }
    if (answer === "summaryFollow" && NO.test(text)) return ask("change");
    return ask("summaryFollow", sayModel(st.machine?.model || "machine"), sayDigits(st.phone));
  }

  const category = st.need;
  const args = {
    customerid: Number(st.customer.id) || st.customer.id,
    branchid: Number(st.branch.id) || st.branch.id,
    machineid: Number(st.machine.id) || st.machine.id,
    category,
    priority: "normal",
    callername: st.callername || st.name,
    callerphone: st.phone,
    calleremail: st.email || "",
    fieldworkmachinestatusid: st.condition || 1,
    requestorigin: flow.origin?.map?.phone || "call",
    description: [supply ? st.items.map((i) => `${i.quantity} ${i.unit} ${i.item}`).join(", ") : st.problem, st.verify_branch ? `(Branch / department to verify — caller said: "${st.location_said || "not given"}")` : ""].filter(Boolean).join(" ").slice(0, 600),
    ...(supply ? { releaseitems: st.items.map((i) => ({ item: i.item, unit: i.unit || "pc", quantity: i.quantity, category: flow.items?.category_map?.[kindWord] || "Toner / Ink" })) } : {})
  };
  if (answer === "summary" || answer === "change") {
    if (answer === "change") { // what they want to change: simple re-ask of that part
      if (/\b(number|phone|contact)\b/i.test(text)) { st.phone = ""; st.phone_heard = ""; st.caller_offered = true; return ask("phone"); }
      if (/\b(email)\b/i.test(text)) { st.email = ""; return ask("email"); }
      if (/\b(colou?r|ink|toner|how many|quantity|ilan)\b/i.test(text)) { st.items = null; return ask("items", st.need); }
      if (/\b(branch|department|machine|model|company)\b/i.test(text)) { Object.assign(st, { identity_ok: false, branch: null, machine: null }); return ask("branch", st.customer.name); }
      return ask("summary", what, sayModel(st.machine.model), cond, sayDigits(st.phone));
    }
    if (NO.test(text)) return ask("change");
    if (YES.test(text) && st.confirm_id) {
      const result = await call(FLOW, { _confirmation_id: st.confirm_id }).catch((e) => ({ ok: false, detail: e.message }));
      st.confirm_id = null; st.stage = "done";
      if (result?.executed || result?.merged) {
        if (st.verify_branch) be.notifyEngineOutcome({ companyId, conversationId: conversation.id, operation: { id: flow.id, definition: { name: "Branch / department to verify (phone call)" } }, outcome: "executed", reference: result.reference || null,
          details: { "Action needed": "Please verify the branch / department of this request and correct it in the records.", "Caller said the machine is at": st.location_said || "(not given)", "Saved under": `${st.customer.name} — ${st.branch.name} — ${st.machine.model}` } }).catch(() => {});
        return talk("saved", result.reference ? sayReference(result.reference) : "");
      }
      if (result?.staff_notified || result?.status === "blocked") { await escalate("Phone request could not be scheduled automatically", { "Why": String(result?.detail || result?.error || "blocked").slice(0, 300) }); return talk("passed"); }
      console.error("[voice-director] save failed conversation=%s: %s", conversation.id, result?.detail || result?.error);
      await escalate("Phone request could not be saved", { "Why": String(result?.detail || result?.error || "unknown").slice(0, 300) });
      return talk("error");
    }
  }
  // Prepare (dry run + summary) and ask the caller to confirm.
  const prepared = await call(FLOW, args).catch((e) => ({ ok: false, detail: e.message }));
  if (prepared?.status === "awaiting_customer_confirmation" && prepared.confirmation_id) {
    st.confirm_id = prepared.confirmation_id;
    if (prepared.merge_into && prepared.merge_into.same_caller) { // same need on an open request: added, not a new ticket
      const merged = await call(FLOW, { _confirmation_id: prepared.confirmation_id }).catch(() => null);
      st.confirm_id = null; st.stage = "done";
      if (!merged?.merged) await escalate("Phone request could not be added to the open request", { "Why": String(merged?.detail || "merge failed").slice(0, 300) });
      return merged?.merged ? talk("saved", merged.reference ? sayReference(merged.reference) : "") : talk("passed");
    }
    return ask("summary", what, sayModel(st.machine.model), cond, sayDigits(st.phone));
  }
  if (prepared?.status === "needs_information") {
    console.warn("[voice-director] still missing %s conversation=%s", JSON.stringify(prepared.missing), conversation.id);
    const miss = prepared.missing || [];
    if (miss.includes("calleremail")) { st.email = ""; st.email_on_file = false; return ask("email"); }
    if (miss.includes("callerphone")) { st.phone = ""; return ask("phone"); }
  }
  if (prepared?.error === "system_rejected" && Number(prepared.http_status) === 400) {
    const why = String(prepared.detail || "");
    if (/caller ?name/i.test(why)) { st.name = ""; st.address = ""; st.callername = ""; return ask("nameAgain"); }
    if (/caller ?phone|phone/i.test(why)) { st.phone = ""; st.phone_heard = ""; st.caller_offered = true; return ask("phone"); }
    if (/caller ?email|email/i.test(why)) { st.email = ""; st.email_heard = ""; return ask("email"); }
  }
  if (prepared?.staff_notified || prepared?.status === "blocked") { st.stage = "done"; await escalate("Phone request could not be scheduled automatically", { "Why": String(prepared?.detail || prepared?.note || "blocked").slice(0, 300) }); return talk("passed"); }
  if (prepared?.error === "open_request_not_confirmed") { st.stage = "done"; await escalate("Phone request held: the customer has an open request the call did not settle", { "Open requests": (prepared.open_requests || []).map((o) => `${o.summary}${o.reference ? ` (${o.reference})` : ""}`).join(" | ") }); return talk("passed"); }
  console.error("[voice-director] prepare failed conversation=%s: %s", conversation.id, JSON.stringify(prepared).slice(0, 300));
  st.stage = "done";
  await escalate("Phone request could not be prepared", { "Why": String(prepared?.detail || prepared?.error || "unknown").slice(0, 300) });
  return talk("error");
}

module.exports = { sayEmailWords, emailContext, spelledLetters, domainFrom, spellEmail, closestKnownEmail, natural, GOALS, CALL_STEPS, requiredSteps, callOrder, turn, sayDigits, sayEmail, parseEmail, spokenDigits, nameFrom, companyFrom, needFrom, conditionFrom, sayReference };
