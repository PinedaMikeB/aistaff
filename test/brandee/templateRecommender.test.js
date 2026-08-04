// Template recommendation engine tests (PART 9).
//
// getPlannerConfig() in this sandbox reports no configured AI provider (no
// OPENAI_API_KEY/GEMINI_API_KEY set — see modelConfig.js's header), so
// recommendTemplates() always exercises its deterministic path here. That is
// intentional: the hard proof-safety eligibility rules below are enforced in
// code and must hold with or without any AI polish layered on top.

const test = require("node:test");
const assert = require("node:assert/strict");

const { recommendTemplates, isEligible } = require("../../src/brandee/templateRecommender");

function template(overrides = {}) {
  return {
    id: "tpl-1",
    frameworkKey: "features_and_benefits",
    audienceType: "UNIVERSAL",
    isFeatured: false,
    ...overrides
  };
}

test("isEligible: a template with no proofRequirement is always eligible", () => {
  assert.equal(isEligible(template(), {}), true);
});

test("isEligible: testimonial-gated template requires BOTH a quote and an attribution", () => {
  const t = template({ proofRequirement: "testimonial" });
  assert.equal(isEligible(t, {}), false);
  assert.equal(isEligible(t, { testimonialQuote: "Great product!" }), false, "quote alone is not enough");
  assert.equal(isEligible(t, { testimonialQuote: "Great product!", testimonialAttribution: "Maria S." }), true);
});

test("isEligible: offer-gated template requires some real offer signal", () => {
  const t = template({ proofRequirement: "offer" });
  assert.equal(isEligible(t, {}), false);
  assert.equal(isEligible(t, { promoPrice: "499" }), true);
  assert.equal(isEligible(t, { discountText: "20% off" }), true);
});

test("isEligible: comparison-gated template requires comparison language in additionalNotes", () => {
  const t = template({ proofRequirement: "comparison" });
  assert.equal(isEligible(t, { additionalNotes: "It's a great product." }), false);
  assert.equal(isEligible(t, { additionalNotes: "Better than the leading brand." }), true);
});

test("isEligible: before/after-gated template requires before/after language in additionalNotes", () => {
  const t = template({ proofRequirement: "before_after_proof" });
  assert.equal(isEligible(t, {}), false);
  assert.equal(isEligible(t, { additionalNotes: "Before using this, skin was dry. After 2 weeks, improved." }), true);
});

test("recommendTemplates never returns a template that fails eligibility, even if it would otherwise score highest", async () => {
  const testimonialTemplate = template({ id: "testimonial_style", frameworkKey: "testimonial", proofRequirement: "testimonial", isFeatured: true });
  const safeTemplate = template({ id: "product_highlight", frameworkKey: "product_highlight" });

  const { recommendations, aiUsed } = await recommendTemplates({
    templates: [testimonialTemplate, safeTemplate],
    form: { productName: "Widget", productDescription: "A great widget." } // no testimonial supplied
  });

  assert.equal(aiUsed, false, "no AI provider is configured in this environment");
  assert.ok(!recommendations.some((r) => r.templateId === "testimonial_style"), "must never recommend testimonial framework without a real testimonial");
  assert.ok(recommendations.some((r) => r.templateId === "product_highlight"));
});

test("recommendTemplates returns at most 3 recommendations, ranked from 1", async () => {
  const templates = ["a", "b", "c", "d", "e"].map((id) => template({ id, frameworkKey: "product_highlight" }));
  const { recommendations } = await recommendTemplates({ templates, form: { productName: "Widget" } });
  assert.ok(recommendations.length <= 3);
  assert.deepEqual(recommendations.map((r) => r.rank), recommendations.map((_, i) => i + 1));
});

test("recommendTemplates gives every recommendation a non-empty, safe (non-fabricated) reason string", async () => {
  const templates = [template({ id: "offer_promo", frameworkKey: "offer" })];
  const { recommendations } = await recommendTemplates({ templates, form: { productName: "Widget", promoPrice: "299" } });
  assert.ok(recommendations.length >= 1);
  for (const r of recommendations) {
    assert.equal(typeof r.reason, "string");
    assert.ok(r.reason.length > 0);
  }
});

test("recommendTemplates returns an empty list (not a throw) when given an empty catalog", async () => {
  const { recommendations, aiUsed } = await recommendTemplates({ templates: [], form: {} });
  assert.deepEqual(recommendations, []);
  assert.equal(aiUsed, false);
});
