// Brandee Deterministic Decision Engine.
//
// Runs BEFORE the creative planner and owns every proof-safety / eligibility
// rule (which goals, frameworks, and hooks are allowed for THIS business).
// The planner (planner.js) consumes the DecisionConstraints object this
// module produces instead of re-deriving proof-safety rules inline, so there
// is exactly one place that decides "is X allowed for this business" — this
// file. Nothing here silently changes the customer's SELECTED goal; it may
// only recommend a different one, with an explanation, leaving the final
// choice to the customer/owner via acceptedGoalOverride.
//
// Pure, data-driven, and business-agnostic: every input comes from the
// extracted BusinessProfile + submitted form. No company name, domain, or
// industry special-casing of any kind — the owner's real business runs
// through exactly these same rules as any other customer's.

const { STATIC_AD_FRAMEWORKS, candidateFrameworks } = require("./frameworks");
const { HOOK_CATEGORIES, candidateHooks } = require("./hooks");
const { getGoalMapping, correctGoal } = require("./goalMappings");
const { classifyAwareness } = require("./awareness");
const { BrandeeError } = require("./errors");

/**
 * Which proof types does this business actually have evidence for? Facts
 * only — never inferred/invented. Consumed by both framework and hook
 * eligibility filtering below.
 */
function computeAvailableProofTypes({ businessAnalysis, form }) {
  const proof = businessAnalysis?.proof || {};
  const types = new Set();
  if (proof.yearsInBusiness || (businessAnalysis?.differentiators || []).length) types.add("years_in_business_or_expertise");
  if (proof.yearsInBusiness) types.add("years_in_business");
  if (proof.customerCount) types.add("customer_count");
  if (proof.customerCount || proof.reviewCount || proof.rating) types.add("customer_count_or_review_count_or_rating");
  if (proof.reviewCount) types.add("review_count");
  if (proof.rating) types.add("rating");
  if ((businessAnalysis?.differentiators || []).length) types.add("verifiable_difference");
  if ((proof.testimonials || []).length) types.add("verified_testimonial");
  if ((businessAnalysis?.primaryProblemsSolved || []).length) types.add("truthful_transformation");

  const offerText = [form?.offer, ...(businessAnalysis?.offers || [])].filter(Boolean).join(" ");
  if (offerText.trim()) types.add("real_offer");
  if (/\b(limited time|until\s|ends\s|deadline|only \d+ (slots|units|left))\b/i.test(offerText)) {
    types.add("real_deadline");
    types.add("real_deadline_or_scarcity");
  }
  return types;
}

/** Human-readable list of claim types Brandee must NOT make for this business. */
function buildRestrictedClaims(availableProofTypes) {
  const restricted = [];
  if (!availableProofTypes.has("verified_testimonial")) restricted.push("Customer testimonials (none verified — do not fabricate a quote or name)");
  if (!availableProofTypes.has("customer_count")) restricted.push("Customer count claims (no verified number)");
  if (!availableProofTypes.has("review_count")) restricted.push("Review count claims (no verified number)");
  if (!availableProofTypes.has("rating")) restricted.push("Star rating claims (no verified rating)");
  if (!availableProofTypes.has("years_in_business")) restricted.push("\"X years in business\" claims (not confirmed)");
  if (!availableProofTypes.has("real_deadline")) restricted.push("Urgency/deadline claims (no confirmed offer end date)");
  restricted.push("\"The only one that works\" or other absolute, unverifiable claims");
  return restricted;
}

function aspectRatioForPlatform(platform) {
  if (platform === "website") return "16:9";
  if (platform === "multiple") return "9:16 (primary), 1:1 (secondary)";
  return "9:16";
}

/**
 * Builds the DecisionConstraints object that gates every downstream creative
 * choice. Pure function of businessAnalysis + form — no network, no AI, no
 * hard-coded business/company data. Throws BrandeeError(BRANDEE_RULES_NOT_LOADED)
 * if the approved playbook data itself failed to load (see creativeBrain
 * validators for the resource-integrity check proper; this is a defensive
 * guard for missing inputs to this function specifically).
 */
function buildDecisionConstraints({ businessAnalysis, form } = {}) {
  if (!businessAnalysis || !form) {
    throw new BrandeeError("BRANDEE_RULES_NOT_LOADED", {
      internalMessage: "buildDecisionConstraints called without businessAnalysis/form"
    });
  }

  const selectedGoal = form.selectedGoal;
  const { recommendedGoal, goalChanged, explanation: goalExplanation } = correctGoal({ selectedGoal, businessAnalysis });
  const candidateRecommendedGoals = goalChanged && recommendedGoal !== selectedGoal
    ? [recommendedGoal, selectedGoal]
    : [selectedGoal];

  // Never silently overrides the customer's selection — only takes effect
  // once accepted (acceptedGoalOverride) or, absent that, the deterministic
  // plan still previews under the recommended goal while `goalChanged` tells
  // the UI to offer the customer a choice.
  const effectiveGoal = form.acceptedGoalOverride || (goalChanged ? recommendedGoal : selectedGoal);

  const awareness = classifyAwareness({ businessAnalysis, goal: effectiveGoal, audienceSource: form.audienceSource || "unknown" });
  const candidateAwarenessLevels = [awareness.level];

  const availableProofTypes = computeAvailableProofTypes({ businessAnalysis, form });

  const allowedFrameworks = candidateFrameworks({ availableProofTypes: [...availableProofTypes] });
  const allowedFrameworkIds = allowedFrameworks.map((f) => f.id);
  const allowedFrameworkIdSet = new Set(allowedFrameworkIds);
  const blockedFrameworks = STATIC_AD_FRAMEWORKS
    .filter((f) => !allowedFrameworkIdSet.has(f.id))
    .map((f) => ({
      id: f.id,
      reason: `Missing required proof: ${f.requiredProof.filter((p) => !availableProofTypes.has(p)).join(", ") || "unspecified"}`
    }));

  const allowedHooks = candidateHooks({ availableProofTypes: [...availableProofTypes] });
  const allowedHookTemplateIds = allowedHooks.map((h) => h.id);
  const allowedHookCategorySet = new Set(allowedHooks.map((h) => h.category));
  const allowedHookCategories = [...allowedHookCategorySet];
  const blockedHookCategories = HOOK_CATEGORIES
    .filter((c) => !allowedHookCategorySet.has(c))
    .map((c) => ({
      category: c,
      reason: "No hook template in this category has its required proof available for this business."
    }));

  const proofRestrictions = buildRestrictedClaims(availableProofTypes);
  const goalMapping = getGoalMapping(effectiveGoal);
  const CTAOptions = goalMapping?.ctaExamples || [];
  const creativeFormatCandidates = ["ugc_video", "static_ad"];
  const platformConstraints = {
    platform: form.platform,
    aspectRatio: aspectRatioForPlatform(form.platform)
  };

  return {
    selectedGoal,
    recommendedGoal,
    effectiveGoal,
    goalChanged,
    goalExplanation,
    candidateRecommendedGoals,
    candidateAwarenessLevels,
    awareness,
    allowedFrameworkIds,
    blockedFrameworks,
    allowedHookCategories,
    blockedHookCategories,
    allowedHookTemplateIds,
    proofRestrictions,
    CTAOptions,
    creativeFormatCandidates,
    platformConstraints,
    availableProofTypes: [...availableProofTypes]
  };
}

// ---------------------------------------------------------------------------
// PART 20 — framework/angle/hook consistency validation. Proof ELIGIBILITY
// is already enforced earlier (candidateFrameworks/candidateHooks, above) —
// this is a second, final check that the ACTUAL chosen headline/copy is
// internally consistent with the framework it claims to use (e.g. a
// "question" framework whose headline isn't actually phrased as a
// question). Returns { aligned, reasons[] } rather than throwing directly,
// so the caller (planner.js) can choose to pick a different framework
// before giving up and throwing BRANDEE_FRAMEWORK_ALIGNMENT_FAILED.
// ---------------------------------------------------------------------------

function validateFrameworkAlignment({ framework, headline, businessAnalysis }) {
  const reasons = [];
  if (!framework || !headline) {
    return { aligned: false, reasons: ["Missing framework or headline to validate."] };
  }

  if (framework.id === "question" && !headline.trim().endsWith("?")) {
    reasons.push("Question framework requires the headline to actually be phrased as a question.");
  }
  if (framework.id === "testimonial" && !(businessAnalysis?.proof?.testimonials || []).length) {
    reasons.push("Testimonial framework requires at least one verified testimonial.");
  }
  if (framework.id === "offer" && !(businessAnalysis?.offers || []).length) {
    reasons.push("Offer framework requires a real, verified offer.");
  }
  if (framework.id === "before-and-after" && !(businessAnalysis?.primaryProblemsSolved || []).length) {
    reasons.push("Before-and-after framework requires a real, describable transformation.");
  }
  if (framework.id === "us-vs-them" && !(businessAnalysis?.differentiators || []).length) {
    reasons.push("Us vs. Them framework requires at least one verifiable differentiator.");
  }
  if (framework.id === "bold-claim" && /\b(guaranteed|100%|never fails|always works)\b/i.test(headline)) {
    reasons.push("Bold Claim framework headline contains an unsupported absolute promise.");
  }

  return { aligned: reasons.length === 0, reasons };
}

module.exports = {
  computeAvailableProofTypes,
  buildRestrictedClaims,
  aspectRatioForPlatform,
  buildDecisionConstraints,
  validateFrameworkAlignment
};
