// GPT-5.6 Sol creative planner tests (PART 12/13/17).
//
// No AI provider is configured in this environment (no OPENAI_API_KEY/
// GEMINI_API_KEY — see modelConfig.js), so buildCreativePlan()/
// interpretRevision() always exercise their deterministic fallback path
// here. That path must, on its own, produce a correct and safe result —
// this is the actual behavior exercised by the live app today.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  CreativeDirectionSchema,
  RevisionInstructionSchema,
  buildCreativePlan,
  interpretRevision,
  deterministicCreativeDirection
} = require("../../src/brandee/creativePlanner");

function form(overrides = {}) {
  return {
    productName: "Aloe Face Cream",
    productDescription: "A soothing daily moisturizer.",
    mainFeatures: "Lightweight\nFragrance-free\nFast absorbing",
    targetCustomer: "Women 25-40 with sensitive skin",
    desiredAction: "shop_now",
    preferredLanguage: "english",
    ...overrides
  };
}

test("buildCreativePlan falls back to a valid deterministic plan when no AI provider is configured", async () => {
  const { plan, aiUsed, model } = await buildCreativePlan({ form: form(), template: { id: "product_highlight", name: "Product Highlight", frameworkKey: "product_highlight", description: "Clean product shot layout." } });
  assert.equal(aiUsed, false);
  assert.equal(model, null);
  assert.doesNotThrow(() => CreativeDirectionSchema.parse(plan));
  assert.ok(plan.headline.length > 0);
  assert.ok(plan.cta.length > 0);
});

test("deterministicCreativeDirection never invents proof claims (proofNotices always empty without real evidence)", () => {
  const plan = deterministicCreativeDirection({ form: form(), template: { id: "product_highlight" } });
  assert.deepEqual(plan.proofNotices, []);
});

test("deterministicCreativeDirection maps desiredAction to a matching, non-invented CTA", () => {
  assert.equal(deterministicCreativeDirection({ form: form({ desiredAction: "send_message" }), template: { id: "product_highlight" } }).cta, "Send a message");
  assert.equal(deterministicCreativeDirection({ form: form({ desiredAction: "visit_product_page" }), template: { id: "product_highlight" } }).cta, "Visit product page");
  assert.equal(deterministicCreativeDirection({ form: form({ desiredAction: "shop_now" }), template: { id: "product_highlight" } }).cta, "Shop now");
});

test("deterministicCreativeDirection for offer_promo uses the customer's real offer details, not an invented discount", () => {
  const plan = deterministicCreativeDirection({ form: form({ offerDetails: "20% off this week only" }), template: { id: "offer_promo" } });
  assert.equal(plan.headline, "20% off this week only");
});

test("deterministicCreativeDirection for testimonial_style uses the real supplied quote", () => {
  const plan = deterministicCreativeDirection({ form: form({ testimonialQuote: "This changed my skin!" }), template: { id: "testimonial_style" } });
  assert.ok(plan.headline.includes("This changed my skin!"));
});

test("interpretRevision falls back to a deterministic rule for a recognized instruction (remove the price)", async () => {
  const { revision, aiUsed } = await interpretRevision({
    form: form(),
    template: { id: "offer_promo", name: "Offer", frameworkKey: "offer" },
    currentContent: { headline: "20% off", subcopy: "Limited time", cta: "Shop now" },
    instruction: "remove the price please"
  });
  assert.equal(aiUsed, false);
  assert.equal(revision.understood, true);
  assert.doesNotThrow(() => RevisionInstructionSchema.parse(revision));
});

test("interpretRevision marks an unrecognized instruction as understood:false rather than silently doing nothing", async () => {
  const { revision } = await interpretRevision({
    form: form(),
    template: { id: "offer_promo", name: "Offer" },
    currentContent: { headline: "Headline", subcopy: "Body", cta: "Shop now" },
    instruction: "make it look like it won an award"
  });
  assert.equal(revision.understood, false, "an instruction the deterministic fallback cannot safely interpret must be flagged, not guessed at");
});

test("interpretRevision always preserves everything not mentioned in the deterministic fallback", async () => {
  const { revision } = await interpretRevision({
    form: form(),
    template: { id: "offer_promo", name: "Offer" },
    currentContent: { headline: "Headline", subcopy: "Body", cta: "Shop now" },
    instruction: "less text please"
  });
  assert.ok(revision.preserve.includes("everything not mentioned"));
});

test("CreativeDirectionSchema rejects a headline over 100 characters (keeps ad copy readable)", () => {
  const tooLong = "x".repeat(101);
  assert.throws(() => CreativeDirectionSchema.parse({ headline: tooLong, cta: "Shop now" }));
});
