const test = require("node:test");
const assert = require("node:assert/strict");

const { AnalyzeRequestSchema, BrandeeCreativePlanSchema } = require("../../src/brandee/schemas");

test("AnalyzeRequestSchema accepts a valid Business Analysis form submission", () => {
  const result = AnalyzeRequestSchema.safeParse({
    selectedGoal: "messages",
    url: "https://sample-rentals.example/",
    whatYouSell: "Office equipment rental",
    idealCustomer: "Office administrators",
    platform: "facebook",
    language: "taglish"
  });
  assert.equal(result.success, true);
});

test("AnalyzeRequestSchema rejects an unapproved goal slug", () => {
  const result = AnalyzeRequestSchema.safeParse({
    selectedGoal: "not-a-real-goal",
    url: "https://sample-rentals.example/",
    whatYouSell: "x",
    idealCustomer: "y",
    platform: "facebook",
    language: "taglish"
  });
  assert.equal(result.success, false);
});

test("AnalyzeRequestSchema rejects a missing required field (url)", () => {
  const result = AnalyzeRequestSchema.safeParse({
    selectedGoal: "messages",
    url: "",
    whatYouSell: "x",
    idealCustomer: "y",
    platform: "facebook",
    language: "taglish"
  });
  assert.equal(result.success, false);
});

test("AnalyzeRequestSchema rejects an unsupported platform/language enum value", () => {
  assert.equal(AnalyzeRequestSchema.safeParse({
    selectedGoal: "messages", url: "https://x.com", whatYouSell: "x", idealCustomer: "y", platform: "snapchat", language: "taglish"
  }).success, false);
  assert.equal(AnalyzeRequestSchema.safeParse({
    selectedGoal: "messages", url: "https://x.com", whatYouSell: "x", idealCustomer: "y", platform: "facebook", language: "klingon"
  }).success, false);
});

test("BrandeeCreativePlanSchema rejects a malformed/incomplete AI-shaped object (never trust raw AI text)", () => {
  const malformed = { planId: "abc", strategy: { primaryHook: "hi" } }; // missing nearly everything
  const result = BrandeeCreativePlanSchema.safeParse(malformed);
  assert.equal(result.success, false);
  assert.ok(result.error.issues.length > 0);
});
