const test = require("node:test");
const assert = require("node:assert/strict");
const bp = require("../src/engine-blueprint");

// Shape taken from a real imported OpenAPI action (POST /service-tickets).
const createTicket = {
  http_method: "POST",
  input_schema: {
    type: "object",
    required: ["customerid", "branchid", "category", "description", "priority", "fieldworkmachinestatusid"],
    properties: {
      dryrun: { type: "boolean", default: false },
      branchid: { type: "integer", minimum: 1 },
      category: { enum: ["service", "toner", "ink", "cartridge", "other"], type: "string" },
      priority: { enum: ["normal", "high", "critical"], type: "string" },
      machineid: { type: ["integer", "null"], minimum: 1 },
      customerid: { type: "integer", minimum: 1 },
      description: { type: "string", maxLength: 1000, minLength: 5 },
      idempotency_key: { type: "string", maxLength: 100, minLength: 8 },
      fieldworkmachinestatusid: { enum: [1, 2, 3, 4], type: "integer" }
    },
    additionalProperties: false
  }
};
const config = {
  value_labels: { fieldworkmachinestatusid: { 1: "Running / Print OK", 2: "Running / Print Problem", 3: "Down / No Print", 4: "Running / Best Mode Only" } },
  steps: ["machineid", "category", "fieldworkmachinestatusid", "description"],
  derived: [{ field: "priority", from: "fieldworkmachinestatusid", map: { 1: "normal", 2: "high", 3: "critical", 4: "high" }, default: "normal" }]
};

test("tool schema follows the API fields, hides server-owned ones, adds labels", () => {
  const blueprint = bp.normalizeBlueprint(config, createTicket);
  const schema = bp.buildBlueprintToolSchema(createTicket, blueprint, { confirmation: true });
  const keys = Object.keys(schema.properties).sort();
  assert.deepEqual(keys, ["_confirmation_id", "branchid", "category", "customerid", "description", "fieldworkmachinestatusid", "machineid"]);
  assert.equal(schema.required.length, 0);
  assert.match(schema.properties.fieldworkmachinestatusid.description, /3 = Down \/ No Print/);
  assert.match(schema.properties.machineid.description, /Numeric id from a lookup/);
});

test("arguments are coerced, renamed from logical names and unknown fields dropped", () => {
  const blueprint = bp.normalizeBlueprint(config, createTicket);
  const out = bp.prepareArguments(createTicket, blueprint, {
    machine_id: "2941", customerid: "677", category: "Toner", customer_name: "Mitejary", priority: "low", fieldworkmachinestatusid: "1"
  }, { machine_id: "machineid" });
  assert.deepEqual(out.args, { machineid: 2941, customerid: 677, category: "toner", fieldworkmachinestatusid: 1 });
  assert.deepEqual(out.ignored.sort(), ["customer_name", "priority"]);
  assert.equal(out.invalid.length, 0);
});

test("a serial number in an integer id field is explained, not silently sent", () => {
  const blueprint = bp.normalizeBlueprint(config, createTicket);
  const out = bp.prepareArguments(createTicket, blueprint, { machineid: "X8H5507464" });
  assert.equal(out.invalid[0].field, "machineid");
  assert.match(out.invalid[0].description, /never a name or serial/);
});

test("derived priority comes from machine status; missing follows the step order", () => {
  const blueprint = bp.normalizeBlueprint(config, createTicket);
  let args = bp.applyDerived({ customerid: 677, branchid: 2491, machineid: 2941 }, blueprint, createTicket.input_schema);
  assert.deepEqual(bp.missingFields(createTicket, blueprint, args), ["category", "fieldworkmachinestatusid", "description"]);
  args = bp.applyDerived({ ...args, category: "toner", fieldworkmachinestatusid: 3, description: "Needs black toner" }, blueprint, createTicket.input_schema);
  assert.equal(args.priority, "critical");
  assert.deepEqual(bp.missingFields(createTicket, blueprint, args), []);
  const next = bp.fieldFacts(createTicket, blueprint, "fieldworkmachinestatusid");
  assert.equal(next.allowed.length, 4);
});

test("anchors are found in common response places or configured paths", () => {
  const blueprint = bp.normalizeBlueprint({}, createTicket);
  const anchors = bp.extractAnchors({ ok: true, reference: "SR-2026-000123", status: "queued", scheduleReference: "88123", recordId: "123" }, blueprint);
  assert.deepEqual(anchors, { reference: "SR-2026-000123", status: "queued", schedule_reference: "88123", record_id: "123" });
  const custom = bp.normalizeBlueprint({ anchors: { reference: "facts.jobOrderNo" } }, createTicket);
  assert.equal(bp.extractAnchors({ facts: { jobOrderNo: "JO-9" } }, custom).reference, "JO-9");
});

test("warnings flag coded values without labels; validation rejects unknown fields", () => {
  const warnings = bp.blueprintWarnings(createTicket, bp.normalizeBlueprint({}, createTicket));
  assert.ok(warnings.some((text) => /fieldworkmachinestatusid/.test(text)));
  assert.throws(() => bp.validateWorkflowConfig({ steps: ["serial_number"] }, createTicket), /not a field/);
  assert.throws(() => bp.validateWorkflowConfig({ prompts: {} }, createTicket), /Unknown blueprint key/);
  assert.doesNotThrow(() => bp.validateWorkflowConfig(config, createTicket));
});

test("Gemini schema has no type unions, numeric enums or additionalProperties", () => {
  const blueprint = bp.normalizeBlueprint(config, createTicket);
  const gem = bp.sanitizeSchemaForGemini(bp.buildBlueprintToolSchema(createTicket, blueprint));
  const text = JSON.stringify(gem);
  assert.doesNotMatch(text, /additionalProperties|minLength/);
  assert.equal(gem.properties.machineid.type, "integer");
  assert.equal(gem.properties.machineid.nullable, true);
  assert.equal(gem.properties.fieldworkmachinestatusid.enum, undefined);
  assert.deepEqual(gem.properties.category.enum, ["service", "toner", "ink", "cartridge", "other"]);
});

test("placeholder values such as Not provided stay missing", () => {
  const action = { input_schema: { properties: { callername: { type: "string" } }, required: ["callername"] } };
  const blueprint = bp.normalizeBlueprint({}, action);
  const out = bp.prepareArguments(action, blueprint, { callername: "Not provided" });
  assert.deepEqual(out.args, {});
  assert.deepEqual(bp.missingFields(action, blueprint, out.args), ["callername"]);
});

test("lookups are limited to the customer identified in the conversation", () => {
  const allowed = new Set(["316"]);
  const list = bp.scopeResultToCustomers({ count: 3, tickets: [{ reference: "SR-1", customerId: 316 }, { reference: "SR-2", customerId: 677 }, { reference: "SR-3", customerId: 316 }] }, "customerId", allowed);
  assert.equal(list.data.tickets.length, 2);
  assert.equal(list.removed, 1);
  const other = bp.scopeResultToCustomers({ ticket: { reference: "SR-2", customerId: 677 } }, "customerId", allowed);
  assert.equal(other.blocked, true);
  assert.deepEqual(other.data, {});
});
