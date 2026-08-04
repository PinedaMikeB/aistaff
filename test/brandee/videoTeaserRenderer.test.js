// Video teaser rendering tests (PART 11/12).
// The actual Remotion render path needs a platform-matched native
// compositor binary and is NOT exercised end-to-end here (this sandbox's
// Linux binaries don't match a macOS deployment, and vice versa — see the
// module's own capability probe). What IS fully testable here, and matters
// most for PART 12's explicit requirement, is that an unavailable/failed
// video provider fails HONESTLY: no fabricated teaser is ever returned, a
// clear reason/message comes back, and the project is preserved (never
// throws).

const test = require("node:test");
const assert = require("node:assert/strict");

const { probeVideoProviderAvailability, generateVideoTeaser, generateFinalVideo, PREVIEW_DURATION_SECONDS } = require("../../src/brandee/videoTeaserRenderer");

test("probeVideoProviderAvailability returns a well-formed { available, reason } shape and never throws", () => {
  const result = probeVideoProviderAvailability();
  assert.equal(typeof result.available, "boolean");
  if (!result.available) {
    assert.equal(typeof result.reason, "string");
    assert.ok(result.reason.length > 0);
  }
});

test("PREVIEW_DURATION_SECONDS is fixed at 3 seconds (PART 12: an actual 3-second teaser)", () => {
  assert.equal(PREVIEW_DURATION_SECONDS, 3);
});

test("generateVideoTeaser never throws and never fabricates a result when the provider is unavailable", async () => {
  const capability = probeVideoProviderAvailability();

  const result = await generateVideoTeaser({
    projectId: "test-project-1",
    styleId: "ugc_recommendation",
    hookText: "Ever wonder why your coffee goes cold by 10am?",
    headline: "Bamboo Travel Mug",
    ctaText: "Shop Now",
    productImageDataUrl: null,
    brandColor: "#123456"
  });

  if (!capability.available) {
    // Honest failure path — PART 12: "do not fabricate a generated teaser."
    assert.equal(result.ok, false);
    assert.equal(typeof result.reason, "string");
    assert.equal(typeof result.message, "string");
    assert.ok(!("relativeUrl" in result), "a failed render must never include a fabricated video URL");
  } else {
    // If a real compositor genuinely is available in this environment,
    // only assert the success shape is well-formed — do not assume a real
    // render will succeed within a test timeout.
    assert.equal(typeof result.ok, "boolean");
  }
});

test("generateFinalVideo also fails honestly (no watermark-free fabricated video) when the provider is unavailable", async () => {
  const capability = probeVideoProviderAvailability();
  if (capability.available) return; // nothing to assert about the failure path here

  const result = await generateFinalVideo({
    projectId: "test-project-2",
    styleId: "product_demo",
    headline: "Bamboo Travel Mug",
    ctaText: "Shop Now",
    productImageDataUrl: null,
    brandColor: "#123456",
    durationSeconds: 20
  });

  assert.equal(result.ok, false);
  assert.equal(typeof result.reason, "string");
  assert.ok(!("relativeUrl" in result));
});
