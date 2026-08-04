// End-to-end generic-fixture planner flow test, run against a saved fixture
// rather than a live fetch — see test/fixtures/generic-business.html (a
// fictional "BrightDesk Solutions" business). AI_PROVIDER is forced to
// "mock" so this test exercises the deterministic engine, which is always
// available regardless of AI provider configuration.

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

process.env.AI_PROVIDER = "mock";

const { extractStructuredContent, buildHeuristicAnalysis } = require("../../src/brandee/websiteAnalyzer");
const { generateCreativePlan } = require("../../src/brandee/planner");
const { BrandeeCreativePlanSchema } = require("../../src/brandee/schemas");

function loadGenericAnalysis() {
  const html = fs.readFileSync(path.join(__dirname, "..", "fixtures", "generic-business.html"), "utf8");
  const structured = extractStructuredContent(html);
  return buildHeuristicAnalysis({ sourceUrl: "https://sample-co.example/", structured });
}

const genericForm = {
  selectedGoal: "purchase",
  url: "https://sample-co.example/",
  whatYouSell: "Office equipment rental for businesses",
  idealCustomer: "Office administrators and business owners",
  platform: "facebook",
  language: "taglish",
  offer: null,
  differentiator: "Free maintenance included",
  additionalInfo: null
};

test("Generic flow: deterministic plan is schema-valid with AI unavailable", async () => {
  const businessAnalysis = loadGenericAnalysis();
  const { plan, aiUsed } = await generateCreativePlan({ businessAnalysis, form: genericForm });
  assert.equal(aiUsed, false);
  const check = BrandeeCreativePlanSchema.safeParse(plan);
  assert.equal(check.success, true, check.success ? "" : JSON.stringify(check.error.format()));
});

test("Generic flow: goal correction recommends 'messages' over 'purchase'", async () => {
  const businessAnalysis = loadGenericAnalysis();
  const { plan } = await generateCreativePlan({ businessAnalysis, form: genericForm });
  assert.equal(plan.selectedGoal, "purchase");
  assert.equal(plan.recommendedGoal, "messages");
  assert.equal(plan.goalChanged, true);
});

test("Generic flow: static-ad framework comes from the approved list", async () => {
  const businessAnalysis = loadGenericAnalysis();
  const { plan } = await generateCreativePlan({ businessAnalysis, form: genericForm });
  const { getFrameworkById } = require("../../src/brandee/frameworks");
  assert.ok(getFrameworkById(plan.strategy.staticAdFramework.id), "framework id must be one of the approved 10");
});

test("Generic flow: hook category comes from the approved 8 categories and only approved hooks are shown", async () => {
  const businessAnalysis = loadGenericAnalysis();
  const { plan } = await generateCreativePlan({ businessAnalysis, form: genericForm });
  assert.ok(["curiosity", "story", "authority", "direct", "problem", "social_proof", "question", "urgency"].includes(plan.strategy.hookCategory));
  for (const hs of plan.hookScores) assert.notEqual(hs.status, "rejected");
  // Rejected hooks are retained separately for admin diagnostics, never
  // mixed into the customer-facing hookScores list (PART 19/27).
  for (const hs of plan.rejectedHookScores) assert.equal(hs.status, "rejected");
});

test("Generic flow: produces three materially different marketing angles (not paraphrases)", async () => {
  const businessAnalysis = loadGenericAnalysis();
  const { plan } = await generateCreativePlan({ businessAnalysis, form: genericForm });
  assert.equal(plan.angles.length, 3);
  const categories = new Set(plan.angles.map((a) => a.category));
  assert.ok(categories.size >= 2, "expected angles to draw from more than one hook category");
  const hooks = new Set(plan.angles.map((a) => a.hook));
  assert.equal(hooks.size, plan.angles.length, "angle hooks must be distinct, not paraphrases of each other");
  for (const angle of plan.angles) {
    assert.ok(angle.customerProblem && angle.customerProblem.length > 0, "each angle must state a customer problem");
    assert.ok(angle.desiredOutcome && angle.desiredOutcome.length > 0, "each angle must state a desired outcome");
  }
});

test("Generic flow: no unsupported proof claims (no testimonials/reviews/ratings/urgency invented)", async () => {
  const businessAnalysis = loadGenericAnalysis(); // fixture has no testimonials, no ratings, no real deadline
  const { plan } = await generateCreativePlan({ businessAnalysis, form: genericForm });
  assert.equal(plan.proof.available.some((e) => e.claim.startsWith("Testimonial:")), false);
  const claimsText = JSON.stringify(plan).toLowerCase();
  assert.equal(/\b\d(\.\d)?\s*-star rating mentioned\b/.test(claimsText), false);
});

test("Generic flow: draft script has scenes and a hook-based opening line, no placeholder text leaked", async () => {
  const businessAnalysis = loadGenericAnalysis();
  const { plan } = await generateCreativePlan({ businessAnalysis, form: genericForm });
  assert.ok(plan.script.scenes.length >= 4);
  assert.equal(plan.script.scenes[0].dialogue, plan.strategy.primaryHook);
  const { hasPlaceholderLeak } = require("../../src/brandee/copyQuality");
  for (const scene of plan.script.scenes) {
    assert.equal(hasPlaceholderLeak(scene.dialogue), false, `scene ${scene.sceneNumber} dialogue must not contain authoring instructions`);
    assert.equal(hasPlaceholderLeak(scene.caption), false, `scene ${scene.sceneNumber} caption must not contain authoring instructions`);
  }
});

test("Generic flow: raw comma-separated audience input is normalized before reaching final copy", async () => {
  const businessAnalysis = loadGenericAnalysis();
  const rawAudienceForm = { ...genericForm, idealCustomer: "business owner, companies" };
  const { plan } = await generateCreativePlan({ businessAnalysis, form: rawAudienceForm });
  assert.equal(plan.businessSummary.targetAudience.includes("owner,"), false, "raw comma fragment must be normalized, not passed through verbatim");
});

test("Manual fallback: an unreachable-website analysis object still produces a valid, usable plan", async () => {
  const manualOnlyAnalysis = {
    sourceUrl: "https://sample-co.example/",
    businessName: null,
    businessType: "unknown",
    industry: null,
    summary: "Brandee could not read this website automatically. This plan is based on what you entered manually.",
    productsOrServices: [],
    targetAudienceSignals: [],
    primaryProblemsSolved: [],
    primaryBenefits: [],
    differentiators: [],
    offers: [],
    callsToAction: [],
    contactMethods: [],
    locations: [],
    proof: { testimonials: [], reviewCount: null, rating: null, customerCount: null, yearsInBusiness: null, awards: [], certifications: [], guarantees: [] },
    brandTone: [],
    claimsFound: [],
    missingInformation: ["Everything — Brandee could not read the website automatically"],
    confidence: 0.15,
    fetchStatus: "unreachable"
  };
  const { plan } = await generateCreativePlan({ businessAnalysis: manualOnlyAnalysis, form: genericForm });
  const check = BrandeeCreativePlanSchema.safeParse(plan);
  assert.equal(check.success, true, check.success ? "" : JSON.stringify(check.error.format()));
  assert.ok(plan.warnings.some((w) => w.includes("could not fully read this website")));
});
