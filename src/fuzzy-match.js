/**
 * Typo-tolerant matching for identifiers of ANY business (added 2026-10-20):
 * machine serials, aircon models / serials, plan ids, control numbers, room numbers, account numbers.
 * Used by the Director's identify step (src/director.js). Deterministic code, no AI.
 */

// Characters people confuse on stickers / receipts are compared as the same.
const LOOKALIKE = { O: "0", Q: "0", D: "0", I: "1", L: "1", S: "5", B: "8", Z: "2", G: "6" };

// Labels customers type before an identifier ("SN#-", "Control No.:", "Room", "Plan ID", "Acct #").
const DEFAULT_LABELS = [
  "s\\s*/\\s*n", "sn", "serial(?:\\s*(?:no|number|num))?", "model(?:\\s*(?:no|number))?", "control(?:\\s*(?:no|number))?",
  "ref(?:erence)?(?:\\s*(?:no|number))?", "room(?:\\s*(?:no|number))?", "rm", "unit(?:\\s*(?:no|number))?", "plan(?:\\s*(?:id|no|code))?",
  "acc(?:ount|t)?(?:\\s*(?:no|number))?", "contract(?:\\s*(?:no|number))?", "id(?:\\s*no)?", "no", "#"
];

function cleanIdentifier(value, extraLabels = []) {
  const labels = [...extraLabels.map((l) => String(l).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")), ...DEFAULT_LABELS].join("|");
  let text = String(value || "").trim();
  // Strip labels (only when followed by a separator or the identifier), repeatedly: "SN# no. E807…".
  const label = new RegExp(`^(?:${labels})\\s*[#:.\\-]*\\s+|^(?:${labels})\\s*[#:.\\-]+\\s*`, "i");
  for (let i = 0; i < 3 && label.test(text); i += 1) text = text.replace(label, "");
  return text.replace(/^[^A-Za-z0-9]+|[^A-Za-z0-9]+$/g, "").trim();
}

function matchKey(value, { lookalikes = true } = {}) {
  const base = String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  return lookalikes ? base.replace(/[OQDILSBZG]/g, (ch) => LOOKALIKE[ch] || ch) : base;
}

/** Edits between two strings (insert / delete / replace / swap neighbours), stops early above cap. */
function editDistance(a, b, cap = 3) {
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j += 1) d[0][j] = j;
  for (let i = 1; i <= a.length; i += 1) {
    let rowBest = Infinity;
    for (let j = 1; j <= b.length; j += 1) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, d[i - 2][j - 2] + 1);
      d[i][j] = v;
      if (v < rowBest) rowBest = v;
    }
    if (rowBest > cap) return cap + 1;
  }
  return d[a.length][b.length];
}

/** How many edits we tolerate for an identifier of this length. Short ids (room 305) must be exact. */
function capFor(key) {
  return key.length >= 14 ? 3 : key.length >= 9 ? 2 : key.length >= 6 ? 1 : 0;
}

/** Closest items to `typed`. getText(item) returns the identifier of each item. */
function closest(typed, items, getText, { lookalikes = true, limit = 5 } = {}) {
  const key = matchKey(typed, { lookalikes });
  const cap = capFor(key);
  if (!key) return [];
  return items
    .map((item) => {
      const other = matchKey(getText(item), { lookalikes });
      return { item, distance: other === key ? 0 : cap ? editDistance(key, other, cap) : cap + 1 };
    })
    .filter((x) => x.distance <= cap)
    .sort((a, b) => a.distance - b.distance)
    .slice(0, limit);
}

const STOP = new Set(["the", "and", "ang", "ng", "sa", "kami", "po", "opo", "ito", "yung", "dept", "department", "branch", "corp", "corporation", "inc", "company", "office", "co", "ltd", "opc", "main", "our", "ito", "na"]);
function words(text) {
  return String(text || "").toLowerCase().split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !STOP.has(w));
}
/** Share of the customer's words found in the record text (a one-letter typo in longer words still counts). */
function contextScore(customerText, recordText) {
  const said = words(customerText);
  const have = words(recordText);
  if (!said.length || !have.length) return 0;
  const hit = said.filter((w) => have.some((h) => h === w || h.includes(w) || (w.length >= 5 && editDistance(w, h, 1) <= 1)));
  return hit.length / said.length;
}

module.exports = { cleanIdentifier, matchKey, editDistance, capFor, closest, contextScore, words };
