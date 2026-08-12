// Shared product-ad schemas for the Brandee product-ad MVP (PART 7).
//
// Both the Image Ad and Video Ad flows submit the same base product fields —
// this is the single validation source for that shared shape, plus the
// image/video-specific extensions layered on top.

const { z } = require("zod");
const { LANGUAGES } = require("./schemas");

const DESIRED_ACTIONS = ["buy_now", "send_message", "visit_product_page", "learn_more"];

// A data-URL image ("data:image/png;base64,....") kept intentionally simple
// (no multipart parsing here) — actual bytes are validated for real
// magic-byte type + size limits in mediaValidation.js before this schema
// ever sees them; this just checks the wrapper shape.
const DataUrlImage = z.string().min(32).regex(/^data:image\/(png|jpeg|jpg|webp);base64,/i, "Must be a PNG, JPEG, or WebP image");

const SharedProductFormSchema = z.object({
  // Required (PART 7)
  productImage: DataUrlImage,
  productName: z.string().min(1).max(150),
  productDescription: z.string().min(1).max(1000),
  mainFeatures: z.string().min(1).max(600),
  targetCustomer: z.string().min(1).max(300),
  desiredAction: z.enum(DESIRED_ACTIONS),

  // Optional (PART 7) — never required before the free preview. 2048, not
  // 500: real e-commerce listing URLs (Lazada/Shopee tracking params in
  // particular) routinely run 1000+ characters — confirmed with a real
  // Lazada URL that hit 500 and got rejected with a 400 before this fix.
  productListingUrl: z.string().url().max(2048).optional().nullable(),
  // Structured price/offer fields (PART 7 — replaces the old, confusing
  // single "Offer or discount" free-text field). `price` is kept as a
  // simple derived/legacy alias (set to regularPrice by the client) so
  // templates that only care about "a" price (e.g. Minimal Ecommerce) don't
  // need to know about the structured breakdown.
  price: z.string().max(60).optional().nullable(),
  regularPrice: z.string().max(60).optional().nullable(),
  promoPrice: z.string().max(60).optional().nullable(),
  discountText: z.string().max(60).optional().nullable(),
  offerExpirationDate: z.string().max(20).optional().nullable(),
  offerDetails: z.string().max(200).optional().nullable(),
  offer: z.string().max(200).optional().nullable(),
  mainBenefit: z.string().max(200).optional().nullable(),
  logo: DataUrlImage.optional().nullable(),
  brandColors: z.array(z.string().regex(/^#[0-9a-f]{6}$/i)).max(4).optional().default([]),
  additionalProductImages: z.array(DataUrlImage).max(4).optional().default([]),
  preferredLanguage: z.enum(LANGUAGES).optional().default("english"),
  additionalNotes: z.string().max(500).optional().nullable(),

  // Testimonial proof, only used to unlock the Testimonial Style template —
  // never fabricated if absent.
  testimonialQuote: z.string().max(300).optional().nullable(),
  testimonialAttribution: z.string().max(80).optional().nullable(),

  // Session/project continuity
  anonymousSessionId: z.string().max(120).optional().nullable(),
  projectId: z.string().max(120).optional().nullable()
});

const ImageAdRequestSchema = SharedProductFormSchema.extend({
  templateId: z.string().min(1),
  // Customer-chosen ad shape. Decided BEFORE generation because it sets
  // the actual pixel size sent to the image model and changes the layout
  // the art director composes (see adAspectRatios.js).
  aspectRatio: z.enum(["4:5", "1:1", "9:16"]).optional().default("4:5"),
  templateFields: z.record(z.string(), z.any()).default({})
});

const VideoAdRequestSchema = SharedProductFormSchema.extend({
  styleId: z.string().min(1),
  hookPreference: z.string().max(40).optional().nullable(),
  tone: z.string().max(40).optional().nullable(),
  creatorType: z.string().max(60).optional().nullable(),
  setting: z.string().max(60).optional().nullable(),
  preferredFinalLength: z.number().int().min(5).max(120).optional().nullable(),
  ctaText: z.string().max(60).optional().nullable(),
  voicePreference: z.string().max(60).optional().nullable()
});

const ProductUrlExtractRequestSchema = z.object({
  url: z.string().url().max(2048)
});

// "Analyze Product" — Brandee Image Ad Workspace AI-assisted analysis
// (productAnalysisService.js). At least one of productUrl/businessWebsite/
// productName/productDescription must be supplied — enforced by the route
// handler (productAnalysisService itself returns an honest warning rather
// than throwing if all four are absent, since this is also called
// server-side in contexts where that's a soft, recoverable case).
const AnalyzeProductRequestSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  templateId: z.string().min(1).max(80),
  productUrl: z.string().url().max(2048).optional().nullable(),
  businessWebsite: z.string().url().max(2048).optional().nullable(),
  productName: z.string().max(140).optional().nullable(),
  productDescription: z.string().max(2000).optional().nullable(),
  existingFields: z.record(z.any()).optional().default({})
});

// Per-field AI assistance (the sparkle-icon popover, productAnalysisService's
// generateFieldAssist).
const FieldAssistRequestSchema = z.object({
  projectId: z.string().uuid().optional().nullable(),
  templateId: z.string().min(1).max(80),
  fieldKey: z.string().min(1).max(60),
  fieldLabel: z.string().min(1).max(140),
  action: z.string().min(1).max(60),
  mode: z.enum(["suggest", "improve", "generate_again"]).optional().default("suggest"),
  currentValue: z.string().max(2000).optional().nullable(),
  context: z.record(z.any()).optional().default({})
});

function hasRealTestimonial(form) {
  return Boolean(form.testimonialQuote && form.testimonialQuote.trim().length > 0 && form.testimonialAttribution && form.testimonialAttribution.trim().length > 0);
}

// Turns a Zod parse failure into a specific, actionable message instead of
// a generic catch-all. Found via a real bug report: a schema rejection was
// shown to the customer as "Please provide a template and at least a
// product link..." even when they HAD provided a product link — it was
// just longer than the old max() limit — so the message told them to do
// the exact thing they'd already done, with no way to know the real
// problem was length. Every route below now builds its user-facing error
// from the actual first Zod issue, falling back to the generic message
// only when there's truly no issue to describe.
const FIELD_LABELS = {
  productUrl: "Product URL",
  businessWebsite: "Business website URL",
  productListingUrl: "Product URL",
  url: "URL",
  templateId: "Template",
  productName: "Product name",
  productDescription: "Product description",
  fieldKey: "Field",
  fieldLabel: "Field label",
  action: "Action",
  projectId: "Project"
};

function describeZodError(error, fallback) {
  const issue = error?.issues?.[0];
  if (!issue) return fallback;
  const label = FIELD_LABELS[issue.path?.[0]] || (issue.path?.length ? String(issue.path[issue.path.length - 1]) : "This field");
  if (issue.code === "too_big") return `${label} is too long (max ${issue.maximum} characters) — please shorten it or remove tracking parameters from the URL.`;
  if (issue.code === "too_small") return `${label} is required.`;
  if (issue.code === "invalid_string" && issue.validation === "url") return `${label} doesn't look like a valid web address. Please check it and try again.`;
  if (issue.code === "invalid_type") return `${label} is missing or in the wrong format.`;
  return issue.message ? `${label}: ${issue.message}` : fallback;
}

module.exports = {
  DESIRED_ACTIONS,
  SharedProductFormSchema,
  ImageAdRequestSchema,
  VideoAdRequestSchema,
  ProductUrlExtractRequestSchema,
  AnalyzeProductRequestSchema,
  FieldAssistRequestSchema,
  hasRealTestimonial,
  describeZodError
};
