// Video-ad style library tests (PART 11).
// Confirms all 6 specified styles exist with the required shape and a
// sane suggested length, and that the shared preference vocab lists exist.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  VIDEO_AD_STYLES,
  HOOK_PREFERENCES,
  TONES,
  CREATOR_TYPES,
  SETTINGS,
  getVideoAdStyle,
  listVideoAdStyles
} = require("../../src/brandee/videoAdStyles");

const EXPECTED_IDS = [
  "ugc_recommendation",
  "product_demo",
  "problem_solution",
  "offer_promo",
  "unboxing",
  "product_showcase"
];

test("exactly the 6 video styles specified in PART 11 exist", () => {
  assert.deepEqual(VIDEO_AD_STYLES.map((s) => s.id), EXPECTED_IDS);
});

test("every style has a poster, description, bestUse, and a positive suggestedLengthSeconds", () => {
  for (const style of VIDEO_AD_STYLES) {
    assert.ok(style.poster, `${style.id} missing poster`);
    assert.ok(style.description, `${style.id} missing description`);
    assert.ok(style.bestUse, `${style.id} missing bestUse`);
    assert.equal(typeof style.suggestedLengthSeconds, "number");
    assert.ok(style.suggestedLengthSeconds > 0 && style.suggestedLengthSeconds <= 60, `${style.id} suggestedLengthSeconds out of a sane range`);
  }
});

test("every style declares its required inputs as a non-empty array", () => {
  for (const style of VIDEO_AD_STYLES) {
    assert.ok(Array.isArray(style.requiredInputs) && style.requiredInputs.length > 0, `${style.id} missing requiredInputs`);
  }
});

test("getVideoAdStyle returns the matching style or null", () => {
  assert.equal(getVideoAdStyle("unboxing").name, "Unboxing");
  assert.equal(getVideoAdStyle("not_real"), null);
});

test("listVideoAdStyles returns all 6 styles", () => {
  assert.equal(listVideoAdStyles().length, 6);
});

test("shared preference vocabularies (hooks/tones/creator types/settings) are non-empty", () => {
  assert.ok(HOOK_PREFERENCES.length >= 4);
  assert.ok(TONES.length >= 3);
  assert.ok(CREATOR_TYPES.length >= 3);
  assert.ok(SETTINGS.length >= 3);
});
