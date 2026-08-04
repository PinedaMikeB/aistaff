// Tests for the Deterministic Decision Engine (src/brandee/decisionEngine.js).
// Uses only generic, clearly-fictional sanitized fixtures (e.g. "Sample Co"),
// never the owner's real business/website/expected answer — per the explicit
// "no owner-specific fixtures" constraint for this feature.

const test = require("node:test");
const assert = require("node:assert/strict");

const { buildDecisionConstraints, computeAvailableProofTypes, buildRestrictedClaims, aspectRatioForPlatform, validateFrameworkAlignment } = require("../../src/brandee/decisionEngine");
const { BrandeeError } = require("../../src/brandee/errors");
const { STATIC_AD_FRAMEWORKS } = require("../../src/brandee/frameworks");
const { HOOK_CATEGORIES } = require("../../src/brandee/hooks");

const bareBusinessAnalysis = {
  sourceUrl: "https://sample-co.example/",
  businessName: "Sample Co",
  businessType: "service",
  industry: "generic professional services",
  summary: "A generic sample service business used only for testing.",
  productsOrServices: [{ name: "Consulting Session", description: null, price: null }],
  targetAudienceSignals: [],
  primaryProblemsSolved: [],
  differentiators: [],
  offers: [],
  callsToAction: [],
  contactMethods: [],
  locations: [],
  proof: { testimonials: [], reviewCount: null, rating: null, customerCount: null, yearsInBusiness: null, awards: [], certifications: [], guarantees: [] },
  brandTone: [],
  claimsFound: [],
  missingInformation: ["Everything — no proof available in this fixture"],
  confidence: 0.3,
  fetchStatus: "ok"
};

const richBusinessAnalysis = {
  ...bareBusinessAnalysis,
  differentiators: ["Only provider offering same-day turnaround"],
  offers: ["Sign up this month for a limited-time discount"],
  proof: {
    testimonials: [{ quote: "Great service.", attribution: "A customer", sourceText: null }],
    reviewCount: 120,
    rating: 4.8,
    customerCount: 500,
    yearsInBusiness: 8,
    awards: [],
    certifications: [],
    guarantees: []
  }
};

const genericForm = {
  selectedGoal: "purchase",
  url: "https://sample-co.example/",
  whatYouSell: "Generic consulting services",
  idealCustomer: "Small business owners",
  platform: "facebook",
  language: "english",
  offer: null,
  differentiator: null
};

test("buildDecisionConstraints throws BRANDEE_RULES_NOT_LOADED when called without businessAnalysis/form", () => {
  assert.throws(() => buildDecisionConstraints({}), (err) => {
    assert.ok(err instanceof BrandeeError);
    assert.equal(err.code, "BRANDEE_RULES_NOT_LOADED");
    return true;
  });
});

test("with no proof at all, proof-gated frameworks are blocked with a stated reason", () => {
  const constraints = buildDecisionConstraints({ businessAnalysis: bareBusinessAnalysis, form: genericForm });
  const blockedIds = constraints.blockedFrameworks.map((f) => f.id);
  assert.ok(blockedIds.includes("testimonial"), "Testimonial framework must be blocked without a verified testimonial");
  assert.ok(blockedIds.includes("offer"), "Offer framework must be blocked without a real offer");
  assert.ok(!constraints.allowedFrameworkIds.includes("testimonial"));
  for (const blocked of constraints.blockedFrameworks) {
    assert.ok(blocked.reason && blocked.reason.length > 0);
  }
});

test("with rich verified proof, proof-gated frameworks become allowed", () => {
  const constraints = buildDecisionConstraints({ businessAnalysis: richBusinessAnalysis, form: genericForm });
  assert.ok(constraints.allowedFrameworkIds.includes("testimonial"));
  assert.ok(constraints.allowedFrameworkIds.includes("offer"));
});

test("allowedFrameworkIds and blockedFrameworks partition the full approved 10-framework list exactly once", () => {
  const constraints = buildDecisionConstraints({ businessAnalysis: bareBusinessAnalysis, form: genericForm });
  const allIds = STATIC_AD_FRAMEWORKS.map((f) => f.id);
  const seen = new Set([...constraints.allowedFrameworkIds, ...constraints.blockedFrameworks.map((f) => f.id)]);
  assert.equal(seen.size, allIds.length);
  for (const id of allIds) assert.ok(seen.has(id));
});

test("blocked hook categories only appear when every hook in that category requires unmet proof", () => {
  const constraints = buildDecisionConstraints({ businessAnalysis: bareBusinessAnalysis, form: genericForm });
  assert.ok(constraints.blockedHookCategories.every((b) => HOOK_CATEGORIES.includes(b.category)));
  assert.ok(constraints.allowedHookCategories.every((c) => HOOK_CATEGORIES.includes(c)));
  // curiosity/direct/problem/question hooks require no proof, so they must
  // always be allowed even with zero proof.
  assert.ok(constraints.allowedHookCategories.includes("curiosity"));
  assert.ok(constraints.allowedHookCategories.includes("direct"));
});

test("proofRestrictions lists claim types Brandee must not make when proof is absent", () => {
  const constraints = buildDecisionConstraints({ businessAnalysis: bareBusinessAnalysis, form: genericForm });
  assert.ok(constraints.proofRestrictions.some((r) => /testimonial/i.test(r)));
  assert.ok(constraints.proofRestrictions.some((r) => /review count/i.test(r)));
});

test("goal is never silently overridden — goalChanged flags a recommendation without changing selectedGoal", () => {
  const constraints = buildDecisionConstraints({ businessAnalysis: bareBusinessAnalysis, form: genericForm });
  assert.equal(constraints.selectedGoal, genericForm.selectedGoal);
  if (constraints.goalChanged) {
    assert.notEqual(constraints.recommendedGoal, constraints.selectedGoal);
    assert.ok(constraints.goalExplanation.length > 0);
    // effectiveGoal previews under the recommendation only until accepted —
    // selectedGoal itself must remain the customer's original choice.
    assert.equal(constraints.effectiveGoal, constraints.recommendedGoal);
  }
});

test("acceptedGoalOverride takes precedence over any recommendation", () => {
  const overriddenForm = { ...genericForm, acceptedGoalOverride: "visit" };
  const constraints = buildDecisionConstraints({ businessAnalysis: bareBusinessAnalysis, form: overriddenForm });
  assert.equal(constraints.effectiveGoal, "visit");
});

test("platformConstraints.aspectRatio matches aspectRatioForPlatform for the submitted platform", () => {
  for (const platform of ["facebook", "instagram", "tiktok", "youtube", "website", "multiple"]) {
    const constraints = buildDecisionConstraints({ businessAnalysis: bareBusinessAnalysis, form: { ...genericForm, platform } });
    assert.equal(constraints.platformConstraints.aspectRatio, aspectRatioForPlatform(platform));
  }
});

test("computeAvailableProofTypes + buildRestrictedClaims stay consistent with each other", () => {
  const types = computeAvailableProofTypes({ businessAnalysis: richBusinessAnalysis, form: genericForm });
  const restricted = buildRestrictedClaims(types);
  assert.equal(restricted.some((r) => /testimonial/i.test(r)), false, "verified testimonial present, so it must not be restricted");
});

// PART 27/30 — framework/headline alignment validation.

test("validateFrameworkAlignment requires the Question framework's headline to actually be a question", () => {
  const questionFramework = STATIC_AD_FRAMEWORKS.find((f) => f.id === "question");
  const bad = validateFrameworkAlignment({ framework: questionFramework, headline: "This is not phrased as a question", businessAnalysis: bareBusinessAnalysis });
  assert.equal(bad.aligned, false);
  assert.ok(bad.reasons.some((r) => /question/i.test(r)));

  const good = validateFrameworkAlignment({ framework: questionFramework, headline: "Ready to save time every week?", businessAnalysis: bareBusinessAnalysis });
  assert.equal(good.aligned, true);
});

test("validateFrameworkAlignment blocks the Testimonial framework without a verified testimonial, and allows it once one exists", () => {
  const testimonialFramework = STATIC_AD_FRAMEWORKS.find((f) => f.id === "testimonial");
  const bad = validateFrameworkAlignment({ framework: testimonialFramework, headline: "Here's what our customers say", businessAnalysis: bareBusinessAnalysis });
  assert.equal(bad.aligned, false);

  const good = validateFrameworkAlignment({ framework: testimonialFramework, headline: "Here's what our customers say", businessAnalysis: richBusinessAnalysis });
  assert.equal(good.aligned, true);
});

test("validateFrameworkAlignment blocks the Offer framework without a real offer, and the Before-and-After framework without a real problem", () => {
  const offerFramework = STATIC_AD_FRAMEWORKS.find((f) => f.id === "offer");
  const beforeAfterFramework = STATIC_AD_FRAMEWORKS.find((f) => f.id === "before-and-after");

  const noOffer = validateFrameworkAlignment({ framework: offerFramework, headline: "Get this special deal today", businessAnalysis: bareBusinessAnalysis });
  assert.equal(noOffer.aligned, false);
  assert.ok(noOffer.reasons.some((r) => /offer/i.test(r)));

  const noProblem = validateFrameworkAlignment({ framework: beforeAfterFramework, headline: "See the transformation", businessAnalysis: bareBusinessAnalysis });
  assert.equal(noProblem.aligned, false);
  assert.ok(noProblem.reasons.some((r) => /transformation/i.test(r)));

  const withProblem = validateFrameworkAlignment({
    framework: beforeAfterFramework,
    headline: "See the transformation",
    businessAnalysis: { ...bareBusinessAnalysis, primaryProblemsSolved: ["Slow response times"] }
  });
  assert.equal(withProblem.aligned, true);
});

test("validateFrameworkAlignment blocks Us vs. Them without a differentiator, and Bold Claim with an unsupported absolute promise", () => {
  const usVsThemFramework = STATIC_AD_FRAMEWORKS.find((f) => f.id === "us-vs-them");
  const boldClaimFramework = STATIC_AD_FRAMEWORKS.find((f) => f.id === "bold-claim");

  const noDifferentiator = validateFrameworkAlignment({ framework: usVsThemFramework, headline: "Why we're different", businessAnalysis: bareBusinessAnalysis });
  assert.equal(noDifferentiator.aligned, false);

  const withDifferentiator = validateFrameworkAlignment({ framework: usVsThemFramework, headline: "Why we're different", businessAnalysis: richBusinessAnalysis });
  assert.equal(withDifferentiator.aligned, true);

  const unsupportedClaim = validateFrameworkAlignment({ framework: boldClaimFramework, headline: "This guaranteed method never fails", businessAnalysis: richBusinessAnalysis });
  assert.equal(unsupportedClaim.aligned, false);
  assert.ok(unsupportedClaim.reasons.some((r) => /absolute/i.test(r)));

  const supportedClaim = validateFrameworkAlignment({ framework: boldClaimFramework, headline: "The fastest way to get started", businessAnalysis: richBusinessAnalysis });
  assert.equal(supportedClaim.aligned, true);
});

test("validateFrameworkAlignment reports a clear failure when framework or headline is missing", () => {
  const result = validateFrameworkAlignment({ framework: null, headline: null, businessAnalysis: bareBusinessAnalysis });
  assert.equal(result.aligned, false);
  assert.ok(result.reasons.length > 0);
});
