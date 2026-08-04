// Static template importer tests (PART 3/4).
//
// scripts/brandee-import-static-templates.js requires `../src/db`, which
// instantiates a live PrismaClient — this sandbox cannot load that (Prisma
// engine binary platform mismatch; see accountRegistration.test.js's header
// for the full explanation). This test stubs `require.cache` for `src/db.js`
// with an in-memory fake `prisma` BEFORE requiring the importer, exactly
// like the other Brandee tests that touch a `../db`-requiring module — so
// the importer's real, exported pure helper functions (sniffImageType,
// slugify, classify, toDominantHex) are exercised for real, without ever
// hitting a real database or running the CLI's main() (guarded by the
// `require.main === module` check added specifically so this file is
// test-safe to require).

const test = require("node:test");
const assert = require("node:assert/strict");

const dbPath = require.resolve("../../src/db");
require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: { staticAdTemplate: { findFirst: async () => null } } } };

const {
  sniffImageType,
  slugify,
  classify,
  toDominantHex,
  CLASSIFICATION,
  FRAMEWORK_TO_TEMPLATE_ID,
  FRAMEWORK_LABELS
} = require("../../scripts/brandee-import-static-templates");

const { IMAGE_AD_TEMPLATES } = require("../../src/brandee/imageAdTemplates");

// A minimal valid 1x1 PNG (red pixel) for exercising real sharp decoding.
const ONE_PX_PNG_BASE64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

test("requiring the importer module does not execute main() or touch a real database (require.main guard works)", () => {
  // If this file loaded and ran main() on require, it would have already
  // thrown (no --source arg) or hung on a real prisma call — reaching this
  // assertion at all proves the guard worked.
  assert.ok(true);
});

test("sniffImageType detects PNG by magic bytes, not by file extension", () => {
  const buffer = Buffer.from(ONE_PX_PNG_BASE64, "base64");
  assert.equal(sniffImageType(buffer), "png");
});

test("sniffImageType detects JPEG by magic bytes", () => {
  const jpegHeader = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]);
  assert.equal(sniffImageType(jpegHeader), "jpeg");
});

test("sniffImageType detects WebP by RIFF/WEBP header", () => {
  const webpHeader = Buffer.concat([Buffer.from("RIFF", "ascii"), Buffer.from([0, 0, 0, 0]), Buffer.from("WEBP", "ascii")]);
  assert.equal(sniffImageType(webpHeader), "webp");
});

test("sniffImageType returns null for a file that is not a recognizable image (rejects a renamed .txt)", () => {
  const textBuffer = Buffer.from("this is not an image, just text pretending to be one", "utf8");
  assert.equal(sniffImageType(textBuffer), null);
});

test("slugify produces a lowercase, underscore-separated, bounded-length slug", () => {
  assert.equal(slugify("Bold Claim Template 2.png".replace(/\.[^.]+$/, "")), "bold_claim_template_2");
  assert.equal(slugify("  Weird---Spacing!! "), "weird_spacing");
  assert.ok(slugify("x".repeat(200)).length <= 60);
});

test("classify returns a high-confidence exact match for every filename in the hand-verified CLASSIFICATION table", () => {
  for (const filename of Object.keys(CLASSIFICATION)) {
    const result = classify(filename);
    assert.equal(result.confidence, "high", `${filename} should be a high-confidence exact match`);
    assert.ok(result.frameworkKey, `${filename} must have a frameworkKey`);
    assert.ok(["PRODUCT", "SERVICE", "UNIVERSAL"].includes(result.audienceType));
  }
});

test("classify falls back to a low-confidence guess (never throws) for a filename it was never taught about", () => {
  const result = classify("some-brand-new-file-nobody-has-seen.png");
  assert.equal(result.confidence, "low");
  assert.equal(result.audienceType, "UNIVERSAL");
});

test("classify's low-confidence fallback can still guess a framework from filename keywords", () => {
  const result = classify("random offer banner draft.png");
  assert.equal(result.frameworkKey, "offer");
  assert.equal(result.confidence, "low");
});

test("every frameworkKey used in CLASSIFICATION has a corresponding entry in FRAMEWORK_TO_TEMPLATE_ID and FRAMEWORK_LABELS", () => {
  const usedFrameworks = new Set(Object.values(CLASSIFICATION).map((c) => c.frameworkKey));
  for (const framework of usedFrameworks) {
    assert.ok(FRAMEWORK_TO_TEMPLATE_ID[framework], `missing FRAMEWORK_TO_TEMPLATE_ID entry for ${framework}`);
    assert.ok(FRAMEWORK_LABELS[framework], `missing FRAMEWORK_LABELS entry for ${framework}`);
  }
});

test("every FRAMEWORK_TO_TEMPLATE_ID value points at a real, existing code-level template (no dangling reference)", () => {
  const templateIds = new Set(IMAGE_AD_TEMPLATES.map((t) => t.id));
  for (const [framework, templateId] of Object.entries(FRAMEWORK_TO_TEMPLATE_ID)) {
    assert.ok(templateIds.has(templateId), `FRAMEWORK_TO_TEMPLATE_ID.${framework} -> "${templateId}" does not exist in imageAdTemplates.js`);
  }
});

test("toDominantHex returns a well-formed 6-digit hex color for a real decodable image", async () => {
  const buffer = Buffer.from(ONE_PX_PNG_BASE64, "base64");
  const hex = await toDominantHex(buffer);
  assert.match(hex, /^#[0-9a-f]{6}$/i);
});

test("toDominantHex returns null (never throws) for a buffer sharp cannot decode", async () => {
  const garbage = Buffer.from("not an image at all", "utf8");
  const hex = await toDominantHex(garbage);
  assert.equal(hex, null);
});
