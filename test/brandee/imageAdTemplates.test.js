// Image-ad template library tests (PART 9).
// Confirms all 8 specified templates exist with the required shape, and
// that Testimonial Style stays gated behind a real testimonial.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  IMAGE_AD_TEMPLATES,
  getImageAdTemplate,
  isTemplateAvailable,
  listAvailableTemplates
} = require("../../src/brandee/imageAdTemplates");

const EXPECTED_IDS = [
  "product_highlight",
  "feature_benefit",
  "offer_promo",
  "problem_solution",
  "question_ad",
  "comparison",
  "minimal_ecommerce",
  "testimonial_style"
];

test("exactly the 8 templates specified in PART 9 exist, in the given order", () => {
  assert.deepEqual(IMAGE_AD_TEMPLATES.map((t) => t.id), EXPECTED_IDS);
});

test("every template has a thumbnail, name, description, bestUse, and non-empty fields array", () => {
  for (const template of IMAGE_AD_TEMPLATES) {
    assert.ok(template.thumbnail, `${template.id} missing thumbnail`);
    assert.ok(template.name, `${template.id} missing name`);
    assert.ok(template.description, `${template.id} missing description`);
    assert.ok(template.bestUse, `${template.id} missing bestUse`);
    assert.ok(Array.isArray(template.fields) && template.fields.length > 0, `${template.id} missing fields`);
  }
});

test("every template field declares a key, label, type, and required flag", () => {
  for (const template of IMAGE_AD_TEMPLATES) {
    for (const field of template.fields) {
      assert.equal(typeof field.key, "string");
      assert.equal(typeof field.label, "string");
      assert.equal(typeof field.type, "string");
      assert.equal(typeof field.required, "boolean");
    }
  }
});

test("getImageAdTemplate returns null for an unknown id", () => {
  assert.equal(getImageAdTemplate("does_not_exist"), null);
});

test("getImageAdTemplate returns the matching template for a known id", () => {
  const template = getImageAdTemplate("offer_promo");
  assert.equal(template.name, "Offer or Promo");
});

test("comparison template requires defensible comparison points (no unsupported claims field)", () => {
  const template = getImageAdTemplate("comparison");
  const points = template.fields.find((f) => f.key === "comparisonPoints");
  assert.ok(points.required, "comparisonPoints must be required so no comparison ad ships without stated points");
});

test("isTemplateAvailable: every non-testimonial template is always available", () => {
  for (const id of EXPECTED_IDS) {
    if (id === "testimonial_style") continue;
    assert.equal(isTemplateAvailable(id), true, `${id} should always be available`);
  }
});

test("isTemplateAvailable: testimonial_style is unavailable without a real testimonial", () => {
  assert.equal(isTemplateAvailable("testimonial_style"), false);
  assert.equal(isTemplateAvailable("testimonial_style", { hasTestimonial: false }), false);
});

test("isTemplateAvailable: testimonial_style becomes available once a real testimonial is supplied", () => {
  assert.equal(isTemplateAvailable("testimonial_style", { hasTestimonial: true }), true);
});

test("isTemplateAvailable returns false for an unknown template id", () => {
  assert.equal(isTemplateAvailable("not_a_real_template"), false);
});

test("listAvailableTemplates annotates every template with an `available` flag reflecting testimonial gating", () => {
  const withoutTestimonial = listAvailableTemplates({ hasTestimonial: false });
  const testimonialEntry = withoutTestimonial.find((t) => t.id === "testimonial_style");
  assert.equal(testimonialEntry.available, false);
  const otherEntry = withoutTestimonial.find((t) => t.id === "product_highlight");
  assert.equal(otherEntry.available, true);

  const withTestimonial = listAvailableTemplates({ hasTestimonial: true });
  assert.equal(withTestimonial.find((t) => t.id === "testimonial_style").available, true);
});
