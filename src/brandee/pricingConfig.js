// Central pricing configuration for Brandee (image + video ad creation).
// Single source of truth for plan names, prices, tax display, and
// image/video entitlement allowances. The landing-page pricing UI, the
// Super Admin pricing page, the DB catalog seed (ensureBrandeeProductAdsCatalog
// in productAdBilling.js), and the entitlement accounting module all read
// from this file (or its Super Admin-published DB override — see
// pricingOverride.js) instead of repeating quantities across components.
//
// TAX MODE — AIStaff Solutions Corporation is currently NON-VAT registered.
// The three published prices below (₱599 / ₱1,199 / ₱2,999) are the TOTAL
// monthly prices a customer pays; no 12% VAT is added on top, and nothing in
// this app may display "VAT included" while taxMode is NON_VAT. The internal
// 3% percentage-tax reserve some non-VAT Philippine corporations set aside is
// an internal accounting matter, never a customer-facing charge, and is not
// represented anywhere in this file or in any customer-facing total.
//
// `taxMode` is centrally configurable (see PLATFORM SETTINGS / Super Admin
// -> Brandee -> Pricing) so the business can switch to VAT-inclusive display
// later WITHOUT changing the published total price and without editing this
// file in every place it's read — computeTaxBreakdown() below derives the
// VATable-sale/VAT/total breakdown from the same total price, for either mode.

const TAX_MODES = ["NON_VAT", "VAT"];

// Entitlement units — PART 27. These are the only two units used anywhere in
// customer-facing UI or in the entitlement ledger. Never mixed into a single
// generic "credits" number.
const ENTITLEMENT_UNITS = Object.freeze({
  IMAGE_FINAL: "IMAGE_FINAL",
  VIDEO_SECONDS: "VIDEO_SECONDS"
});

const BRANDEE_PRODUCT_SLUG = "brandee-product-ads";
const BRANDEE_PRODUCT_NAME = "Brandee Product Ads";

// Default (code-level) tax configuration. A SUPERADMIN can publish a DB
// override (see pricingOverride.js) that changes taxMode/vatRatePercent
// later without a code deploy; this is the fallback + the value used until
// any override is published.
const DEFAULT_TAX_CONFIG = Object.freeze({
  taxMode: "NON_VAT", // "NON_VAT" | "VAT"
  pricesAreTaxInclusive: true, // when VAT mode is later enabled, the published total stays the same and VAT is backed out of it, not added on top
  vatRatePercent: 12
});

const PRICING_QUANTITIES_ARE_PLACEHOLDERS = false; // these three prices/allowances are the final, published Brandee prices (not placeholders)

// Public plans — PART 2/3. Exactly three plans, image and video allowances
// always tracked as separate entitlement units.
const PLANS = [
  {
    slug: "image_starter",
    name: "Image Starter",
    tagline: "Everything you need to turn products into image ads.",
    monthlyPrice: 599,
    currency: "PHP",
    billingCadence: "monthly",
    bestFor: "Sellers who mainly need product image ads.",
    cta: "Start with Image Ads",
    entitlements: {
      [ENTITLEMENT_UNITS.IMAGE_FINAL]: 10,
      [ENTITLEMENT_UNITS.VIDEO_SECONDS]: 0
    },
    limits: {
      brandKits: 1,
      savedProducts: 5,
      aspectRatios: ["1:1", "4:5"],
      priorityRendering: false
    },
    imagePreviewResolution: "low-resolution (watermarked)",
    imageFinalExportResolution: "1080p",
    videoPreviewSeconds: 0,
    videoFinalExportResolution: null,
    languages: ["english", "filipino", "taglish"],
    featured: false,
    visible: true,
    sortOrder: 1,
    features: [
      "10 final image ads per billing cycle",
      "Low-resolution image previews",
      "Headline, supporting copy, caption, and CTA generation",
      "1080p final image exports",
      "1 saved brand kit",
      "Up to 5 saved products",
      "English, Filipino, and Taglish support",
      "Commercial-use exports, subject to platform terms"
    ]
  },
  {
    slug: "video_starter",
    name: "Video Starter",
    tagline: "Turn products into short-form video ads.",
    monthlyPrice: 1199,
    currency: "PHP",
    billingCadence: "monthly",
    bestFor: "Sellers and creators who need UGC-style product videos.",
    cta: "Start with Video Ads",
    entitlements: {
      [ENTITLEMENT_UNITS.IMAGE_FINAL]: 0,
      [ENTITLEMENT_UNITS.VIDEO_SECONDS]: 60 // equivalent to 2x30s, 4x15s, or 1x60s
    },
    limits: {
      brandKits: 1,
      savedProducts: 5,
      aspectRatios: ["9:16"],
      priorityRendering: false
    },
    imagePreviewResolution: null,
    imageFinalExportResolution: null,
    videoPreviewSeconds: 3,
    videoFinalExportResolution: "1080p (when supported by the configured provider)",
    languages: ["english", "filipino", "taglish"],
    featured: false,
    visible: true,
    sortOrder: 2,
    features: [
      "60 finished video seconds per billing cycle (e.g. 2x30s, 4x15s, or 1x60s)",
      "3-second teaser previews",
      "Hook, script, caption, CTA, creator, and setting selection",
      "1080p final export when supported by the configured provider",
      "1 saved brand kit",
      "Up to 5 saved products",
      "English, Filipino, and Taglish support"
    ]
  },
  {
    slug: "brandee_combo",
    name: "Brandee Combo",
    tagline: "Image and video ads together, at a lower combined price.",
    monthlyPrice: 2999,
    currency: "PHP",
    billingCadence: "monthly",
    bestFor: "Small marketing teams and media buyers who need both formats.",
    cta: "Get Image + Video",
    entitlements: {
      [ENTITLEMENT_UNITS.IMAGE_FINAL]: 20,
      [ENTITLEMENT_UNITS.VIDEO_SECONDS]: 120 // equivalent to 4x30s
    },
    limits: {
      brandKits: 3,
      savedProducts: 20,
      aspectRatios: ["1:1", "4:5", "9:16", "16:9"],
      priorityRendering: true
    },
    imagePreviewResolution: "low-resolution (watermarked)",
    imageFinalExportResolution: "1080p",
    videoPreviewSeconds: 3,
    videoFinalExportResolution: "1080p (when supported by the configured provider)",
    languages: ["english", "filipino", "taglish"],
    featured: true,
    badge: "Best Value",
    visible: true,
    sortOrder: 3,
    features: [
      "20 final image ads per billing cycle",
      "4 full 30-second videos per billing cycle (120 finished video seconds)",
      "Low-resolution image previews",
      "3-second video teaser previews",
      "Hooks, scripts, captions, CTAs, layouts, creator and setting choices",
      "Up to 3 saved brand kits",
      "Up to 20 saved products",
      "Multiple aspect ratios",
      "Priority rendering",
      "Commercial-use exports, subject to platform terms"
    ]
  }
];

// Combo savings math (PART 3) — computed, not hand-typed, so it can never
// drift from the actual plan prices above.
function computeComboSavings() {
  const imageStarter = PLANS.find((p) => p.slug === "image_starter");
  const videoStarter = PLANS.find((p) => p.slug === "video_starter");
  const combo = PLANS.find((p) => p.slug === "brandee_combo");

  const equivalentImageValue = imageStarter.monthlyPrice * 2; // 2x Image Starter = combo's image allowance (20 vs 10x2)
  const equivalentVideoValue = videoStarter.monthlyPrice * 2; // 2x Video Starter = combo's video allowance (120 vs 60x2)
  const combinedEquivalentValue = equivalentImageValue + equivalentVideoValue;
  const monthlySavings = combinedEquivalentValue - combo.monthlyPrice;
  const approxSavingsPercent = Math.round((monthlySavings / combinedEquivalentValue) * 1000) / 10;

  return {
    equivalentImageStarterCount: 2,
    equivalentImageValue,
    equivalentVideoStarterCount: 2,
    equivalentVideoValue,
    combinedEquivalentValue,
    comboPrice: combo.monthlyPrice,
    monthlySavings,
    approxSavingsPercent,
    note: `Save ₱${monthlySavings} compared with equivalent Starter allowances.`
  };
}

/**
 * Derives the VATable-sale / VAT / total breakdown for a given total price,
 * for either tax mode. In NON_VAT mode there is no VAT line at all — the
 * total IS the price. In VAT mode (not currently active), the SAME published
 * total is treated as tax-inclusive and VAT is backed out of it, so turning
 * VAT mode on never silently raises what a customer pays.
 */
function computeTaxBreakdown(totalPrice, taxConfig = DEFAULT_TAX_CONFIG) {
  const total = Number(totalPrice);
  if (taxConfig.taxMode === "NON_VAT") {
    return { taxMode: "NON_VAT", vatableSale: null, vat: null, total, label: "Non-VAT transaction" };
  }
  const rate = Number(taxConfig.vatRatePercent) / 100;
  const vatableSale = Math.round((total / (1 + rate)) * 100) / 100;
  const vat = Math.round((total - vatableSale) * 100) / 100;
  return { taxMode: "VAT", vatableSale, vat, total, label: "VAT-inclusive transaction" };
}

const PRICING_NOTE = "Prices shown are the total monthly subscription prices. AIStaff Solutions Corporation is currently non-VAT registered.";

// Anonymous (pre-registration) preview limits — enforced server-side
// regardless of what a client sends. One preview per kind per anonymous
// session, matching PART 13's "Anonymous access: one image preview or one
// 3-second video preview".
const ANONYMOUS_LIMITS = {
  imagePreviewsPerSession: 1,
  videoPreviewsPerSession: 1,
  // PART 18: one free revision for an anonymous visitor, on top of their one
  // free initial preview — registering unlocks further revisions according
  // to plan rules (registered-but-unsubscribed still gets a small allowance;
  // see requireBrandeeSubscription()/entitlements.js for the paid tier).
  imageRevisionsPerSession: 1,
  videoRevisionsPerSession: 1
};

function getPlan(slug) {
  return PLANS.find((plan) => plan.slug === slug) || null;
}

function listPlans() {
  return [...PLANS].sort((a, b) => a.sortOrder - b.sortOrder);
}

function getEntitlementsForPlan(slug) {
  const plan = getPlan(slug);
  if (!plan) return null;
  return plan.entitlements;
}

module.exports = {
  TAX_MODES,
  ENTITLEMENT_UNITS,
  BRANDEE_PRODUCT_SLUG,
  BRANDEE_PRODUCT_NAME,
  DEFAULT_TAX_CONFIG,
  PRICING_QUANTITIES_ARE_PLACEHOLDERS,
  PRICING_NOTE,
  PLANS,
  ANONYMOUS_LIMITS,
  getPlan,
  listPlans,
  getEntitlementsForPlan,
  computeComboSavings,
  computeTaxBreakdown
};
