// Pricing configuration tests (PART 14).
// Confirms image and video allowances are tracked as SEPARATE fields (not a
// combined "static ads or videos" count), that every plan is explicitly
// marked as a placeholder pending real cost data, that no plan claims
// "unlimited", and that anonymous preview limits match PART 13 (one image
// preview or one video preview per session).

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BRANDEE_PRODUCT_SLUG,
  BRANDEE_PRODUCT_NAME,
  PRICING_QUANTITIES_ARE_PLACEHOLDERS,
  PLANS,
  ANONYMOUS_LIMITS,
  getPlan,
  listPlans
} = require("../../src/brandee/pricingConfig");

test("at least the three suggested tiers (starter/creator/growth) exist", () => {
  const slugs = PLANS.map((p) => p.slug);
  assert.ok(slugs.includes("starter"));
  assert.ok(slugs.includes("creator"));
  assert.ok(slugs.includes("growth"));
});

test("every plan tracks image and video allowances as separate numeric fields", () => {
  for (const plan of PLANS) {
    assert.equal(typeof plan.imageCreditsPerMonth, "number", `${plan.slug} missing imageCreditsPerMonth`);
    assert.equal(typeof plan.videoCreditsPerMonth, "number", `${plan.slug} missing videoCreditsPerMonth`);
  }
});

test("no plan feature text uses combined 'static ads or videos' style wording", () => {
  for (const plan of PLANS) {
    const haystack = [plan.tagline, plan.bestFor, ...(plan.features || [])].join(" ").toLowerCase();
    assert.ok(!haystack.includes("static ads or videos"), `${plan.slug} still uses combined static-ads-or-videos wording`);
    assert.ok(!haystack.includes("ads or videos"), `${plan.slug} still combines image and video allowances into one wording`);
  }
});

test("every plan is explicitly marked as a placeholder pending real production-cost data", () => {
  assert.equal(PRICING_QUANTITIES_ARE_PLACEHOLDERS, true);
  for (const plan of PLANS) {
    assert.equal(plan.placeholder, true, `${plan.slug} must be marked placeholder: true`);
  }
});

test("no plan displays 'unlimited' anywhere in its copy", () => {
  for (const plan of PLANS) {
    const haystack = JSON.stringify(plan).toLowerCase();
    assert.ok(!haystack.includes("unlimited"), `${plan.slug} must not claim unlimited`);
  }
});

test("higher tiers grant strictly greater or equal image and video allowances than lower tiers", () => {
  const starter = getPlan("starter");
  const creator = getPlan("creator");
  const growth = getPlan("growth");
  assert.ok(creator.imageCreditsPerMonth >= starter.imageCreditsPerMonth);
  assert.ok(growth.imageCreditsPerMonth >= creator.imageCreditsPerMonth);
  assert.ok(creator.videoCreditsPerMonth >= starter.videoCreditsPerMonth);
  assert.ok(growth.videoCreditsPerMonth >= creator.videoCreditsPerMonth);
});

test("getPlan returns null for an unknown slug, and the correct plan for a known one", () => {
  assert.equal(getPlan("does-not-exist"), null);
  assert.equal(getPlan("starter").name, "Starter");
});

test("listPlans returns all configured plans", () => {
  assert.equal(listPlans().length, PLANS.length);
});

test("ANONYMOUS_LIMITS allows exactly one free image preview and one free video preview per session (PART 13)", () => {
  assert.equal(ANONYMOUS_LIMITS.imagePreviewsPerSession, 1);
  assert.equal(ANONYMOUS_LIMITS.videoPreviewsPerSession, 1);
});

test("BRANDEE_PRODUCT_SLUG/NAME are defined for the billing catalog seed", () => {
  assert.equal(typeof BRANDEE_PRODUCT_SLUG, "string");
  assert.ok(BRANDEE_PRODUCT_SLUG.length > 0);
  assert.equal(typeof BRANDEE_PRODUCT_NAME, "string");
});
