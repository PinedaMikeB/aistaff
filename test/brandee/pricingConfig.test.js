// Pricing configuration tests — final published Brandee pricing (task PART
// 2/3/4). Confirms the exact three plans/prices/allowances, the computed
// combo-savings math, the VAT/non-VAT tax breakdown math (both checked
// against the exact figures given in the spec), and that no forbidden
// wording ("static ads or videos", "unlimited", old plan names) survives.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  BRANDEE_PRODUCT_SLUG,
  BRANDEE_PRODUCT_NAME,
  TAX_MODES,
  ENTITLEMENT_UNITS,
  DEFAULT_TAX_CONFIG,
  PRICING_QUANTITIES_ARE_PLACEHOLDERS,
  PRICING_NOTE,
  PLANS,
  ANONYMOUS_LIMITS,
  getPlan,
  listPlans,
  getEntitlementsForPlan,
  computeComboSavings,
  computeTaxBreakdown
} = require("../../src/brandee/pricingConfig");

test("exactly the three required plans exist: image_starter, video_starter, brandee_combo", () => {
  const slugs = PLANS.map((p) => p.slug).sort();
  assert.deepEqual(slugs, ["brandee_combo", "image_starter", "video_starter"]);
});

test("Image Starter is ₱599/month", () => {
  assert.equal(getPlan("image_starter").monthlyPrice, 599);
});

test("Video Starter is ₱1,199/month", () => {
  assert.equal(getPlan("video_starter").monthlyPrice, 1199);
});

test("Brandee Combo is ₱2,999/month", () => {
  assert.equal(getPlan("brandee_combo").monthlyPrice, 2999);
});

test("Image Starter has 10 IMAGE_FINAL and 0 VIDEO_SECONDS entitlements", () => {
  const e = getEntitlementsForPlan("image_starter");
  assert.equal(e[ENTITLEMENT_UNITS.IMAGE_FINAL], 10);
  assert.equal(e[ENTITLEMENT_UNITS.VIDEO_SECONDS], 0);
});

test("Video Starter has 0 IMAGE_FINAL and 60 VIDEO_SECONDS entitlements", () => {
  const e = getEntitlementsForPlan("video_starter");
  assert.equal(e[ENTITLEMENT_UNITS.IMAGE_FINAL], 0);
  assert.equal(e[ENTITLEMENT_UNITS.VIDEO_SECONDS], 60);
});

test("Brandee Combo has 20 IMAGE_FINAL and 120 VIDEO_SECONDS entitlements", () => {
  const e = getEntitlementsForPlan("brandee_combo");
  assert.equal(e[ENTITLEMENT_UNITS.IMAGE_FINAL], 20);
  assert.equal(e[ENTITLEMENT_UNITS.VIDEO_SECONDS], 120);
});

test("image and video allowances are always separate fields, never a combined generic count", () => {
  for (const plan of PLANS) {
    assert.equal(typeof plan.entitlements[ENTITLEMENT_UNITS.IMAGE_FINAL], "number");
    assert.equal(typeof plan.entitlements[ENTITLEMENT_UNITS.VIDEO_SECONDS], "number");
    assert.equal(Object.keys(plan.entitlements).length, 2, "entitlements must only ever contain IMAGE_FINAL and VIDEO_SECONDS");
  }
});

test("no plan feature text uses combined 'static ads or videos' style wording, or the old 10/30/75 creatives wording", () => {
  const forbidden = ["static ads or videos", "ads or videos", "10 creatives", "30 creatives", "75 creatives"];
  for (const plan of PLANS) {
    const haystack = JSON.stringify(plan).toLowerCase();
    for (const phrase of forbidden) {
      assert.ok(!haystack.includes(phrase), `${plan.slug} still contains forbidden wording: "${phrase}"`);
    }
  }
});

test("no plan displays 'unlimited' anywhere in its copy", () => {
  for (const plan of PLANS) {
    assert.ok(!JSON.stringify(plan).toLowerCase().includes("unlimited"), `${plan.slug} must not claim unlimited`);
  }
});

test("Brandee Combo combo-savings math matches the spec exactly: ₱597 saved, ~16.6%", () => {
  const savings = computeComboSavings();
  assert.equal(savings.equivalentImageValue, 1198); // 2 x 599
  assert.equal(savings.equivalentVideoValue, 2398); // 2 x 1199
  assert.equal(savings.combinedEquivalentValue, 3596);
  assert.equal(savings.comboPrice, 2999);
  assert.equal(savings.monthlySavings, 597);
  assert.equal(savings.approxSavingsPercent, 16.6);
  assert.match(savings.note, /Save ₱597/);
});

test("computeTaxBreakdown in NON_VAT mode returns no VAT line — the total price IS the price", () => {
  for (const price of [599, 1199, 2999]) {
    const breakdown = computeTaxBreakdown(price, { taxMode: "NON_VAT" });
    assert.equal(breakdown.taxMode, "NON_VAT");
    assert.equal(breakdown.vatableSale, null);
    assert.equal(breakdown.vat, null);
    assert.equal(breakdown.total, price);
    assert.equal(breakdown.label, "Non-VAT transaction");
  }
});

test("computeTaxBreakdown in future VAT mode matches the spec's exact figures for all three plans", () => {
  const vatConfig = { taxMode: "VAT", vatRatePercent: 12 };

  const imageStarter = computeTaxBreakdown(599, vatConfig);
  assert.equal(imageStarter.vatableSale, 534.82);
  assert.equal(imageStarter.vat, 64.18);
  assert.equal(imageStarter.total, 599);

  const videoStarter = computeTaxBreakdown(1199, vatConfig);
  assert.equal(videoStarter.vatableSale, 1070.54);
  assert.equal(videoStarter.vat, 128.46);
  assert.equal(videoStarter.total, 1199);

  const combo = computeTaxBreakdown(2999, vatConfig);
  assert.equal(combo.vatableSale, 2677.68);
  assert.equal(combo.vat, 321.32);
  assert.equal(combo.total, 2999);
});

test("VAT mode never changes the published total — vatableSale + vat always reconstructs the original total", () => {
  for (const price of [599, 1199, 2999]) {
    const breakdown = computeTaxBreakdown(price, { taxMode: "VAT", vatRatePercent: 12 });
    assert.equal(Math.round((breakdown.vatableSale + breakdown.vat) * 100) / 100, price);
  }
});

test("DEFAULT_TAX_CONFIG is NON_VAT — VAT mode is not currently active", () => {
  assert.equal(DEFAULT_TAX_CONFIG.taxMode, "NON_VAT");
  assert.ok(TAX_MODES.includes("NON_VAT"));
  assert.ok(TAX_MODES.includes("VAT"));
});

test("PRICING_NOTE matches the required non-VAT disclosure wording", () => {
  assert.match(PRICING_NOTE, /non-VAT registered/i);
  assert.match(PRICING_NOTE, /total monthly subscription price/i);
});

test("these are final published prices, not placeholders", () => {
  assert.equal(PRICING_QUANTITIES_ARE_PLACEHOLDERS, false);
});

test("Brandee Combo is marked featured/Best Value; the two Starter plans are not", () => {
  assert.equal(getPlan("brandee_combo").featured, true);
  assert.equal(getPlan("brandee_combo").badge, "Best Value");
  assert.ok(!getPlan("image_starter").featured);
  assert.ok(!getPlan("video_starter").featured);
});

test("getPlan returns null for an unknown slug, and the correct plan for a known one", () => {
  assert.equal(getPlan("does-not-exist"), null);
  assert.equal(getPlan("image_starter").name, "Image Starter");
});

test("listPlans returns all configured plans sorted by sortOrder", () => {
  const listed = listPlans();
  assert.equal(listed.length, PLANS.length);
  for (let i = 1; i < listed.length; i++) assert.ok(listed[i].sortOrder >= listed[i - 1].sortOrder);
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

test("every plan declares a CTA matching the spec's suggested wording", () => {
  assert.equal(getPlan("image_starter").cta, "Start with Image Ads");
  assert.equal(getPlan("video_starter").cta, "Start with Video Ads");
  assert.equal(getPlan("brandee_combo").cta, "Get Image + Video");
});
