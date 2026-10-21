const test = require("node:test");
const assert = require("node:assert/strict");
const cases = require("../src/cases");
const { problemKey } = require("../src/resolve-loop");

const config = { director: { case: { keys: ["customerid", "branchid", "machineid", "category"] }, identify: { set: { machineid: "id" } } } };

test("need key: same customer/branch/machine/kind = same case; missing detail = no case yet", () => {
  const a = cases.needKeyFor("op1", config, { customerid: 316, branchid: 2885, machineid: 2941, category: "ink", description: "2 magenta" });
  const b = cases.needKeyFor("op1", config, { customerid: "316", branchid: 2885, machineid: 2941, category: "INK", description: "3 black" });
  const c = cases.needKeyFor("op1", config, { customerid: 316, branchid: 2885, machineid: 2941, category: "service" });
  assert.equal(a, b);
  assert.notEqual(a, c);
  assert.equal(cases.needKeyFor("op1", config, { customerid: 316, branchid: 2885, category: "ink" }), null);
  assert.equal(cases.needKeyFor("op1", { director: { identify: { set: { machineid: "id" } } } }, { machineid: 7 }), "op1|machineid=7");
});

test("case start = oldest replaced request; follow-ups counted; 15-minute alert limit", () => {
  const row = { created_at: "2026-10-20T00:00:00Z", followups: [
    { type: "replaced", since: "2026-10-19T12:55:00Z" }, { type: "followup", at: "2026-10-19T14:00:00Z", said: "wala pa po?", minutes_waiting: 65 }, { type: "followup", at: "2026-10-19T15:00:00Z" }
  ] };
  assert.equal(cases.caseStartedAt(row).toISOString(), "2026-10-19T12:55:00.000Z");
  assert.equal(cases.followupCount(row), 2);
  assert.equal(cases.alertDue({ last_alert_at: new Date(Date.now() - 5 * 60000) }), false);
  assert.equal(cases.alertDue({ last_alert_at: new Date(Date.now() - 16 * 60000) }), true);
  assert.equal(cases.alertDue({}), true);
  assert.match(cases.historyLines(row).join("\n"), /followed up \(65 min waiting\): "wala pa po\?"/);
});

test("same problem is recognised across wording changes", () => {
  const a = problemKey('No active messenger is assigned to area "South 3" (from branch area). Assign one in Master Schedule > Settings > Setup Technicians.');
  const b = problemKey('Tried again after Mike said it was fixed, but the company system still refused: HTTP 409: No active messenger is assigned to area "South 3" (from customer record, branch area). Assign one in Master Schedule > Settings > Setup Technicians.');
  assert.equal(a, b);
});
