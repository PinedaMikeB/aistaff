// Template validation schema tests (PART 9/15/18/19).
// Confirms overlay bounding boxes are validated as normalized (0-1)
// coordinates, that UGC scene/provider-configuration payloads reject
// secret-like content (PART 19: "Do not allow secrets or raw API keys
// inside scene prompts"), and that both static and UGC template inputs
// apply sane defaults.

const test = require("node:test");
const assert = require("node:assert/strict");

const { StaticTemplateInput, UgcTemplateInput, OverlaySchema, ASPECT_RATIOS } = require("../../src/brandee/templateSchemas");

function baseStaticInput(overrides = {}) {
  return {
    slug: "sample_template",
    name: "Sample Template",
    description: "A sample template for testing.",
    category: "Sample",
    ...overrides
  };
}

test("StaticTemplateInput accepts a minimal valid template and applies defaults", () => {
  const result = StaticTemplateInput.parse(baseStaticInput());
  assert.equal(result.status, undefined); // status is applied by the service layer, not this schema
  assert.equal(result.renderMode, "COMPOSITE_TEMPLATE");
  assert.deepEqual(result.supportedAspectRatios, ["4:5"]);
  assert.equal(result.defaultAspectRatio, "4:5");
});

test("StaticTemplateInput rejects a slug with uppercase letters or spaces", () => {
  assert.throws(() => StaticTemplateInput.parse(baseStaticInput({ slug: "Sample Template" })));
});

test("StaticTemplateInput accepts a slug with only lowercase letters, numbers, and underscores", () => {
  const result = StaticTemplateInput.parse(baseStaticInput({ slug: "sample_template_2" }));
  assert.equal(result.slug, "sample_template_2");
});

test("OverlaySchema accepts a well-formed normalized bounding box", () => {
  const result = OverlaySchema.parse({ headline: { x: 0.1, y: 0.6, width: 0.8, height: 0.1, alignment: "left", layerOrder: 2 } });
  assert.equal(result.headline.x, 0.1);
});

test("OverlaySchema rejects a bounding box coordinate outside the 0-1 normalized range", () => {
  assert.throws(() => OverlaySchema.parse({ headline: { x: 1.5, y: 0.6, width: 0.8, height: 0.1 } }));
});

test("StaticTemplateInput rejects an unsupported aspect ratio", () => {
  assert.throws(() => StaticTemplateInput.parse(baseStaticInput({ supportedAspectRatios: ["21:9"] })));
});

test("ASPECT_RATIOS covers the four ratios mentioned across the spec (1:1, 4:5, 9:16, 16:9)", () => {
  assert.deepEqual(ASPECT_RATIOS, ["1:1", "4:5", "9:16", "16:9"]);
});

function baseUgcInput(overrides = {}) {
  return {
    slug: "sample_style",
    name: "Sample Style",
    description: "A sample UGC style for testing.",
    category: "Sample",
    ...overrides
  };
}

test("UgcTemplateInput accepts a minimal valid template and applies defaults", () => {
  const result = UgcTemplateInput.parse(baseUgcInput());
  assert.deepEqual(result.supportedDurations, [15, 30]);
  assert.deepEqual(result.supportedAspectRatios, ["9:16"]);
});

test("UgcTemplateInput rejects providerConfiguration containing an API key", () => {
  assert.throws(() => UgcTemplateInput.parse(baseUgcInput({ providerConfiguration: { apiKey: "sk-thisisnotreal12345" } })));
});

test("UgcTemplateInput rejects providerConfiguration containing a bearer token", () => {
  assert.throws(() => UgcTemplateInput.parse(baseUgcInput({ providerConfiguration: { header: "Authorization: Bearer abc123" } })));
});

test("UgcTemplateInput accepts safe, non-secret providerConfiguration", () => {
  const result = UgcTemplateInput.parse(baseUgcInput({ modelProvider: "remotion", providerConfiguration: { compositionId: "ProductTeaser" } }));
  assert.equal(result.modelProvider, "remotion");
});

test("UgcTemplateInput rejects a scene containing secret-like content", () => {
  assert.throws(() => UgcTemplateInput.parse(baseUgcInput({
    sceneSchema: [{ sceneNumber: 1, durationSeconds: 5, providerPrompt: "use api_key=sk-abcdef1234567890 to render" }]
  })));
});

test("UgcTemplateInput accepts a normal, secret-free scene", () => {
  const result = UgcTemplateInput.parse(baseUgcInput({
    sceneSchema: [{ sceneNumber: 1, durationSeconds: 5, spokenDialogue: "Have you tried this?", visualAction: "Creator holds product up to camera." }]
  }));
  assert.equal(result.sceneSchema.length, 1);
});
