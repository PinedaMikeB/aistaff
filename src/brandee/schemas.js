// Brandee schema validation — using the project's existing validator (zod,
// already a dependency and already used for request validation in server.js).
// Nothing produced by the AI provider is trusted or rendered until it passes
// these schemas.

const { z } = require("zod");
const { BUSINESS_GOALS } = require("./goalMappings");
const { AWARENESS_LEVELS, AUDIENCE_SOURCES } = require("./awareness");
const { HOOK_CATEGORIES } = require("./hooks");

const PLATFORMS = ["facebook", "instagram", "tiktok", "youtube", "website", "multiple"];
const LANGUAGES = ["english", "filipino", "taglish"];

const BusinessGoalEnum = z.enum(BUSINESS_GOALS);
const AwarenessLevelEnum = z.enum(AWARENESS_LEVELS);
const HookCategoryEnum = z.enum(HOOK_CATEGORIES);

// ---------------------------------------------------------------------------
// Public request body: the Brandee Business Analysis form
// ---------------------------------------------------------------------------
const AnalyzeRequestSchema = z.object({
  selectedGoal: BusinessGoalEnum,
  url: z.string().min(1, "Website, Facebook Page, or store link is required").max(500),
  whatYouSell: z.string().min(1).max(400),
  idealCustomer: z.string().min(1).max(400),
  platform: z.enum(PLATFORMS),
  language: z.enum(LANGUAGES),
  offer: z.string().max(300).optional().nullable(),
  differentiator: z.string().max(300).optional().nullable(),
  additionalInfo: z.string().max(600).optional().nullable(),
  regenerate: z.boolean().optional(),
  acceptedGoalOverride: BusinessGoalEnum.optional().nullable(),
  // PART 16 — who will actually see this ad, distinct from what the website
  // says. Optional + defaults to "unknown" so existing/older form
  // submissions (and any client that hasn't added this field to its UI yet)
  // keep working exactly as before.
  audienceSource: z.enum(AUDIENCE_SOURCES).optional().default("unknown"),
  acceptedBusinessProfileOverrides: z.record(z.string(), z.any()).optional().nullable(),
  sessionId: z.string().max(120).optional().nullable()
});

// ---------------------------------------------------------------------------
// BusinessProfile (formerly WebsiteBusinessAnalysis — upgraded per the
// crawler/extraction reliability pass: multi-page crawl summary, richer
// product/service consolidation, structured contacts, evidence-source
// separation (verified website / linked subdomain / linked external / user
// / inference — PART 12), blog-state honesty, and a profile-confirmation
// signal.)
// ---------------------------------------------------------------------------
const ProductOrServiceEvidenceEntryTypeEnum = z.string(); // free-form entityType label, not a closed set (kept lenient)

const EvidenceSchema = z.object({
  statement: z.string(),
  sourceType: z.enum(["website", "linked_subdomain", "linked_external", "user", "inference"]),
  sourceUrl: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  entityType: ProductOrServiceEvidenceEntryTypeEnum.default("unknown")
});

const ProductOrServiceSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["product", "service"]),
  category: z.string().nullable().default(null),
  description: z.string().nullable(),
  features: z.array(z.string()).default([]),
  functionalBenefits: z.array(z.string()).default([]),
  businessOutcomes: z.array(z.string()).default([]),
  customerProblemsSolved: z.array(z.string()).default([]),
  idealCustomers: z.array(z.string()).default([]),
  price: z.string().nullable().default(null),
  offer: z.string().nullable().default(null),
  availability: z.string().nullable().default(null),
  sourceUrls: z.array(z.string()).default([]),
  evidence: z.array(EvidenceSchema).default([]),
  confidence: z.number().min(0).max(1).default(0.4)
});

const TestimonialSchema = z.object({
  quote: z.string(),
  attribution: z.string().nullable(),
  sourceText: z.string().nullable().optional(),
  sourceUrl: z.string().nullable().optional()
});

const VerifiedNumberSchema = z.object({
  value: z.number(),
  sourceUrl: z.string().nullable().optional(),
  excerpt: z.string().nullable().optional()
}).nullable();

const ProofSchema = z.object({
  testimonials: z.array(TestimonialSchema).default([]),
  reviewCount: VerifiedNumberSchema.default(null),
  rating: VerifiedNumberSchema.default(null),
  customerCount: VerifiedNumberSchema.default(null),
  yearsInBusiness: VerifiedNumberSchema.default(null),
  awards: z.array(EvidenceSchema).default([]),
  certifications: z.array(EvidenceSchema).default([]),
  guarantees: z.array(EvidenceSchema).default([])
});

const ExtractedContactSchema = z.object({
  type: z.enum(["phone", "email", "messenger", "whatsapp", "viber", "contact_form", "booking", "address", "facebook", "instagram", "other"]),
  value: z.string(),
  sourceUrl: z.string().nullable().optional(),
  verified: z.boolean().default(true)
});

const CrawlSummarySchema = z.object({
  pagesDiscovered: z.number().int().min(0).default(0),
  pagesCrawled: z.number().int().min(0).default(0),
  pagesRejected: z.number().int().min(0).default(0),
  subdomainsCrawled: z.array(z.string()).default([]),
  pageTypes: z.record(z.string(), z.number()).default({}),
  warnings: z.array(z.string()).default([])
});

const BLOG_STATES = ["blog_present", "blog_empty", "blog_link_present_but_no_articles", "blog_not_found", "blog_unreachable", "unknown"];

const WebsiteBusinessAnalysisSchema = z.object({
  sourceUrl: z.string().nullable(),
  crawlSummary: CrawlSummarySchema.default({}),
  // "website_and_manual" / "website_only" once real pages were actually
  // read; "manual_only" for the graceful-fallback object built when
  // scraping is unavailable/blocked.
  sourceMode: z.enum(["website_and_manual", "website_only", "manual_only"]).default("manual_only"),
  businessName: z.string().nullable(),
  businessNameConfidence: z.number().min(0).max(1).default(0),
  businessType: z.enum(["product", "service", "both", "unknown"]).default("unknown"),
  industry: z.string().nullable(),
  summary: z.string(),
  productsOrServices: z.array(ProductOrServiceSchema).default([]),
  targetAudienceSignals: z.array(z.string()).default([]),
  primaryProblemsSolved: z.array(z.string()).default([]),
  // What the customer wants/hopes for (distinct from the problem they have).
  // Left empty by the deterministic heuristic extractor rather than guessed
  // from regex matches — populated only by the optional AI enrichment layer,
  // which is better suited to this more interpretive signal.
  customerDesires: z.array(z.string()).default([]),
  features: z.array(z.string()).default([]),
  functionalBenefits: z.array(z.string()).default([]),
  businessOutcomes: z.array(z.string()).default([]),
  primaryBenefits: z.array(z.string()).default([]),
  differentiators: z.array(z.string()).default([]),
  offers: z.array(z.string()).default([]),
  callsToAction: z.array(z.string()).default([]),
  contactMethods: z.array(ExtractedContactSchema).default([]),
  locations: z.array(z.string()).default([]),
  blogState: z.enum(BLOG_STATES).default("unknown"),
  proof: ProofSchema.default({}),
  brandTone: z.array(z.string()).default([]),
  claimsFound: z.array(z.string()).default([]),
  // Structured, source-attributed evidence backing the extraction — every
  // major claim used by the planner/results page should trace back to one
  // of these, tagged verified (website/linked_subdomain/linked_external),
  // user-supplied, or inferred (PART 12). Never displayed as a verified
  // website claim when sourceType === "inference".
  evidence: z.array(EvidenceSchema).default([]),
  inferences: z.array(EvidenceSchema).default([]),
  missingInformation: z.array(z.string()).default([]),
  contradictions: z.array(z.string()).default([]),
  // PART 15 — set true when name confidence is low, products/audience are
  // ambiguous, contradictions exist, or the crawl found too little content;
  // the analyze route surfaces this as a confirmation step before planning.
  confirmationRequired: z.boolean().default(false),
  confirmationReasons: z.array(z.string()).default([]),
  confidence: z.number().min(0).max(1).default(0.4),
  fetchStatus: z.enum(["ok", "blocked", "unreachable", "manual_only"]).default("ok")
});

// PART 19 — 11 independently-scored dimensions (up from 8). Every dimension
// is computed application-side in hookScoring.js and never trusted from an
// AI response; scores can legitimately go negative-adjacent via penalties
// but are always clamped into 1-5 before being stored here, so the schema
// range itself stays simple and the PENALTY bookkeeping lives in
// `penalties`/`rejectionReasons` instead of distorting the 1-5 scale.
const HookScoreSchema = z.object({
  hook: z.string(),
  category: HookCategoryEnum,
  templateId: z.string(),
  scores: z.object({
    relevance: z.number().int().min(1).max(5),
    clarity: z.number().int().min(1).max(5),
    specificity: z.number().int().min(1).max(5),
    curiosity: z.number().int().min(1).max(5),
    credibility: z.number().int().min(1).max(5),
    audienceFit: z.number().int().min(1).max(5),
    platformFit: z.number().int().min(1).max(5),
    goalAlignment: z.number().int().min(1).max(5),
    proofSafety: z.number().int().min(1).max(5),
    naturalness: z.number().int().min(1).max(5),
    distinctiveness: z.number().int().min(1).max(5)
  }),
  total: z.number().int().min(11).max(55),
  maximum: z.literal(55),
  status: z.enum(["approved", "rewrite", "rejected"]),
  explanation: z.string(),
  penalties: z.array(z.string()).default([]),
  rejectionReasons: z.array(z.string()).default([])
});

// ---------------------------------------------------------------------------
// EvidenceItem — the flat evidence shape used inside the FINAL PLAN's
// proof.available / angle.proofUsed / scene.evidenceUsed lists. Deliberately
// kept separate and simpler than the BusinessProfile's EvidenceSchema above
// (which additionally tags entityType and distinguishes linked_subdomain/
// linked_external) — the plan layer only ever needs to say "verified from
// the website", "from you", or "Brandee's inference", which `source` covers.
// ---------------------------------------------------------------------------
const EvidenceItemSchema = z.object({
  claim: z.string(),
  source: z.enum(["website", "user", "inference", "missing"]),
  sourceUrl: z.string().nullable().optional(),
  sourceExcerpt: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1)
});

// ---------------------------------------------------------------------------
// BrandeeCreativePlan
// ---------------------------------------------------------------------------
const UGC_SCENE_PURPOSES = ["hook", "problem", "context", "solution", "benefit", "proof", "demonstration", "objection", "cta"];

const SceneSchema = z.object({
  sceneNumber: z.number().int().min(1),
  durationSeconds: z.number().min(1).max(60),
  purpose: z.string(), // free-form label kept for back-compat display; purposeCategory below is the validated enum
  purposeCategory: z.enum(UGC_SCENE_PURPOSES).default("context"),
  dialogue: z.string(),
  spokenDialogue: z.string().optional(), // alias of `dialogue`, present per the UGCScene spec shape
  onScreenText: z.string().nullable().default(null),
  visualDirection: z.string(),
  productDirection: z.string().nullable().default(null),
  evidenceUsed: z.array(EvidenceItemSchema).default([]),
  caption: z.string(),
  estimatedWordCount: z.number().int().min(0).default(0)
});

const CreativeAngleSchema = z.object({
  id: z.string(),
  name: z.string(),
  tension: z.string(),
  hook: z.string(),
  category: HookCategoryEnum,
  customerProblem: z.string().default(""),
  desiredOutcome: z.string().default(""),
  coreMessage: z.string().default(""),
  reasonToBelieve: z.array(z.string()).default([]),
  proofUsed: z.array(EvidenceItemSchema).default([]),
  formatSuitability: z.array(z.string()).default([]),
  awarenessFit: z.array(z.string()).default([]),
  goalFit: z.array(z.string()).default([])
});

const RecommendationRationaleSchema = z.object({
  whyThisGoal: z.string().default(""),
  whyThisAwareness: z.string().default(""),
  whyThisAngle: z.string().default(""),
  whyThisFramework: z.string().default(""),
  whyThisFormat: z.string().default(""),
  proofSupporting: z.array(z.string()).default([]),
  proofMissing: z.array(z.string()).default([]),
  blockedFrameworksExplained: z.array(z.string()).default([]),
  whatIsBeingTested: z.string().default("")
});

const BrandeeCreativePlanSchema = z.object({
  planId: z.string(),
  createdAt: z.string(),
  sourceUrl: z.string(),
  businessSummary: z.object({
    name: z.string(),
    businessType: z.string(),
    industry: z.string(),
    offer: z.string(),
    targetAudience: z.string(),
    primaryProblem: z.string(),
    primaryBenefit: z.string(),
    differentiators: z.array(z.string()).default([])
  }),
  selectedGoal: BusinessGoalEnum,
  recommendedGoal: BusinessGoalEnum,
  goalChanged: z.boolean(),
  goalExplanation: z.string(),
  awareness: z.object({
    level: AwarenessLevelEnum,
    confidence: z.number().min(0).max(1),
    explanation: z.string()
  }),
  angles: z.array(CreativeAngleSchema).min(1),
  strategy: z.object({
    primaryAngle: z.string(),
    alternativeAngles: z.array(z.string()).min(0),
    staticAdFramework: z.object({ id: z.string(), name: z.string(), explanation: z.string() }),
    videoFormat: z.string(),
    hookCategory: HookCategoryEnum,
    hookTemplateId: z.string(),
    primaryHook: z.string(),
    alternativeHooks: z.array(z.string()).default([]),
    explanation: z.string()
  }),
  proof: z.object({
    available: z.array(EvidenceItemSchema).default([]),
    missing: z.array(z.string()).default([]),
    restrictedClaims: z.array(z.string()).default([])
  }),
  script: z.object({
    language: z.string(),
    durationSeconds: z.number().min(1).max(120),
    scenes: z.array(SceneSchema).min(1)
  }),
  creatorRecommendation: z.object({
    persona: z.string(),
    ageRange: z.string().nullable(),
    setting: z.string(),
    deliveryStyle: z.string(),
    voiceStyle: z.string(),
    explanation: z.string()
  }),
  production: z.object({
    platform: z.enum(PLATFORMS),
    aspectRatio: z.string(),
    durationSeconds: z.number().min(1).max(120),
    callToAction: z.string(),
    numberOfVariations: z.number().int().min(1).max(10)
  }),
  staticAdConcept: z.object({
    framework: z.string(),
    headline: z.string(),
    subheadline: z.string().nullable().default(null),
    supportingCopy: z.array(z.string()).default([]),
    verifiedBenefit: z.string().nullable().default(null),
    differentiator: z.string().nullable().default(null),
    visualLayout: z.string(),
    layoutDirection: z.string().default(""),
    assetRequirements: z.array(z.string()).default([]),
    proofUsed: z.array(EvidenceItemSchema).default([]),
    prohibitedClaims: z.array(z.string()).default([]),
    aspectRatios: z.array(z.string()).default([]),
    callToAction: z.string()
  }),
  hookScores: z.array(HookScoreSchema).min(1),
  // Rejected hooks are kept for Super Admin diagnostics only (PART 19/27) —
  // the customer-facing results page must never render this array.
  rejectedHookScores: z.array(HookScoreSchema).default([]),
  recommendationRationale: RecommendationRationaleSchema.default({}),
  businessProfileConfirmationRequired: z.boolean().default(false),
  warnings: z.array(z.string()).default([]),
  assumptions: z.array(z.string()).default([]),
  generatedBy: z.enum(["ai", "deterministic"]).default("deterministic")
});

module.exports = {
  PLATFORMS,
  LANGUAGES,
  BLOG_STATES,
  AnalyzeRequestSchema,
  WebsiteBusinessAnalysisSchema,
  // Alias — this task's spec refers to the extraction output as
  // "BusinessProfile"; keeping both export names avoids breaking any
  // straggler import of the older name.
  BusinessProfileSchema: WebsiteBusinessAnalysisSchema,
  ProductOrServiceSchema,
  TestimonialSchema,
  ProofSchema,
  EvidenceSchema,
  ExtractedContactSchema,
  CrawlSummarySchema,
  EvidenceItemSchema,
  HookScoreSchema,
  SceneSchema,
  CreativeAngleSchema,
  RecommendationRationaleSchema,
  BrandeeCreativePlanSchema
};
