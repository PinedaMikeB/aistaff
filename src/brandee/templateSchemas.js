// Zod validation for Super Admin-managed Brandee templates (PART 9/15/18/19).
// Used by both the admin API routes (create/update payloads) and the seed
// script, so a hand-typed seed row is validated exactly the same way an
// admin-submitted one is.

const { z } = require("zod");

const TEMPLATE_STATUSES = ["DRAFT", "ACTIVE", "INACTIVE", "ARCHIVED"];
const RENDER_MODES = ["COMPOSITE_TEMPLATE", "AI_GENERATED_LAYOUT"];
const ASPECT_RATIOS = ["1:1", "4:5", "9:16", "16:9"];

// A single editable overlay region, in normalized (0-1) coordinates so it's
// resolution-independent — PART 18's "at minimum, allow editable bounding
// boxes using normalized coordinates".
const OverlayRegion = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
  alignment: z.enum(["left", "center", "right"]).default("left"),
  minFontSize: z.number().int().min(8).max(120).optional(),
  maxFontSize: z.number().int().min(8).max(120).optional(),
  maxLines: z.number().int().min(1).max(10).optional(),
  layerOrder: z.number().int().default(0)
});

// The fixed set of overlay areas a COMPOSITE_TEMPLATE may define — matches
// PART 9's list (product image position, logo position, headline box,
// subheadline box, price box, offer badge, CTA box, safe margins). All
// optional: a template only needs to define the regions its layout uses.
const OverlaySchema = z.object({
  productImage: OverlayRegion.optional(),
  logo: OverlayRegion.optional(),
  headline: OverlayRegion.optional(),
  subheadline: OverlayRegion.optional(),
  price: OverlayRegion.optional(),
  offerBadge: OverlayRegion.optional(),
  cta: OverlayRegion.optional(),
  background: OverlayRegion.optional(),
  safeMargins: z.object({ top: z.number().min(0).max(0.3), right: z.number().min(0).max(0.3), bottom: z.number().min(0).max(0.3), left: z.number().min(0).max(0.3) }).optional(),
  colors: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).max(6).optional(),
  fontScale: z.number().min(0.5).max(2).optional()
}).default({});

const TemplateFieldDef = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  type: z.enum(["text", "textarea", "select", "date", "number"]),
  required: z.boolean().default(false),
  maxLength: z.number().int().positive().optional(),
  options: z.array(z.string()).optional()
});

const StaticTemplateInput = z.object({
  slug: z.string().min(1).max(80).regex(/^[a-z0-9_]+$/, "Slug must be lowercase letters, numbers, and underscores only"),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  category: z.string().min(1).max(80),
  frameworkKey: z.string().max(80).optional().nullable(),
  previewImageUrl: z.string().max(500).optional().nullable(),
  thumbnailUrl: z.string().max(500).optional().nullable(),
  sourceAssetUrl: z.string().max(500).optional().nullable(),
  overlaySchema: OverlaySchema,
  requiredFieldsSchema: z.array(TemplateFieldDef).default([]),
  optionalFieldsSchema: z.array(TemplateFieldDef).default([]),
  proofRequirements: z.array(z.string()).default([]),
  supportedAspectRatios: z.array(z.enum(ASPECT_RATIOS)).min(1).default(["4:5"]),
  defaultAspectRatio: z.enum(ASPECT_RATIOS).default("4:5"),
  defaultLanguage: z.enum(["english", "filipino", "taglish"]).default("english"),
  renderMode: z.enum(RENDER_MODES).default("COMPOSITE_TEMPLATE"),
  tags: z.array(z.string()).max(10).default([]),
  sortOrder: z.number().int().default(0),
  isFeatured: z.boolean().default(false),
  isPremium: z.boolean().default(false)
});

const SceneDef = z.object({
  sceneNumber: z.number().int().min(1),
  durationSeconds: z.number().min(1).max(60),
  spokenDialogue: z.string().max(400).optional().nullable(),
  onScreenText: z.string().max(200).optional().nullable(),
  visualAction: z.string().max(300).optional().nullable(),
  cameraFraming: z.string().max(120).optional().nullable(),
  productPlacement: z.string().max(200).optional().nullable(),
  transition: z.string().max(80).optional().nullable(),
  providerPrompt: z.string().max(500).optional().nullable(),
  negativePrompt: z.string().max(300).optional().nullable()
});

// Never allow a secret/API key inside a scene or provider configuration —
// PART 19 "Do not allow secrets or raw API keys inside scene prompts."
const SECRET_LIKE_PATTERN = /(secret|api[_-]?key|bearer\s|token[:=]|-----BEGIN)/i;
function assertNoSecretLikeContent(value, ctx, path) {
  const text = JSON.stringify(value);
  if (SECRET_LIKE_PATTERN.test(text)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `${path} must not contain secret-like content (API keys/tokens are never stored in template records).`, path: [path] });
  }
}

const UgcTemplateInput = z.object({
  slug: z.string().min(1).max(80).regex(/^[a-z0-9_]+$/),
  name: z.string().min(1).max(100),
  description: z.string().min(1).max(500),
  category: z.string().min(1).max(80),
  previewPosterUrl: z.string().max(500).optional().nullable(),
  previewVideoUrl: z.string().max(500).optional().nullable(),
  sourceAssetUrl: z.string().max(500).optional().nullable(),
  storyboardSchema: z.record(z.string(), z.any()).default({}),
  sceneSchema: z.array(SceneDef).default([]),
  creatorRequirements: z.object({ creatorTypes: z.array(z.string()).default([]), notes: z.string().max(300).optional().nullable() }).default({}),
  voiceRequirements: z.object({ voiceOptions: z.array(z.string()).default([]), notes: z.string().max(300).optional().nullable() }).default({}),
  scriptSchema: z.object({ structure: z.array(z.string()).default([]), notes: z.string().max(300).optional().nullable() }).default({}),
  requiredFieldsSchema: z.array(TemplateFieldDef).default([]),
  optionalFieldsSchema: z.array(TemplateFieldDef).default([]),
  proofRequirements: z.array(z.string()).default([]),
  supportedDurations: z.array(z.number().int().positive()).default([15, 30]),
  supportedAspectRatios: z.array(z.enum(ASPECT_RATIOS)).min(1).default(["9:16"]),
  supportedLanguages: z.array(z.enum(["english", "filipino", "taglish"])).default(["english"]),
  modelProvider: z.string().max(80).optional().nullable(),
  providerConfiguration: z.record(z.string(), z.any()).default({}),
  tags: z.array(z.string()).max(10).default([]),
  sortOrder: z.number().int().default(0),
  isFeatured: z.boolean().default(false),
  isPremium: z.boolean().default(false)
}).superRefine((data, ctx) => {
  assertNoSecretLikeContent(data.providerConfiguration, ctx, "providerConfiguration");
  assertNoSecretLikeContent(data.sceneSchema, ctx, "sceneSchema");
});

module.exports = {
  TEMPLATE_STATUSES,
  RENDER_MODES,
  ASPECT_RATIOS,
  OverlayRegion,
  OverlaySchema,
  TemplateFieldDef,
  StaticTemplateInput,
  SceneDef,
  UgcTemplateInput,
  SECRET_LIKE_PATTERN
};
