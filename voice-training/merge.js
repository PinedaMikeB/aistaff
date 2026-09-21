#!/usr/bin/env node
"use strict";

/**
 * Merge the nine category batches into one recording script, with checks.
 *
 *   node merge.js
 *
 * Writes taglish-master.json (what the recorder reads) and prints a QA report:
 * duplicate ids, duplicate text, repeated openers, digits that should have
 * been spelled out, and the language / mode distribution.
 */
const fs = require("fs");
const path = require("path");

const RAW = path.join(__dirname, "phrases");
const OUT = path.join(__dirname, "phrases", "taglish-master.json");

// Tagalog's native alphabet has 20 letters — c, f, j, q, v, x, z do not occur
// in native words, so a word containing one is a strong English signal. The
// wordlist catches English words that happen to use only Tagalog letters.
const TL_WORDS = new Set(("po opo ang ng nang sa ko mo niyo ninyo natin namin nila yung yun ito iyan iyon na pa ay mga kayo siya ako kami tayo ikaw hindi wala meron mayroon may sige salamat kumusta kamusta magandang maganda paano ano saan kailan bakit sino kung para pero at araw umaga hapon gabi tao bago muna lang lamang din rin daw raw ba naman kasi talaga sandali teka heto ayan ayun ayon nakuha kukunin hahanapin balikan tulungan sumagot katanungan tanong alala paraan paumanhin pasensya sarado tindahan linya tuloy pasok andito narito nandiyan buong pangalan malaman maaari pwede puwede mahingi inyong inyo amin aming atin akin bahala asikaso siyempre simulan usap uli muli nawala naputol tawag pagtawag tumawag tawagan binigay bigay sabihin sinabi narinig malinaw boses medyo masyadong madami marami konti ilang isa dalawa tatlo apat lima anim pito walo siyam sampu bata mahahabol gusto sasamahan hintay paghihintay nagmamadali madali mabilis nauunawaan naiintindihan intindi tama mabuti buti aba naku nako hala pala presyo halaga bayad bayaran padala ipadala dumating darating stock ubos naubos meron matibay mura mahal libre dagdag bawas piraso kahon kilo metro oras minuto buwan taon linggo bukas kahapon ngayon mamaya kanina").split(" "));

const EN_WORDS = new Set(("the a an is are was were will would can could should have has had do does did be been being i you he she it we they me him her us them my your his their our this that these those there here what when where why how who and or but if then so for with without to from at on in out up down off over under again more most some any all no not now today tomorrow yesterday good morning afternoon evening night day hello hi thanks thank please sorry help line hold name number order item ready welcome back great glad first time looking still hear clearly pull account details kindly worry rest assured previous inquiry customer service assist shop store reaching right just let get may must going give take make know think want need like say see call checking check system page chat record history reference code last full size color price total delivery shipping payment paid confirm cancel refund promise minutes hours days week month year sir maam okay").split(" "));

const RARE = /[cfjqvxz]/i;

function classifyWord(raw) {
  const w = raw.toLowerCase().replace(/[^a-z'-]/g, "");
  if (!w) return null;
  if (TL_WORDS.has(w)) return "tl";
  // Taglish affixes on English stems: i-check, nag-follow, mag-place
  const stem = w.replace(/^(i|nag|mag|ma|na|pag|ka|ipa|maka|naka|pina)-/, "");
  if (EN_WORDS.has(stem) || RARE.test(stem)) return "en";
  if (EN_WORDS.has(w) || RARE.test(w)) return "en";
  return "tl";
}

function classify(text) {
  const m = text.split(/\s+/).map(classifyWord).filter(Boolean);
  const en = m.filter((x) => x === "en").length;
  const tl = m.filter((x) => x === "tl").length;
  if (en && tl) return "taglish";
  if (en) return "english";
  return "tagalog";
}

const firstThree = (t) =>
  t.toLowerCase().replace(/[^\w\s']/g, "").split(/\s+/).slice(0, 3).join(" ");

const files = fs.readdirSync(RAW).filter((f) => f.endsWith(".json") && /^\d\d-/.test(f)).sort();
if (!files.length) { console.error("No batch files in scripts/raw/"); process.exit(1); }

const all = [];
const seenIds = new Map();
const seenText = new Map();
const openers = new Map();
const problems = [];

for (const file of files) {
  let batch;
  try { batch = JSON.parse(fs.readFileSync(path.join(RAW, file), "utf8")); }
  catch (e) { problems.push(`${file}: invalid JSON — ${e.message}`); continue; }
  if (!Array.isArray(batch)) { problems.push(`${file}: not an array`); continue; }

  for (const line of batch) {
    if (!line.id || !line.text) { problems.push(`${file}: entry missing id or text`); continue; }

    if (seenIds.has(line.id)) problems.push(`DUPLICATE ID ${line.id} (${file} + ${seenIds.get(line.id)})`);
    else seenIds.set(line.id, file);

    const norm = line.text.toLowerCase().replace(/[^\w\s]/g, "").replace(/\s+/g, " ").trim();
    if (seenText.has(norm)) problems.push(`DUPLICATE TEXT ${line.id} == ${seenText.get(norm)}`);
    else seenText.set(norm, line.id);

    const open = firstThree(line.text);
    if (!openers.has(open)) openers.set(open, []);
    openers.get(open).push(line.id);

    const words = line.text.trim().split(/\s+/).length;
    if (words < 3) problems.push(`TOO SHORT (${words}w) ${line.id}: ${line.text}`);
    if (words > 24) problems.push(`TOO LONG (${words}w) ${line.id}: ${line.text}`);
    if (/\d/.test(line.text)) problems.push(`DIGITS NOT SPELLED OUT ${line.id}: ${line.text}`);
    if (/[\[\{]/.test(line.text)) problems.push(`PLACEHOLDER ${line.id}: ${line.text}`);

    all.push({ ...line, lang: classify(line.text) });
  }
}

for (const [open, ids] of openers) {
  if (ids.length > 4) problems.push(`REPEATED OPENER "${open}" x${ids.length}: ${ids.slice(0, 4).join(", ")}...`);
}

const byTag = {}, byMode = {}, byLang = {};
for (const l of all) {
  byTag[l.tag] = (byTag[l.tag] || 0) + 1;
  byMode[l.mode] = (byMode[l.mode] || 0) + 1;
  byLang[l.lang] = (byLang[l.lang] || 0) + 1;
}
const pct = (n) => `${((n / all.length) * 100).toFixed(1)}%`;

console.log(`\n=== MERGED ${all.length} lines from ${files.length} batches ===\n`);
console.log("BY CATEGORY");
for (const [k, v] of Object.entries(byTag)) console.log(`  ${k.padEnd(24)} ${v}`);
console.log("\nBY MODE");
for (const [k, v] of Object.entries(byMode)) console.log(`  ${String(k).padEnd(24)} ${v}  ${pct(v)}`);
console.log("\nBY LANGUAGE  (target 70 / 20 / 10)");
for (const k of ["taglish", "english", "tagalog"]) {
  console.log(`  ${k.padEnd(24)} ${byLang[k] || 0}  ${pct(byLang[k] || 0)}`);
}

const mins = Math.round((all.length * 4) / 60);
console.log(`\nEstimated: ~${(all.length * 4 / 60).toFixed(0)} min of audio, ~${Math.round(all.length * 10 / 60)} min to record.`);

if (problems.length) {
  console.log(`\n=== ${problems.length} PROBLEM(S) ===`);
  problems.slice(0, 30).forEach((p) => console.log(`  ${p}`));
  if (problems.length > 30) console.log(`  ...and ${problems.length - 30} more`);
} else {
  console.log("\nNo problems found.");
}

fs.writeFileSync(OUT, JSON.stringify({
  name: "Taglish Master — AIStaff Pitch voice",
  generated: new Date().toISOString(),
  totalLines: all.length,
  lines: all.map(({ lang, ...keep }) => keep),
}, null, 2));
console.log(`\nWrote ${OUT}\n`);
