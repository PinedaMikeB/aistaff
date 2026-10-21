const test = require("node:test");
const assert = require("node:assert");
const rules = require("../src/scheduling-rules");

const marga = { enabled: true, cutoff_time: "16:00", working_days: [1, 2, 3, 4, 5, 6], lead_days: 1, prep_keywords: "toner, ink, cartridge, parts", prep_days: 1 };
const at = (s) => new Date(s + "+08:00");

test("cut-off: preparation items after the cut-off get an extra working day", () => {
  assert.equal(rules.targetDate(marga, { at: at("2026-10-20T10:00:00"), text: "ink" }).date, "2026-10-21");
  assert.equal(rules.targetDate(marga, { at: at("2026-10-20T17:00:00"), text: "need 2 magenta ink" }).date, "2026-10-22");
  assert.equal(rules.targetDate(marga, { at: at("2026-10-20T17:00:00"), text: "paper jam" }).date, "2026-10-21");
  assert.equal(rules.targetDate(marga, { at: at("2026-10-24T17:00:00"), text: "toner" }).date, "2026-10-27");
  assert.equal(rules.targetDate({ ...marga, holidays: ["2026-10-21"] }, { at: at("2026-10-20T10:00:00"), text: "service" }).date, "2026-10-22");
});

test("cut-off: off by default, so nothing is added", async () => {
  assert.equal(rules.normalize({}).enabled, false);
  assert.deepEqual(rules.promptLines({}), []);
  const action = { input_schema: { properties: { scheduleddate: { type: "string", format: "date" } } } };
  const args = { category: "ink" };
  assert.deepEqual(await rules.applyToArgs({ companyId: null, action, args }), args);
});
