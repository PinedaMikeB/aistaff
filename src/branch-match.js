/**
 * Branch / department matching (added 2026-10-20, Mike). A customer who gives a company name instead
 * of a serial is first ASKED which branch / department (and where). Their words are matched here in
 * CODE against that company's branches. Only words that tell the branches apart count (the company
 * name itself is shared by all of them). Typos and short forms are accepted ("acctg" = accounting).
 * Lists are a last resort and never long (closest 5).
 */
const { editDistance } = require("./fuzzy-match");

const SYNONYMS = {
  acctg: "accounting", acct: "accounting", accts: "accounting", accounts: "accounting", acctng: "accounting",
  hr: "human resources", hrd: "human resources", admin: "administration", adm: "administration",
  ops: "operations", mktg: "marketing", purch: "purchasing", fin: "finance", treas: "treasury",
  it: "information technology", mis: "information technology", bldg: "building", flr: "floor", fl: "floor",
  ofc: "office", hq: "head office", ho: "head office", qc: "quezon city", bgc: "bonifacio global city",
  mkt: "makati", mla: "manila", sf: "san fernando", sto: "santo", sta: "santa", gen: "general"
};
const STOP = new Set(["the", "of", "and", "at", "in", "sa", "ng", "na", "po", "for", "dept", "department", "branch", "office", "inc", "corp", "corporation", "company", "co", "ltd", "our", "we", "is", "it's", "its", "my", "from", "machine", "printer", "copier"]);

function words(text) {
  const raw = String(text || "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim().split(" ").filter(Boolean);
  return raw.flatMap((w) => (SYNONYMS[w] ? SYNONYMS[w].split(" ") : [w])).filter((w) => w.length > 1 && !STOP.has(w));
}

/**
 * Words that do not tell branches apart: shared by all of them, frequent across many (e.g. "China",
 * "Bank", "Savings", "CBS" in 489 China Bank Savings branches), or part of the company's own name.
 */
function commonWords(allBranches, companyName = "") {
  const counts = new Map();
  for (const b of allBranches) for (const w of new Set(words(b.name))) counts.set(w, (counts.get(w) || 0) + 1);
  const n = allBranches.length;
  const out = new Set([...counts].filter(([, c]) => c === n || (n >= 5 && c / n > 0.6)).map(([w]) => w));
  // The company's own words and its initials ("China Bank Savings" -> "cbs").
  const own = String(companyName || "").toLowerCase().replace(/[^a-z0-9ñ]+/g, " ").trim().split(" ").filter((w) => w && !["inc", "corp", "co", "ltd", "the", "of", "and"].includes(w));
  for (const w of own) if (w.length > 1) out.add(w);
  if (own.length >= 2) out.add(own.map((w) => w[0]).join(""));
  return out;
}

function wordHit(w, said) {
  for (const t of said) {
    if (t === w) return true;
    if (w.length >= 5 && t.length >= 4 && editDistance(w, t, 2) <= 1) return true;
    if (t.length >= 4 && w.startsWith(t)) return true;
  }
  return false;
}

const MAIN_WORDS = new Set(["main", "head", "original", "mismo", "lang", "only", "yung", "ung", "yun", "mismong", "just"]);

/**
 * Branches (from `pool`) whose distinguishing words the customer said, best first.
 * allowPlain: the customer named only the company ("Ferrer Studio lang po", "main") -> the one branch
 * that has no extra words (the main one). Not used on the first message (we ask first).
 */
function match(text, pool, allBranches = pool, { allowPlain = false, companyName = "" } = {}) {
  const common = commonWords(allBranches, companyName);
  const spoken = new Set(words(text));
  if (!spoken.size) return [];
  const said = new Set([...spoken].filter((w) => !common.has(w)));   // company words never pick a branch
  const scored = said.size ? scoreAll(said, pool, common) : [];
  if (scored.length || !allowPlain) return scored;
  const plain = pool.filter((b) => !words(b.name).some((w) => !common.has(w)));
  const onlyCompanyWords = [...spoken].every((w) => common.has(w) || MAIN_WORDS.has(w)) && [...spoken].some((w) => common.has(w) || w === "main" || w === "head" || w === "original");
  return plain.length === 1 && onlyCompanyWords ? [{ branch: plain[0], score: 1 }] : [];
}

function scoreAll(said, pool, common) {
  return pool
    .map((b) => {
      const own = words(b.name).filter((w) => !common.has(w)).filter((w, i, a) => a.indexOf(w) === i);
      const hit = new Set(own.filter((w) => wordHit(w, said)));
      // Joined words count too: "backup" = "Back Up", "sanfernando" = "San Fernando".
      for (let i = 0; i < own.length - 1; i += 1) {
        const joined = own[i] + own[i + 1];
        if ([...said].some((t) => t === joined || (t.length >= 6 && editDistance(joined, t, 2) <= 1))) { hit.add(own[i]); hit.add(own[i + 1]); }
      }
      return { branch: b, score: hit.size };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);
}

function bigrams(t) {
  const s = ` ${String(t || "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim()} `;
  const out = [];
  for (let i = 0; i < s.length - 1; i += 1) out.push(s.slice(i, i + 2));
  return out;
}
function dice(a, b) {
  const A = bigrams(a), B = bigrams(b);
  if (!A.length || !B.length) return 0;
  const counts = new Map();
  for (const x of A) counts.set(x, (counts.get(x) || 0) + 1);
  let hit = 0;
  for (const x of B) { const c = counts.get(x) || 0; if (c) { hit += 1; counts.set(x, c - 1); } }
  return (2 * hit) / (A.length + B.length);
}

/** Last resort: the n branches closest to what the customer wrote (never the whole list). */
function closestByText(text, pool, allBranches = pool, n = 5, companyName = "") {
  if (pool.length <= n) return pool.slice();
  const common = commonWords(allBranches, companyName);
  const strip = (name) => words(name).filter((w) => !common.has(w)).join(" ") || String(name || "");
  const said = words(text).join(" ");
  return pool.map((b) => ({ b, s: said ? dice(said, strip(b.name)) : 0 })).sort((x, y) => y.s - x.s).slice(0, n).map((x) => x.b);
}

module.exports = { words, commonWords, match, closestByText, SYNONYMS };
