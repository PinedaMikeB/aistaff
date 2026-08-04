const test = require("node:test");
const assert = require("node:assert/strict");

const { HOOK_TEMPLATES, HOOK_CATEGORIES, candidateHooks, fillHookTemplate, getHookById } = require("../../src/brandee/hooks");
const { STATIC_AD_FRAMEWORKS, candidateFrameworks, getFrameworkById } = require("../../src/brandee/frameworks");
const { HookScoreSchema } = require("../../src/brandee/schemas");

test("all 100 approved hook templates are encoded, with unique ids", () => {
  assert.equal(HOOK_TEMPLATES.length, 100);
  assert.equal(new Set(HOOK_TEMPLATES.map((h) => h.id)).size, 100);
});

test("hooks are distributed across categories per the approved framework (20/20/10x6)", () => {
  const counts = {};
  for (const h of HOOK_TEMPLATES) counts[h.category] = (counts[h.category] || 0) + 1;
  assert.equal(counts.curiosity, 20);
  assert.equal(counts.story, 20);
  for (const cat of ["authority", "direct", "problem", "social_proof", "question", "urgency"]) {
    assert.equal(counts[cat], 10, `expected 10 ${cat} hooks`);
  }
  assert.equal(HOOK_CATEGORIES.length, 8);
});

test("high-risk hooks named in the brief require proof and are excluded when proof is unavailable", () => {
  const h046 = getHookById("h046"); // "the only one that works"
  assert.equal(h046.canUseWithoutProof, false);
  const h078 = getHookById("h078"); // "thousands of 5-star reviews"
  assert.equal(h078.canUseWithoutProof, false);
  const h091 = getHookById("h091"); // urgency, "won't last long"
  assert.equal(h091.canUseWithoutProof, false);

  const withoutProof = candidateHooks({ availableProofTypes: [] }).map((h) => h.id);
  assert.ok(!withoutProof.includes("h046"));
  assert.ok(!withoutProof.includes("h078"));
  assert.ok(!withoutProof.includes("h091"));
});

test("proof-gated hooks become available once the required proof type is present", () => {
  const withReviews = candidateHooks({ availableProofTypes: ["review_count", "rating"] }).map((h) => h.id);
  assert.ok(withReviews.includes("h078"));
});

test("fillHookTemplate leaves an honest bracketed placeholder rather than inventing a value", () => {
  const filled = fillHookTemplate("After {{years}} years of doing {{activity}}", { activity: "printer rental" });
  assert.equal(filled, "After [years] years of doing printer rental");
});

test("all 10 approved static-ad frameworks are encoded", () => {
  assert.equal(STATIC_AD_FRAMEWORKS.length, 10);
  const ids = STATIC_AD_FRAMEWORKS.map((f) => f.id);
  for (const expected of ["us-vs-them", "bold-claim", "iphone-notes", "features-and-benefits", "before-and-after", "offer", "testimonial", "question", "reasons-why", "sticky-notes"]) {
    assert.ok(ids.includes(expected), `missing framework ${expected}`);
  }
});

test("Testimonial framework is excluded from candidates when no testimonial is verified", () => {
  const withoutProof = candidateFrameworks({ availableProofTypes: [] }).map((f) => f.id);
  assert.ok(!withoutProof.includes("testimonial"));
  const withTestimonial = candidateFrameworks({ availableProofTypes: ["verified_testimonial"] }).map((f) => f.id);
  assert.ok(withTestimonial.includes("testimonial"));
});

test("Offer framework is excluded unless a real offer is present", () => {
  const withoutOffer = candidateFrameworks({ availableProofTypes: [] }).map((f) => f.id);
  assert.ok(!withoutOffer.includes("offer"));
  const withOffer = candidateFrameworks({ availableProofTypes: ["real_offer"] }).map((f) => f.id);
  assert.ok(withOffer.includes("offer"));
});

test("HookScoreSchema enforces valid ranges and rejects out-of-range scores (11 dimensions, PART 19)", () => {
  const valid = {
    hook: "Test hook", category: "question", templateId: "h081",
    scores: {
      relevance: 5, clarity: 5, specificity: 5, curiosity: 5, credibility: 5, audienceFit: 5, platformFit: 5, goalAlignment: 5,
      proofSafety: 5, naturalness: 5, distinctiveness: 5
    },
    total: 55, maximum: 55, status: "approved", explanation: "Fits well."
  };
  assert.equal(HookScoreSchema.safeParse(valid).success, true);

  const invalid = { ...valid, scores: { ...valid.scores, relevance: 9 } }; // out of 1-5 range
  assert.equal(HookScoreSchema.safeParse(invalid).success, false);

  const badStatus = { ...valid, status: "maybe" };
  assert.equal(HookScoreSchema.safeParse(badStatus).success, false);

  const missingDimension = { ...valid, scores: { ...valid.scores } };
  delete missingDimension.scores.proofSafety;
  assert.equal(HookScoreSchema.safeParse(missingDimension).success, false, "all 11 scoring dimensions must be present");
});

test("getFrameworkById / getHookById return null for unknown ids instead of throwing", () => {
  assert.equal(getFrameworkById("does-not-exist"), null);
  assert.equal(getHookById("h999"), null);
});
