const test = require("node:test");
const assert = require("node:assert");
const f = require("../src/fuzzy-match");

test("identifiers of any business are cleaned", () => {
  assert.equal(f.cleanIdentifier("SN#- E80729A3H154007-"), "E80729A3H154007");
  assert.equal(f.cleanIdentifier("Control No.: CN-2026-0042"), "CN-2026-0042");
  assert.equal(f.cleanIdentifier("Room 305"), "305");
  assert.equal(f.cleanIdentifier("Plan ID: PLN-77"), "PLN-77");
  assert.equal(f.cleanIdentifier("Acct # 001234"), "001234");
});

test("typos find the closest identifier", () => {
  const items = ["E80729A3H154007", "E80729C3H751250", "E66868B1J659094"].map((serial) => ({ serial }));
  const best = (typed) => f.closest(typed, items, (i) => i.serial).map((x) => `${x.item.serial}:${x.distance}`);
  assert.deepEqual(best("E80729A3H15407"), ["E80729A3H154007:1"]);   // one missing
  assert.deepEqual(best("E80729A3H1540077"), ["E80729A3H154007:1"]); // one extra
  assert.deepEqual(best("E80729A3H154070"), ["E80729A3H154007:1"]);  // swapped
  assert.deepEqual(best("E8O729A3H154OO7"), ["E80729A3H154007:0"]);  // letter O for zero
  assert.deepEqual(f.closest("306", [{ id: "305" }], (i) => i.id), []); // short ids must be exact
});

test("context picks the record that fits the company", () => {
  assert.ok(f.contextScore("sa Suhay OPC po, accounting", "Suhay OPC") > 0);
  assert.equal(f.contextScore("Kettle Foods", "Suhay OPC"), 0);
});
