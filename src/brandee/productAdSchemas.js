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

  // Optional (PART 7) — never required before the free preview.
  productListingUrl: z.string().url().max(500).optional().nullable(),
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
  url: z.string().url().max(500)
});

function hasRealTestimonial(form) {
  return Boolean(form.testimonialQuote && form.testimonialQuote.trim().length > 0 && form.testimonialAttribution && form.testimonialAttribution.trim().length > 0);
}

module.exports = {
  DESIRED_ACTIONS,
  SharedProductFormSchema,
  ImageAdRequestSchema,
  VideoAdRequestSchema,
  ProductUrlExtractRequestSchema,
  hasRealTestimonial
};
