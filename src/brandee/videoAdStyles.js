// Video-ad style library for the Brandee product-ad MVP (PART 11).

const VIDEO_AD_STYLES = [
  {
    id: "ugc_recommendation",
    name: "UGC Product Recommendation",
    description: "A creator talks directly to camera recommending the product, like a genuine personal recommendation.",
    bestUse: "Products that benefit from a trusted, personal-feeling endorsement.",
    poster: "/agents/brandee/assets/styles/ugc-recommendation.svg",
    suggestedLengthSeconds: 30,
    requiredInputs: ["hookPreference", "creatorType", "setting"]
  },
  {
    id: "product_demo",
    name: "Product Demonstration",
    description: "Shows the product being used, step by step, so viewers see exactly how it works.",
    bestUse: "Products where seeing it in action builds confidence to buy.",
    poster: "/agents/brandee/assets/styles/product-demo.svg",
    suggestedLengthSeconds: 25,
    requiredInputs: ["hookPreference", "setting"]
  },
  {
    id: "problem_solution",
    name: "Problem and Solution",
    description: "Opens on a relatable problem, then shows the product solving it.",
    bestUse: "Products that solve a specific everyday frustration.",
    poster: "/agents/brandee/assets/styles/problem-solution.svg",
    suggestedLengthSeconds: 25,
    requiredInputs: ["hookPreference", "creatorType"]
  },
  {
    id: "offer_promo",
    name: "Offer Promo",
    description: "Leads with a real offer or discount and a clear reason to act now.",
    bestUse: "Sales, discounts, or limited-time promotions.",
    poster: "/agents/brandee/assets/styles/offer-promo.svg",
    suggestedLengthSeconds: 20,
    requiredInputs: ["hookPreference"]
  },
  {
    id: "unboxing",
    name: "Unboxing",
    description: "First-look, opening-the-package style reveal of the product.",
    bestUse: "Physical products with satisfying packaging or a strong first impression.",
    poster: "/agents/brandee/assets/styles/unboxing.svg",
    suggestedLengthSeconds: 20,
    requiredInputs: ["creatorType", "setting"]
  },
  {
    id: "product_showcase",
    name: "Product Showcase",
    description: "Cinematic, product-only shots with minimal talking — style and detail focused.",
    bestUse: "Visually distinctive products that look great on camera.",
    poster: "/agents/brandee/assets/styles/product-showcase.svg",
    suggestedLengthSeconds: 15,
    requiredInputs: ["setting"]
  },
  {
    id: "founder_expert_style",
    name: "Founder or Expert Style",
    description: "A founder- or expert-style spokesperson speaks directly to camera about the product.",
    bestUse: "Brands that want a credible, personal voice behind the product.",
    poster: "/agents/brandee/assets/styles/founder-expert-style.svg",
    suggestedLengthSeconds: 30,
    requiredInputs: ["hookPreference", "creatorType", "setting"]
  },
  {
    id: "voiceover_product_ad",
    name: "Voiceover Product Ad",
    description: "A narrated voiceover plays over product visuals — no on-camera creator required.",
    bestUse: "Products where a clean, narrated visual sequence works better than a talking-head creator.",
    poster: "/agents/brandee/assets/styles/voiceover-product-ad.svg",
    suggestedLengthSeconds: 20,
    requiredInputs: ["hookPreference", "voicePreference"]
  }
];

const HOOK_PREFERENCES = ["curiosity", "problem", "question", "direct", "story", "offer"];
const TONES = ["casual", "professional", "energetic", "warm", "playful"];
const CREATOR_TYPES = ["customer_style", "presenter", "business_representative", "product_demonstrator", "narrator", "founder_style_spokesperson"];
const SETTINGS = ["home", "studio", "office", "outdoor", "store_or_shop", "let_brandee_choose"];

function getVideoAdStyle(id) {
  return VIDEO_AD_STYLES.find((s) => s.id === id) || null;
}

function listVideoAdStyles() {
  return VIDEO_AD_STYLES;
}

module.exports = {
  VIDEO_AD_STYLES,
  HOOK_PREFERENCES,
  TONES,
  CREATOR_TYPES,
  SETTINGS,
  getVideoAdStyle,
  listVideoAdStyles
};
