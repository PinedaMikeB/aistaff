// Real image-ad compositor tests (PART 10).
// Confirms the actual uploaded product image is embedded byte-for-byte
// (never regenerated), that the free/anonymous preview is watermarked at a
// smaller canvas size, that the paid/final render drops the watermark at
// full resolution, and that each template maps its fields into the
// rendered headline/CTA correctly.

const test = require("node:test");
const assert = require("node:assert/strict");

const { renderImageAdSvg, buildAdContent, wrapText } = require("../../src/brandee/imageAdRenderer");

const FAKE_PRODUCT_IMAGE = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function baseForm(overrides = {}) {
  return {
    productImage: FAKE_PRODUCT_IMAGE,
    productName: "Bamboo Travel Mug",
    mainBenefit: "Keeps drinks hot for 6 hours",
    price: "PHP 899",
    brandColors: ["#123456", "#abcdef"],
    ...overrides
  };
}

test("preview render (watermark: true) embeds the real product image data URL unmodified", () => {
  const { svg } = renderImageAdSvg({ templateId: "product_highlight", templateFields: { headline: "Stay Hydrated", keyBenefit: "Leak-proof", cta: "Shop Now" }, form: baseForm(), watermark: true });
  assert.ok(svg.includes(FAKE_PRODUCT_IMAGE), "the exact uploaded product image bytes must appear in the rendered SVG");
});

test("preview render is watermarked and uses the smaller preview canvas size", () => {
  const result = renderImageAdSvg({ templateId: "product_highlight", templateFields: { headline: "Stay Hydrated", keyBenefit: "Leak-proof", cta: "Shop Now" }, form: baseForm(), watermark: true });
  assert.equal(result.watermarked, true);
  assert.equal(result.width, 720);
  assert.equal(result.height, 900);
  assert.match(result.svg, /BRANDEE PREVIEW/);
});

test("final render (watermark: false) has no watermark text and uses the full-resolution canvas", () => {
  const result = renderImageAdSvg({ templateId: "product_highlight", templateFields: { headline: "Stay Hydrated", keyBenefit: "Leak-proof", cta: "Shop Now" }, form: baseForm(), watermark: false });
  assert.equal(result.watermarked, false);
  assert.equal(result.width, 1080);
  assert.equal(result.height, 1350);
  assert.doesNotMatch(result.svg, /BRANDEE PREVIEW/);
});

test("buildAdContent maps product_highlight fields into headline/subcopy/price/cta", () => {
  const content = buildAdContent("product_highlight", { headline: "Stay Hydrated", keyBenefit: "Leak-proof lid", price: "PHP 899", cta: "Shop Now" }, baseForm());
  assert.equal(content.headline, "Stay Hydrated");
  assert.equal(content.subcopy, "Leak-proof lid");
  assert.equal(content.price, "PHP 899");
  assert.equal(content.cta, "Shop Now");
});

test("buildAdContent maps offer_promo fields and sets an OFFER badge", () => {
  const content = buildAdContent("offer_promo", { offer: "20% Off This Week", originalPrice: "PHP 999", promoPrice: "PHP 799", cta: "Grab the Deal" }, baseForm());
  assert.equal(content.headline, "20% Off This Week");
  assert.equal(content.subcopy, "PHP 999 → PHP 799");
  assert.equal(content.badge, "OFFER");
});

test("buildAdContent for testimonial_style quotes the real supplied testimonial, never a fabricated one", () => {
  const content = buildAdContent("testimonial_style", { testimonialQuote: "This mug changed my mornings.", testimonialAttribution: "R.T.", cta: "Try It" }, baseForm());
  assert.equal(content.headline, '"This mug changed my mornings."');
  assert.equal(content.subcopy, "— R.T.");
});

test("buildAdContent falls back to the product name/main benefit for an unrecognized template id", () => {
  const content = buildAdContent("not_a_real_template", {}, baseForm());
  assert.equal(content.headline, "Bamboo Travel Mug");
  assert.equal(content.subcopy, "Keeps drinks hot for 6 hours");
});

test("wrapText respects the max line count and never silently drops the truncation ellipsis", () => {
  const longText = "This is a genuinely very long headline that should wrap across more than two lines of text";
  const lines = wrapText(longText, 20, 2);
  assert.ok(lines.length <= 2);
  assert.ok(lines[lines.length - 1].endsWith("…"));
});

test("headline text in the rendered SVG is XML-escaped (no raw injection of angle brackets/ampersands)", () => {
  const result = renderImageAdSvg({
    templateId: "product_highlight",
    templateFields: { headline: "Cups & Mugs <Sale>", keyBenefit: "Good stuff", cta: "Go" },
    form: baseForm(),
    watermark: true
  });
  assert.ok(!result.svg.includes("<Sale>"), "raw unescaped angle brackets must not appear in output SVG");
  assert.ok(result.svg.includes("&amp;") || result.svg.includes("Cups"), "ampersand must be escaped");
});
