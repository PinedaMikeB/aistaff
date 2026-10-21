const test = require("node:test");
const assert = require("node:assert");
const bm = require("../src/branch-match");

const ferrer = ["Ferrer Studio", "Ferrer Studio Additional", "Ferrer Studio Back Up"].map((name, i) => ({ key: String(i), name }));
const cbs = [];
const cities = ["Tagaytay", "San Fernando", "Makati", "Cebu", "Davao", "Iloilo", "Baguio"];
for (const c of cities) {
  cbs.push({ key: `acc-${c}`, name: `China Bank Savings Inc. - Accounting Department ${c}` });
  cbs.push({ key: `hr-${c}`, name: `China Bank Savings Inc. - HR ${c}` });
  cbs.push({ key: `br-${c}`, name: `China Bank Savings Inc. ${c} Branch` });
}
const names = (list) => list.map((x) => (x.branch || x).name);

test("a distinguishing word picks one branch; the company name alone does not", () => {
  assert.deepEqual(names(bm.match("additional po", ferrer)), ["Ferrer Studio Additional"]);
  assert.deepEqual(names(bm.match("backup", ferrer)), ["Ferrer Studio Back Up"]);
  assert.deepEqual(names(bm.match("back up", ferrer)), ["Ferrer Studio Back Up"]);
  assert.deepEqual(names(bm.match("Ferrer Studio", ferrer)), []);
});

test("department narrows, location picks (with short forms and typos)", () => {
  const acc = bm.match("acctg", cbs);
  assert.equal(acc.length, 7);
  assert.ok(acc.every((x) => /Accounting/.test(x.branch.name)));
  const one = bm.match("accounting tagaytay", cbs);
  assert.equal(one[0].branch.name, "China Bank Savings Inc. - Accounting Department Tagaytay");
  assert.ok(one[0].score > one[1].score);
  assert.equal(bm.match("acctg san fernado", cbs)[0].branch.name, "China Bank Savings Inc. - Accounting Department San Fernando");
});

test("last resort list is short", () => {
  assert.equal(bm.closestByText("acounting dept", cbs, cbs, 5).length, 5);
  assert.equal(bm.closestByText("xyz", ferrer, ferrer, 5).length, 3);
});

test("only the company name (after we asked) = the main branch", () => {
  assert.deepEqual(names(bm.match("Ferrer Studio lang po", ferrer, ferrer, { allowPlain: true })), ["Ferrer Studio"]);
  assert.deepEqual(names(bm.match("main", ferrer, ferrer, { allowPlain: true })), ["Ferrer Studio"]);
  assert.deepEqual(names(bm.match("Ferrer Studio", ferrer)), []);
  assert.deepEqual(names(bm.match("need ink", ferrer, ferrer, { allowPlain: true })), []);
});

test("company words and initials never pick a branch", () => {
  const list = [{ key: "1", name: "China Bank Savings Inc- APD TAGAYTAY" }, { key: "2", name: "Tagaytay-Mendez (CBS)" }, { key: "3", name: "China Bank Savings Inc- Digital Banking" }, { key: "4", name: "Makati Chino Roces (CBS)" }, { key: "5", name: "Cebu (CBS)" }];
  const opts = { companyName: "China Bank Savings Inc." };
  assert.deepEqual(names(bm.match("china bank savings tagaytay", list, list, opts)).sort(), ["China Bank Savings Inc- APD TAGAYTAY", "Tagaytay-Mendez (CBS)"]);
  assert.deepEqual(names(bm.match("CBS tagaytay", list, list, opts)).sort(), ["China Bank Savings Inc- APD TAGAYTAY", "Tagaytay-Mendez (CBS)"]);
  assert.deepEqual(names(bm.match("china bank", list, list, opts)), []);
});
