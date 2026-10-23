/**
 * Supply items from what the customer wrote (added 2026-10-20), in CODE, not by the AI:
 *   "3, yellow, ink" -> 3 pc Yellow Ink
 *   "2 magenta + 3 yellow" -> 2 pc Magenta Ink; 3 pc Yellow Ink
 *   "2 black at tig-isa colors" -> 2 Black; 1 Cyan; 1 Magenta; 1 Yellow
 *   "1 set" / "isang set" -> 1 set Ink set (CMYK)
 *   toner (mono): "2 toner" -> 2 pc Toner
 * Returns { items, needColor, needQty } so the Director asks only for what is missing.
 */
const COLORS = [
  ["Black", ["black", "blk", "bk", "itim", "k"]],
  ["Cyan", ["cyan", "cyn", "blue", "asul", "c"]],
  ["Magenta", ["magenta", "mag", "pink", "red", "pula", "m"]],
  ["Yellow", ["yellow", "yel", "dilaw", "y"]]
];
const NUMBER_WORDS = { isa: 1, isang: 1, one: 1, dalawa: 2, dalawang: 2, two: 2, tatlo: 3, tatlong: 3, three: 3, apat: 4, apat_na: 4, four: 4, lima: 5, limang: 5, five: 5, anim: 6, six: 6, pito: 7, seven: 7, walo: 8, eight: 8, siyam: 9, nine: 9, sampu: 10, ten: 10 };
const FILLER = new Set(["pc", "pcs", "piece", "pieces", "bottle", "bottles", "bot", "x", "of", "na", "ng", "po", "pong", "ink", "inks", "toner", "toners", "cartridge", "cartridges", "color", "colors", "colour", "colours", "kulay", "ang", "yung", "the", "and", "at", "please", "pls", "need", "kailangan"]);

function colorOf(token) {
  for (const [name, words] of COLORS) if (words.includes(token)) return name;
  return null;
}

function parseSupplyItems(text, kind = "ink") {
  const kindLabel = kind === "toner" ? "Toner" : kind === "cartridge" ? "Cartridge" : "Ink";
  const lower = String(text || "").toLowerCase().replace(/tig[\s-]?isa/g, " 1 each ").replace(/tig[\s-]?(\d+)/g, " $1 each ").replace(/\bkada\b/g, " each ");
  const tokens = (lower.match(/[a-zñ]+|\d+/g) || []).map((t) => (NUMBER_WORDS[t] !== undefined ? String(NUMBER_WORDS[t]) : t));
  const items = [];
  const add = (item, quantity, unit = "pc") => {
    const existing = items.find((i) => i.item === item && i.unit === unit);
    if (existing) existing.quantity = Math.min(50, existing.quantity + quantity);
    else items.push({ item, quantity: Math.min(50, quantity), unit });
  };
  let pendingQty = null;
  const colorsWithoutQty = [];
  const singleLetterOk = (i) => /^\d+$/.test(tokens[i - 1] || "") || /^\d+$/.test(tokens[i + 1] || "");
  for (let i = 0; i < tokens.length; i += 1) {
    const t = tokens[i];
    if (/^\d+$/.test(t)) {
      const n = Number(t);
      if (n < 1 || n > 50 || t.length > 2) { pendingQty = null; continue; } // serials, phones, years are not quantities
      // look ahead (skipping filler) for what this number counts
      let j = i + 1;
      while (j < tokens.length && FILLER.has(tokens[j])) j += 1;
      const next = tokens[j];
      if (next === "set" || next === "sets" || (next === "full" && tokens[j + 1] === "set") || next === "complete") {
        add(`${kindLabel} set (CMYK)`, n, "set"); i = j; pendingQty = null; continue;
      }
      if (next === "each") {
        let k = j + 1; while (k < tokens.length && FILLER.has(tokens[k])) k += 1;
        const named = [];
        while (k < tokens.length && colorOf(tokens[k])) { named.push(colorOf(tokens[k])); k += 1; }
        const list = named.length ? named : ["Cyan", "Magenta", "Yellow"];
        for (const c of list) add(`${c} ${kindLabel}`, n);
        i = k - 1; pendingQty = null; continue;
      }
      const color = next ? colorOf(next) : null;
      if (color && (next.length > 1 || true)) {
        add(`${color} ${kindLabel}`, n); i = j; pendingQty = null; continue;
      }
      pendingQty = n;
      continue;
    }
    const color = colorOf(t);
    if (color && (t.length > 1 || singleLetterOk(i))) {
      // "yellow x3" / "yellow 3" / "3, yellow" (pending number before)
      let j = i + 1; while (j < tokens.length && FILLER.has(tokens[j])) j += 1;
      if (/^\d+$/.test(tokens[j] || "") && Number(tokens[j]) >= 1 && Number(tokens[j]) <= 50 && tokens[j].length <= 2 && !colorOf(tokens[j + 1] || "")) {
        add(`${color} ${kindLabel}`, Number(tokens[j])); i = j; pendingQty = null; continue;
      }
      if (pendingQty) { add(`${color} ${kindLabel}`, pendingQty); pendingQty = null; continue; }
      colorsWithoutQty.push(color);
      continue;
    }
    if ((t === "set" || t === "sets") && !items.some((i) => i.unit === "set")) {
      add(`${kindLabel} set (CMYK)`, pendingQty || 1, "set"); pendingQty = null;
    }
  }
  // A number with no colour: mono toner / cartridge is fine; ink needs a colour.
  if (pendingQty && !items.length) {
    if (kind === "ink") return { items: [], needColor: true, quantity: pendingQty };
    add(kindLabel, pendingQty);
  }
  if (!items.length && colorsWithoutQty.length) return { items: [], needQty: true, colors: colorsWithoutQty };
  return { items };
}

function itemsSummary(items) {
  return (items || []).map((i) => `${i.quantity} ${i.unit} ${i.item}`).join("; ");
}

module.exports = { parseSupplyItems, itemsSummary };
