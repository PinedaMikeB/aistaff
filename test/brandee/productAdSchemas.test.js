// Shared product-ad form schema tests (PART 7 / PART 23 "Shared Product Form").
// Confirms required fields are enforced, optional fields stay optional
// (nothing pre-registration-blocking is silently required), and the
// desired-action enum matches the four actions specified in PART 7.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  DESIRED_ACTIONS,
  SharedProductFormSchema,
  ImageAdRequestSchema,
  VideoAdRequestSchema,
  ProductUrlExtractRequestSchema,
  hasRealTestimonial
} = require("../../src/brandee/productAdSchemas");

// A tiny 1x1 PNG data URL, just enough to satisfy the wrapper-shape regex.
const TINY_PNG = "data:image/png;base64," + Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]).toString("base64").padEnd(40, "A");

function baseForm(overrides = {}) {
  return {
    productImage: TINY_PNG,
    productName: "Bamboo Travel Mug",
    productDescription: "A leak-proof travel mug made from sustainable bamboo fiber.",
    mainFeatures: "Leak-proof lid, keeps drinks hot for 6 hours, dishwasher safe.",
    targetCustomer: "Busy commuters who care about sustainability.",
    desiredAction: "buy_now",
    ...overrides
  };
}

test("DESIRED_ACTIONS matches the four actions specified in PART 7", () => {
  assert.deepEqual(DESIRED_ACTIONS, ["buy_now", "send_message", "visit_product_page", "learn_more"]);
});

test("SharedProductFormSchema accepts a minimal valid submission with only the required fields", () => {
  const result = SharedProductFormSchema.safeParse(baseForm());
  assert.equal(result.success, true);
});

test("SharedProductFormSchema rejects a submission missing the product image", () => {
  const form = baseForm();
  delete form.productImage;
  const result = SharedProductFormSchema.safeParse(form);
  assert.equal(result.success, false);
});

test("SharedProductFormSchema rejects a submission missing the product name", () => {
  const form = baseForm();
  delete form.productName;
  assert.equal(SharedProductFormSchema.safeParse(form).success, false);
});

test("SharedProductFormSchema rejects a submission missing the desired customer action", () => {
  const form = baseForm();
  delete form.desiredAction;
  assert.equal(SharedProductFormSchema.safeParse(form).success, false);
});

test("SharedProductFormSchema rejects an unrecognized desired action", () => {
  const form = baseForm({ desiredAction: "call_now" });
  assert.equal(SharedProductFormSchema.safeParse(form).success, false);
});

test("SharedProductFormSchema does NOT require a product listing URL, price, offer, logo, or additional notes", () => {
  // These are all PART 7 "optional" fields and must never be required before
  // the free preview.
  const result = SharedProductFormSchema.safeParse(baseForm());
  assert.equal(result.success, true);
  assert.equal(result.data.productListingUrl, undefined);
  assert.equal(result.data.price, undefined);
});

test("SharedProductFormSchema has no field for business website, business history, or phone number", () => {
  const shape = SharedProductFormSchema.shape;
  assert.equal(shape.businessWebsite, undefined);
  assert.equal(shape.businessHistory, undefined);
  assert.equal(shape.phoneNumber, undefined);
  assert.equal(shape.companyWebsite, undefined);
});

test("SharedProductFormSchema defaults preferredLanguage to english when omitted", () => {
  const result = SharedProductFormSchema.parse(baseForm());
  assert.equal(result.preferredLanguage, "english");
});

test("SharedProductFormSchema rejects a productListingUrl that isn't a well-formed URL", () => {
  const form = baseForm({ productListingUrl: "not a url" });
  assert.equal(SharedProductFormSchema.safeParse(form).success, false);
});

test("SharedProductFormSchema accepts a valid productListingUrl", () => {
  const form = baseForm({ productListingUrl: "https://shop.example/products/bamboo-mug" });
  assert.equal(SharedProductFormSchema.safeParse(form).success, true);
});

test("ImageAdRequestSchema requires a templateId on top of the shared shape", () => {
  const withTemplate = { ...baseForm(), templateId: "product_highlight", templateFields: {} };
  assert.equal(ImageAdRequestSchema.safeParse(withTemplate).success, true);
  const withoutTemplate = baseForm();
  assert.equal(ImageAdRequestSchema.safeParse(withoutTemplate).success, false);
});

test("VideoAdRequestSchema requires a styleId and constrains preferredFinalLength to a sane range", () => {
  const valid = { ...baseForm(), styleId: "ugc_recommendation", preferredFinalLength: 30 };
  assert.equal(VideoAdRequestSchema.safeParse(valid).success, true);

  const tooLong = { ...baseForm(), styleId: "ugc_recommendation", preferredFinalLength: 999 };
  assert.equal(VideoAdRequestSchema.safeParse(tooLong).success, false);

  const missingStyle = baseForm();
  assert.equal(VideoAdRequestSchema.safeParse(missingStyle).success, false);
});

test("ProductUrlExtractRequestSchema only accepts a single well-formed URL (no batch/array input)", () => {
  assert.equal(ProductUrlExtractRequestSchema.safeParse({ url: "https://shop.example/p/123" }).success, true);
  assert.equal(ProductUrlExtractRequestSchema.safeParse({ url: "not-a-url" }).success, false);
  assert.equal(ProductUrlExtractRequestSchema.safeParse({ urls: ["https://a.example", "https://b.example"] }).success, false);
});

test("hasRealTestimonial is false when quote/attribution are absent, true only when both are real text", () => {
  assert.equal(hasRealTestimonial({}), false);
  assert.equal(hasRealTestimonial({ testimonialQuote: "Great product!" }), false);
  assert.equal(hasRealTestimonial({ testimonialQuote: "  ", testimonialAttribution: "  " }), false);
  assert.equal(hasRealTestimonial({ testimonialQuote: "Great product!", testimonialAttribution: "J.D." }), true);
});
