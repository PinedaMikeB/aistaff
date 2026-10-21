const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { ENGINE_CATALOG } = require("../src/business-engine-catalog");
const {
  logicalToolName,
  engineInstructionKey,
  effectiveEngineInstruction,
  safeAuditMetadata,
  assertPolicyAllowed,
  toolSchemaForOperation,
  mapLogicalArguments
} = require("../src/business-engines");

test("catalog contains the four generic engines without tenant-specific logic", () => {
  assert.deepEqual(ENGINE_CATALOG.map((engine) => engine.key), ["customer_service", "booking", "sales", "finance"]);
  const serialized = JSON.stringify(ENGINE_CATALOG).toLowerCase();
  assert.doesNotMatch(serialized, /marga/);
  for (const engine of ENGINE_CATALOG) {
    assert.ok(engine.fields.length >= 15);
    assert.ok(engine.operations.length >= 10);
    assert.ok(engine.instruction.length > 120);
  }
});

test("customer service uses enabled identifier lookups before repeating questions", () => {
  const engine = ENGINE_CATALOG.find((item) => item.key === "customer_service");
  assert.match(engine.instruction, /unique identifier such as a machine serial number/i);
  assert.match(engine.instruction, /never ask again for information the lookup already returned/i);
  assert.equal(engine.version, 5);
});

test("new platform engine instructions replace older tenant snapshots", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "business-engines.js"), "utf8");
  assert.match(source, /prisma\.tenantEngine\.updateMany/);
  assert.match(source, /catalog_version: \{ lt: engine\.catalog_version \}/);
  assert.match(source, /default_instruction_snapshot: engine\.default_instruction/);
});

test("logical operation tool names are engine-namespaced and provider-safe", () => {
  assert.equal(logicalToolName("customer_service", "assign_staff"), "engine_customer_service_assign_staff");
  assert.equal(logicalToolName("booking", "assign_staff"), "engine_booking_assign_staff");
  assert.notEqual(logicalToolName("customer_service", "assign_staff"), logicalToolName("booking", "assign_staff"));
  assert.ok(logicalToolName("x".repeat(100), "y".repeat(100)).length <= 64);
});

test("platform minimum policy prevents weaker tenant policy", () => {
  assert.doesNotThrow(() => assertPolicyAllowed("staff_approval", "customer_confirmation"));
  assert.throws(() => assertPolicyAllowed("automatic", "customer_confirmation"), /cannot be less restrictive/i);
  assert.throws(() => assertPolicyAllowed("customer_confirmation", "staff_approval"), /cannot be less restrictive/i);
});

test("tool schema contains only enabled logical fields and required fields", () => {
  const operation = {
    policy: "customer_confirmation",
    definition: { required_fields: ["customer_id", "description"] }
  };
  const schema = toolSchemaForOperation(operation, [
    { field_key: "customer_id", data_type: "string", description: "Customer", enabled: true, required: false },
    { field_key: "description", data_type: "string", enabled: true, required: false },
    { field_key: "internal_notes", data_type: "string", enabled: false, required: true }
  ]);
  assert.deepEqual(schema.required.sort(), ["customer_id", "description"]);
  assert.ok(schema.properties._confirmation_id);
  assert.equal(schema.properties.internal_notes, undefined);
});

test("logical arguments map only through declared field mappings", () => {
  const operation = {
    mapping: { field_mapping: { customer_id: "customerId", description: "details" } },
    tenant_engine: { fields: [{ field_key: "priority", external_field: "severity" }] }
  };
  assert.deepEqual(mapLogicalArguments(operation, {
    customer_id: "C-1",
    description: "Offline",
    priority: "urgent",
    _confirmation_id: "confirm-1"
  }), { customerId: "C-1", details: "Offline", severity: "urgent", _confirmation_id: "confirm-1" });
});

test("tenant audit metadata recursively removes secret-like values", () => {
  assert.deepEqual(safeAuditMetadata({
    engine: "sales",
    apiKey: "should-not-survive",
    nested: { bearerToken: "hidden", mappedFields: ["lead_id"] }
  }), { engine: "sales", nested: { mappedFields: ["lead_id"] } });
});

test("backend routes require both authentication and tenant-admin authorization", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "routes", "business-engines.js"), "utf8");
  assert.match(source, /router\.use\(requireAuth, requireTenantAdmin\)/);
  assert.match(source, /account_admin/);
  assert.match(source, /req\.companyId/);
});

test("every tenant Business Engine query is explicitly scoped by company", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "business-engines.js"), "utf8");
  assert.match(source, /where: \{ company_id: companyId/);
  assert.match(source, /operation\.company_id !== companyId/);
  assert.match(source, /integrationAction\.findFirst\(\{ where: \{ id: actionId, company_id: companyId \}/);
});

test("mapped connector actions are excluded from legacy direct tool exposure", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "integrations.js"), "utf8");
  assert.match(source, /engine_mappings: \{ none: \{\} \}/);
  assert.match(source, /approvalPolicyOverride/);
});

test("disabled engines are filtered before runtime instructions and tools", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "business-engines.js"), "utf8");
  assert.match(source, /enabledOnly \? \{ enabled: true \}/);
  assert.match(source, /tenant_engine: \{ enabled: true/);
  assert.match(source, /operation\.policy === "staff_only"/);
});

test("tenant engine instructions are tenant-scoped, versioned, and replace the platform default", () => {
  const root = path.join(__dirname, "..");
  const engineSource = fs.readFileSync(path.join(root, "src", "business-engines.js"), "utf8");
  const routes = fs.readFileSync(path.join(root, "src", "routes", "business-engines.js"), "utf8");
  assert.equal(engineInstructionKey("tenant-a", "Customer Service"), "engine_instruction:tenant-a:customer_service");
  assert.equal(effectiveEngineInstruction({ tenant_instruction: "Custom", default_instruction_snapshot: "Default" }), "Custom");
  assert.equal(effectiveEngineInstruction({ tenant_instruction: "  ", default_instruction_snapshot: "Default" }), "Default");
  assert.match(engineSource, /effectiveEngineInstruction\(row\)/);
  assert.match(engineSource, /engine\.instruction_version_created/);
  assert.match(engineSource, /ACTIVE_INSTRUCTION_VERSION/);
  assert.match(routes, /\/:engineKey\/instructions\/activate/);
  assert.match(routes, /router\.delete\("\/:engineKey\/instructions\/:version"/);
  assert.match(routes, /router\.delete\("\/:engineKey\/instructions"/);
});

test("settings shell loads Business Engines and safe custom-field drafts", () => {
  const root = path.join(__dirname, "..");
  const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const shell = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const ui = fs.readFileSync(path.join(root, "public", "business-engines-settings.js"), "utf8");
  assert.match(appSource, /\["business-engines", "Business Engines"\]/);
  assert.match(shell, /business-engines-settings\.js\?v=\d{8}-[a-z0-9]+/);
  assert.match(ui, /Reset draft/);
  assert.match(ui, /Clear only this unsaved custom-field draft/);
  assert.match(ui, /guidedEngineSetup/);
  assert.match(ui, /Review and activate/);
  assert.match(ui, /Engine instructions/);
  assert.match(ui, /engineInstructionForm/);
  assert.match(ui, /Save new version/);
  assert.match(ui, /Use platform default/);
  assert.match(ui, /data-restore-engine-instruction/);
  assert.match(ui, /data-delete-engine-instruction/);
  assert.match(ui, /Advanced engine settings/);
  assert.doesNotMatch(ui, /localStorage\.setItem\([^\n]+credential/i);
});

test("connection testing is read-only and engine fallback is allowlisted", () => {
  const integrationSource = fs.readFileSync(path.join(__dirname, "..", "src", "integrations.js"), "utf8");
  const engineSource = fs.readFileSync(path.join(__dirname, "..", "src", "business-engines.js"), "utf8");
  assert.match(integrationSource, /method: "HEAD"/);
  assert.match(engineSource, /FALLBACK_POLICIES = \[/);
  assert.match(engineSource, /engine_request_human_help/);
  assert.doesNotMatch(engineSource, /args\?\.(url|method|endpoint)/);
});

test("guided activation rejects missing logical and external field matches", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "business-engines.js"), "utf8");
  assert.match(source, /UNRESOLVED_LOGICAL_FIELDS/);
  assert.match(source, /UNRESOLVED_FIELDS/);
  assert.match(source, /testConnection\(\{ companyId, connectionId \}\)/);
});
