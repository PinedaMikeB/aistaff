const test = require("node:test");
const assert = require("node:assert/strict");

const cb = require("../../src/admin/creativeBrain");

test("Hook Framework validates to exactly 100 templates and status Active", () => {
  const result = cb.validateHookLibrary();
  assert.equal(result.itemCount, 100);
  assert.equal(result.expectedItemCount, cb.EXPECTED_COUNTS.hookTemplates);
  assert.equal(result.status, cb.STATUS.ACTIVE);
  assert.equal(result.validationStatus, "Passed");
});

test("Static Ad Frameworks validates to exactly 10 frameworks and status Active", () => {
  const result = cb.validateStaticAdFrameworks();
  assert.equal(result.itemCount, 10);
  assert.equal(result.expectedItemCount, cb.EXPECTED_COUNTS.staticAdFrameworks);
  assert.equal(result.status, cb.STATUS.ACTIVE);
});

test("Goal Mappings validates to exactly 7 business goals", () => {
  const result = cb.validateGoalMappings();
  assert.equal(result.itemCount, 7);
  assert.equal(result.expectedItemCount, cb.EXPECTED_COUNTS.businessGoals);
  assert.equal(result.status, cb.STATUS.ACTIVE);
});

test("Awareness Rules validates to exactly 5 levels", () => {
  const result = cb.validateAwarenessRules();
  assert.equal(result.itemCount, 5);
  assert.equal(result.expectedItemCount, cb.EXPECTED_COUNTS.awarenessLevels);
  assert.equal(result.status, cb.STATUS.ACTIVE);
});

test("Ad Creative Skill correctly reports Missing (not fabricated as Active) since it was never vendored into this repo", () => {
  const result = cb.validateAdCreativeSkill();
  assert.equal(result.status, cb.STATUS.MISSING);
  assert.equal(result.presentLocally, false);
  assert.equal(result.distinctions.actuallyUsedByPlanner, false);
  assert.equal(result.distinctions.rulesAdaptedIntoRuntime, false);
});

test("Performance Diagnostics correctly reports Missing/Not validated rather than a fabricated status", () => {
  const result = cb.validatePerformanceDiagnostics();
  assert.equal(result.status, cb.STATUS.MISSING);
  assert.equal(result.validationStatus, "Not validated");
});

test("Business Profile Schema and Creative Plan Schema are real Zod schemas that reject malformed input", () => {
  const business = require("../../src/brandee/schemas").WebsiteBusinessAnalysisSchema;
  const plan = require("../../src/brandee/schemas").BrandeeCreativePlanSchema;
  assert.equal(business.safeParse({ nonsense: true }).success, false);
  assert.equal(plan.safeParse({ nonsense: true }).success, false);

  const businessResult = cb.validatePlatformRules ? null : null; // no-op guard, real check below
  const schemaResults = cb.validateAllResources();
  assert.equal(schemaResults.businessProfileSchema.status, cb.STATUS.ACTIVE);
  assert.equal(schemaResults.creativePlanSchema.status, cb.STATUS.ACTIVE);
});

test("validateAllResources never throws and returns an entry for every declared resource", () => {
  const results = cb.validateAllResources();
  const expectedKeys = Object.keys(cb.RESOURCE_VALIDATORS);
  for (const key of expectedKeys) {
    assert.ok(results[key], `missing result for ${key}`);
    assert.ok(results[key].status, `missing status for ${key}`);
  }
});

test("getCreativeBrainStatus reports active=false whenever any resource is Invalid (does not paper over failures)", () => {
  const status = cb.getCreativeBrainStatus();
  const results = cb.validateAllResources();
  const anyInvalid = Object.values(results).some((r) => r.status === cb.STATUS.INVALID);
  assert.equal(status.active, !anyInvalid);
});
