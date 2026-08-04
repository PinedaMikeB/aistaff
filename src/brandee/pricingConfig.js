// Central pricing configuration for the Brandee product-ad MVP (image + video
// ad creation). Single source of truth for plan names, prices, and image/
// video allowances — the landing page pricing section, the subscription
// gate, and the DB seed (ensureBrandeeProductAdsCatalog in server.js) all
// read from this file instead of repeating quantities across HTML sections.
//
// IMPORTANT — PLACEHOLDER QUANTITIES: the monthly prices and image/video
// credit counts below are configuration placeholders, not finalized numbers.
// No actual production-cost data (image-generation cost per asset, video
// render cost per second, storage cost) was available when this was written.
// Every quantity here is marked `placeholder: true` and must be reviewed
// against real provider/render costs before public launch. Do not treat
// these numbers as committed pricing.

const BRANDEE_PRODUCT_SLUG = "brandee-product-ads";
const BRANDEE_PRODUCT_NAME = "Brandee Product Ads";

const PRICING_QUANTITIES_ARE_PLACEHOLDERS = true;

const PLANS = [
  {
    slug: "starter",
    name: "Starter",
    tagline: "Image-focused plan for sellers who mainly need product image ads.",
    monthlyPrice: 999,
    annualPrice: 9990,
    currency: "PHP",
    bestFor: "Solo sellers and small shops posting product ads regularly.",
    placeholder: true,
    imageCreditsPerMonth: 15,
    videoCreditsPerMonth: 2,
    videoMaxLengthSeconds: 15,
    highResImageExport: true,
    additionalVariationsPerAsset: 1,
    multipleProducts: false,
    priorityRendering: false,
    brandKits: 1,
    features: [
      "Image preview and final export",
      "Copy and headline generation",
      "1 brand kit (logo + colors)",
      "3-second video previews included",
      "Full videos require a top-up or a higher plan"
    ]
  },
  {
    slug: "creator",
    name: "Creator",
    tagline: "More image ads plus a real monthly video allowance.",
    monthlyPrice: 2499,
    annualPrice: 24990,
    currency: "PHP",
    badge: "Most Popular",
    bestFor: "Content creators and online sellers who post image and video ads weekly.",
    placeholder: true,
    imageCreditsPerMonth: 40,
    videoCreditsPerMonth: 8,
    videoMaxLengthSeconds: 20,
    highResImageExport: true,
    additionalVariationsPerAsset: 2,
    multipleProducts: false,
    priorityRendering: false,
    brandKits: 1,
    features: [
      "Everything in Starter",
      "More image ads every month",
      "Limited full video allowance every month",
      "3-second previews for every concept",
      "More templates and video styles unlocked",
      "High-resolution image export"
    ]
  },
  {
    slug: "growth",
    name: "Growth",
    tagline: "Higher image and video allowance for multiple products.",
    monthlyPrice: 5999,
    annualPrice: 59990,
    currency: "PHP",
    bestFor: "Small marketing teams and media buyers managing several products.",
    placeholder: true,
    imageCreditsPerMonth: 100,
    videoCreditsPerMonth: 20,
    videoMaxLengthSeconds: 30,
    highResImageExport: true,
    additionalVariationsPerAsset: 4,
    multipleProducts: true,
    priorityRendering: true,
    brandKits: 3,
    features: [
      "Everything in Creator",
      "Higher image allowance",
      "Higher video allowance",
      "Multiple products and brand kits",
      "Priority rendering",
      "More variations per asset"
    ]
  }
];

// Anonymous (pre-registration) preview limits — enforced server-side
// regardless of what a client sends. One preview per kind per anonymous
// session, matching PART 13's "Anonymous access: one image preview or one
// 3-second video preview".
const ANONYMOUS_LIMITS = {
  imagePreviewsPerSession: 1,
  videoPreviewsPerSession: 1
};

function getPlan(slug) {
  return PLANS.find((plan) => plan.slug === slug) || null;
}

function listPlans() {
  return PLANS;
}

module.exports = {
  BRANDEE_PRODUCT_SLUG,
  BRANDEE_PRODUCT_NAME,
  PRICING_QUANTITIES_ARE_PLACEHOLDERS,
  PLANS,
  ANONYMOUS_LIMITS,
  getPlan,
  listPlans
};
