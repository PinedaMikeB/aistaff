// Copy-quality validation tests (PARTS 21-22).

const test = require("node:test");
const assert = require("node:assert/strict");

const { normalizeRawPhrase, detectGrammarIssues, hasPlaceholderLeak, checkCopyQuality, validatePlanCopyQuality } = require("../../src/brandee/copyQuality");

test("normalizeRawPhrase fixes a raw comma-separated fragment into a natural joined phrase", () => {
  assert.equal(normalizeRawPhrase("business owner, companies"), "business owners and companies");
});

test("normalizeRawPhrase collapses whitespace and trims trailing punctuation", () => {
  assert.equal(normalizeRawPhrase("  small business owners.  "), "small business owners");
});

test("detectGrammarIssues catches the exact placeholder-instruction-leak bug found in the previous implementation", () => {
  const leaked = "Meet the business. (write final dialogue in natural Taglish, not stiff translated English)";
  const issues = detectGrammarIssues(leaked);
  assert.ok(issues.includes("authoring-instruction text leaked into copy"));
});

test("detectGrammarIssues catches duplicated words and repeated punctuation", () => {
  assert.ok(detectGrammarIssues("Get get started today").includes("duplicated word"));
  assert.ok(detectGrammarIssues("Amazing offer!!").includes("repeated punctuation"));
});

test("detectGrammarIssues catches an unresolved [placeholder] left in copy", () => {
  assert.ok(detectGrammarIssues("Get [result] today").includes("unresolved [placeholder]"));
});

test("hasPlaceholderLeak flags common authoring-instruction phrases", () => {
  assert.equal(hasPlaceholderLeak("TODO: insert proof here"), true);
  assert.equal(hasPlaceholderLeak("Shop now and save."), false);
});

test("checkCopyQuality passes clean, natural copy", () => {
  const result = checkCopyQuality("Shop now and save on your first order.");
  assert.equal(result.ok, true);
  assert.equal(result.issues.length, 0);
});

test("validatePlanCopyQuality flags every failing field across a plan-shaped object", () => {
  const plan = {
    strategy: { primaryHook: "Get get started", alternativeHooks: ["Clean hook here"] },
    script: { scenes: [{ sceneNumber: 1, dialogue: "Meet the business. (write final dialogue in natural Taglish)", caption: "Fine caption" }] },
    staticAdConcept: { headline: "Clean headline", supportingCopy: ["Also fine"] }
  };
  const failures = validatePlanCopyQuality(plan);
  assert.ok(failures.some((f) => f.field === "strategy.primaryHook"));
  assert.ok(failures.some((f) => f.field.includes("dialogue")));
  assert.ok(!failures.some((f) => f.field === "staticAdConcept.headline"));
});
