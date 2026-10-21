const test = require("node:test");
const assert = require("node:assert");
const { parseSupplyItems, itemsSummary } = require("../src/supply-items");

const s = (t, k = "ink") => itemsSummary(parseSupplyItems(t, k).items);

test("quantity + colour in any order", () => {
  assert.equal(s("3, yellow, ink"), "3 pc Yellow Ink");
  assert.equal(s("yellow x3"), "3 pc Yellow Ink");
  assert.equal(s("2 magenta + 3 yellow"), "2 pc Magenta Ink; 3 pc Yellow Ink");
  assert.equal(s("dalawang itim, isang dilaw"), "2 pc Black Ink; 1 pc Yellow Ink");
});

test("each colour and sets", () => {
  assert.equal(s("2 black at tig-isa colors"), "2 pc Black Ink; 1 pc Cyan Ink; 1 pc Magenta Ink; 1 pc Yellow Ink");
  assert.equal(s("isang set"), "1 set Ink set (CMYK)");
});

test("toner without colour is fine; ink without colour is asked", () => {
  assert.equal(s("2 toner", "toner"), "2 pc Toner");
  assert.deepEqual(parseSupplyItems("3 ink"), { items: [], needColor: true, quantity: 3 });
  assert.deepEqual(parseSupplyItems("yellow and cyan please"), { items: [], needQty: true, colors: ["Yellow", "Cyan"] });
});

test("serials and phone numbers are never quantities", () => {
  assert.deepEqual(parseSupplyItems("need ink for E80729A3H154007").items, []);
  assert.deepEqual(parseSupplyItems("call 0917 123 4567").items, []);
});
