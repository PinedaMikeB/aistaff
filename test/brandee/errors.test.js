// Tests for the typed BrandeeError system (src/brandee/errors.js).
// Generic fixtures only — no owner/business-specific data.

const test = require("node:test");
const assert = require("node:assert/strict");

const { STAGES, ERROR_DEFAULTS, BrandeeError, toBrandeeError } = require("../../src/brandee/errors");

const REQUIRED_CODES = [
  "BRANDEE_INVALID_INPUT",
  "BRANDEE_INVALID_URL",
  "BRANDEE_URL_BLOCKED",
  "BRANDEE_SCRAPER_NOT_CONFIGURED",
  "BRANDEE_SCRAPER_FAILED",
  "BRANDEE_SCRAPER_TIMEOUT",
  "BRANDEE_EMPTY_WEBSITE_CONTENT",
  "BRANDEE_EXTRACTION_MODEL_NOT_CONFIGURED",
  "BRANDEE_EXTRACTION_MODEL_FAILED",
  "BRANDEE_EXTRACTION_SCHEMA_FAILED",
  "BRANDEE_RULES_NOT_LOADED",
  "BRANDEE_PLANNER_MODEL_NOT_CONFIGURED",
  "BRANDEE_PLANNER_MODEL_FAILED",
  "BRANDEE_PLANNER_SCHEMA_FAILED",
  "BRANDEE_PLAN_REPAIR_FAILED",
  "BRANDEE_DATABASE_FAILED",
  "BRANDEE_PLAN_NOT_FOUND",
  "BRANDEE_RATE_LIMITED",
  "BRANDEE_UNKNOWN_ERROR"
];

test("STAGES defines exactly the 7 approved stage names", () => {
  assert.deepEqual(Object.values(STAGES).sort(), ["extraction", "input", "persistence", "planning", "rules", "scraping", "validation"].sort());
});

test("all required error codes are defined with stage/publicMessage/retryable", () => {
  for (const code of REQUIRED_CODES) {
    const def = ERROR_DEFAULTS[code];
    assert.ok(def, `missing ERROR_DEFAULTS entry for ${code}`);
    assert.ok(Object.values(STAGES).includes(def.stage), `${code} has an invalid stage: ${def.stage}`);
    assert.equal(typeof def.publicMessage, "string");
    assert.ok(def.publicMessage.length > 0);
    assert.equal(typeof def.retryable, "boolean");
  }
});

test("required exact customer-facing copy for website-extraction and planning failures", () => {
  assert.equal(
    ERROR_DEFAULTS.BRANDEE_SCRAPER_FAILED.publicMessage,
    "Brandee could not read this website automatically. She can still build a plan from the details you entered."
  );
  assert.equal(
    ERROR_DEFAULTS.BRANDEE_PLANNER_MODEL_FAILED.publicMessage,
    "Brandee understood your business but could not complete the creative plan. Please retry."
  );
});

test("BrandeeError resolves defaults for a known code and exposes a requestId", () => {
  const err = new BrandeeError("BRANDEE_INVALID_URL");
  assert.equal(err.code, "BRANDEE_INVALID_URL");
  assert.equal(err.stage, "input");
  assert.equal(err.retryable, true);
  assert.ok(err.requestId && err.requestId.length > 0);
});

test("BrandeeError falls back to BRANDEE_UNKNOWN_ERROR for an unrecognized code", () => {
  const err = new BrandeeError("NOT_A_REAL_CODE");
  assert.equal(err.code, "BRANDEE_UNKNOWN_ERROR");
  assert.equal(err.stage, ERROR_DEFAULTS.BRANDEE_UNKNOWN_ERROR.stage);
});

test("BrandeeError accepts explicit overrides for stage/publicMessage/retryable/requestId", () => {
  const err = new BrandeeError("BRANDEE_SCRAPER_FAILED", {
    publicMessage: "Custom message for this case.",
    stage: "extraction",
    retryable: false,
    requestId: "test-request-id-123",
    internalMessage: "internal detail for logs only",
    metadata: { hostname: "example.com" }
  });
  assert.equal(err.publicMessage, "Custom message for this case.");
  assert.equal(err.stage, "extraction");
  assert.equal(err.retryable, false);
  assert.equal(err.requestId, "test-request-id-123");
});

test("toSafeJson() never leaks internalMessage, cause, metadata, or stack", () => {
  const err = new BrandeeError("BRANDEE_PLANNER_SCHEMA_FAILED", {
    internalMessage: "raw internal detail: sk-secret-key-abc123",
    cause: new Error("underlying provider error with a secret token xyz"),
    metadata: { apiKey: "should-never-leak" },
    requestId: "req-abc"
  });
  const safe = err.toSafeJson();
  const serialized = JSON.stringify(safe);
  assert.equal(safe.ok, false);
  assert.equal(safe.code, "BRANDEE_PLANNER_SCHEMA_FAILED");
  assert.equal(safe.requestId, "req-abc");
  assert.ok(typeof safe.retryable === "boolean");
  assert.equal(serialized.includes("secret"), false, "safe JSON must never include internal/cause/metadata text");
  assert.equal(serialized.includes("apiKey"), false);
  assert.equal("stack" in safe, false);
});

test("toLogEntry() preserves internal detail and cause message for server-side logs", () => {
  const cause = new Error("upstream provider returned 500");
  const err = new BrandeeError("BRANDEE_SCRAPER_FAILED", {
    internalMessage: "detailed internal explanation",
    cause,
    metadata: { attempt: 1 },
    requestId: "req-xyz"
  });
  const logEntry = err.toLogEntry();
  assert.equal(logEntry.code, "BRANDEE_SCRAPER_FAILED");
  assert.equal(logEntry.requestId, "req-xyz");
  assert.equal(logEntry.internalMessage, "detailed internal explanation");
  assert.equal(logEntry.cause, "upstream provider returned 500");
  assert.deepEqual(logEntry.metadata, { attempt: 1 });
});

test("toBrandeeError() passes an existing BrandeeError through unchanged", () => {
  const original = new BrandeeError("BRANDEE_RATE_LIMITED", { requestId: "req-1" });
  const wrapped = toBrandeeError(original, { code: "BRANDEE_UNKNOWN_ERROR", stage: "planning" });
  assert.equal(wrapped, original);
});

test("toBrandeeError() wraps a plain Error with the supplied code/stage/requestId", () => {
  const plain = new Error("some low-level failure");
  const wrapped = toBrandeeError(plain, { code: "BRANDEE_DATABASE_FAILED", stage: "persistence", requestId: "req-2" });
  assert.ok(wrapped instanceof BrandeeError);
  assert.equal(wrapped.code, "BRANDEE_DATABASE_FAILED");
  assert.equal(wrapped.stage, "persistence");
  assert.equal(wrapped.requestId, "req-2");
  assert.equal(wrapped.cause, plain);
});
