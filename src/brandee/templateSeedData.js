// Initial Super Admin-managed template catalog (PART 8/9/14/15). Ten static-
// ad templates and eight UGC/video templates, mapped where applicable onto
// this codebase's existing static-ad framework keys (staticAdFrameworks.js)
// so the underlying copywriting logic those frameworks already encode is
// reused, not duplicated. This is the seed content for `prisma/seed.js` AND
// the fallback content `templateCatalog.js` serves if the database is
// unreachable — see that module's header comment for why a fallback exists.

const { IMAGE_AD_TEMPLATES } = require("./imageAdTemplates");
const { VIDEO_AD_STYLES } = require("./videoAdStyles");

// Maps each image-ad template id -> { category, frameworkKey, overlaySchema,
// supportedAspectRatios }. frameworkKey references this codebase's existing
// staticAdFrameworks.js entries (Us vs Them, Bold Claim, iPhone Notes,
// Features & Benefits, Before & After, Offer, Testimonial, Question, Reasons
// Why, Sticky Notes) where a genuine equivalent exists; null where the
// template is closer to a layout than one of those specific frameworks.
const STATIC_TEMPLATE_META = {
  product_highlight: { category: "Product Highlight", frameworkKey: null, aspectRatios: ["1:1", "4:5"] },
  feature_benefit: { category: "Feature and Benefit", frameworkKey: "features_and_benefits", aspectRatios: ["1:1", "4:5"] },
  offer_promo: { category: "Offer or Promo", frameworkKey: "offer", aspectRatios: ["1:1", "4:5", "9:16"] },
  problem_solution: { category: "Problem and Solution", frameworkKey: null, aspectRatios: ["1:1", "4:5"] },
  question_ad: { category: "Question Ad", frameworkKey: "question", aspectRatios: ["1:1", "4:5"] },
  comparison: { category: "Comparison", frameworkKey: "us_vs_them", aspectRatios: ["1:1", "4:5"] },
  minimal_ecommerce: { category: "Minimal Ecommerce", frameworkKey: null, aspectRatios: ["1:1"] },
  testimonial_style: { category: "Testimonial Style", frameworkKey: "testimonial", aspectRatios: ["1:1", "4:5"] },
  before_and_after: { category: "Before and After", frameworkKey: "before_and_after", aspectRatios: ["1:1", "4:5"] },
  bold_claim: { category: "Bold Claim", frameworkKey: "bold_claim", aspectRatios: ["1:1", "4:5", "9:16"] }
};

// Shared default overlay layout — every template starts from this bounding-
// box arrangement (product photo top half, text block bottom half, CTA
// pinned to the bottom); Super Admin can adjust per-template afterward.
function defaultOverlaySchema() {
  return {
    productImage: { x: 0.08, y: 0.1, width: 0.84, height: 0.46, alignment: "center", layerOrder: 1 },
    headline: { x: 0.08, y: 0.62, width: 0.84, height: 0.12, alignment: "left", minFontSize: 22, maxFontSize: 40, maxLines: 2, layerOrder: 3 },
    subheadline: { x: 0.08, y: 0.75, width: 0.84, height: 0.1, alignment: "left", minFontSize: 14, maxFontSize: 20, maxLines: 2, layerOrder: 3 },
    price: { x: 0.08, y: 0.9, width: 0.4, height: 0.06, alignment: "left", minFontSize: 18, maxFontSize: 28, maxLines: 1, layerOrder: 3 },
    cta: { x: 0.08, y: 0.94, width: 0.5, height: 0.05, alignment: "center", layerOrder: 4 },
    safeMargins: { top: 0.04, right: 0.04, bottom: 0.03, left: 0.04 }
  };
}

function buildStaticTemplateSeeds() {
  return IMAGE_AD_TEMPLATES.map((t, index) => {
    const meta = STATIC_TEMPLATE_META[t.id] || { category: t.name, frameworkKey: null, aspectRatios: ["4:5"] };
    return {
      slug: t.id,
      name: t.name,
      description: t.description,
      category: meta.category,
      frameworkKey: meta.frameworkKey,
      previewImageUrl: t.thumbnail,
      thumbnailUrl: t.thumbnail,
      sourceAssetUrl: null,
      overlaySchema: defaultOverlaySchema(),
      requiredFieldsSchema: t.fields.filter((f) => f.required),
      optionalFieldsSchema: t.fields.filter((f) => !f.required),
      proofRequirements: t.proofRequirement ? [t.proofRequirement] : [],
      supportedAspectRatios: meta.aspectRatios,
      defaultAspectRatio: meta.aspectRatios[0],
      defaultLanguage: "english",
      renderMode: "COMPOSITE_TEMPLATE",
      tags: [meta.category.toLowerCase().replace(/\s+/g, "-")],
      sortOrder: index,
      status: "ACTIVE",
      isFeatured: index === 0,
      isPremium: false
    };
  });
}

const VIDEO_STYLE_META = {
  ugc_recommendation: { category: "UGC Product Recommendation" },
  product_demo: { category: "Product Demonstration" },
  problem_solution: { category: "Problem and Solution" },
  offer_promo: { category: "Offer Promo" },
  unboxing: { category: "Unboxing" },
  product_showcase: { category: "Product Showcase" },
  founder_expert_style: { category: "Founder or Expert Style" },
  voiceover_product_ad: { category: "Voiceover Product Ad" }
};

function defaultSceneSchema(style) {
  return [
    { sceneNumber: 1, durationSeconds: 3, onScreenText: null, spokenDialogue: null, visualAction: "Opening hook shot introducing the product.", cameraFraming: "medium shot", productPlacement: "held or placed in frame", transition: "cut", providerPrompt: null, negativePrompt: null },
    { sceneNumber: 2, durationSeconds: Math.max(1, (style.suggestedLengthSeconds || 15) - 8), onScreenText: null, spokenDialogue: null, visualAction: "Main product demonstration / benefit beat.", cameraFraming: "close-up", productPlacement: "in active use", transition: "cut", providerPrompt: null, negativePrompt: null },
    { sceneNumber: 3, durationSeconds: 5, onScreenText: null, spokenDialogue: null, visualAction: "Closing CTA shot.", cameraFraming: "medium shot", productPlacement: "clearly visible", transition: "fade", providerPrompt: null, negativePrompt: null }
  ];
}

function buildUgcTemplateSeeds() {
  return VIDEO_AD_STYLES.map((s, index) => {
    const meta = VIDEO_STYLE_META[s.id] || { category: s.name };
    return {
      slug: s.id,
      name: s.name,
      description: s.description,
      category: meta.category,
      previewPosterUrl: s.poster,
      previewVideoUrl: null,
      sourceAssetUrl: null,
      storyboardSchema: { beats: ["hook", "demonstration_or_benefit", "cta"] },
      sceneSchema: defaultSceneSchema(s),
      creatorRequirements: { creatorTypes: s.requiredInputs.includes("creatorType") ? ["customer_style", "presenter", "founder_style_spokesperson"] : [], notes: null },
      voiceRequirements: { voiceOptions: s.requiredInputs.includes("voicePreference") ? ["neutral", "warm", "energetic"] : [], notes: null },
      scriptSchema: { structure: ["hook", "body", "cta"], notes: null },
      requiredFieldsSchema: s.requiredInputs.map((key) => ({ key, label: key, type: "text", required: true })),
      optionalFieldsSchema: [],
      proofRequirements: [],
      supportedDurations: [15, 30, 60],
      supportedAspectRatios: ["9:16"],
      supportedLanguages: ["english", "filipino", "taglish"],
      modelProvider: "remotion",
      providerConfiguration: { compositionId: "ProductTeaser" },
      tags: [meta.category.toLowerCase().replace(/\s+/g, "-")],
      sortOrder: index,
      status: "ACTIVE",
      isFeatured: index === 0,
      isPremium: false
    };
  });
}

module.exports = { buildStaticTemplateSeeds, buildUgcTemplateSeeds, defaultOverlaySchema };
