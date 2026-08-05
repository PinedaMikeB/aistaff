// Brandee Creative Plan generation.
//
// Design: the STRUCTURE of every plan (goal correction, awareness level,
// framework choice, hook selection, hook scores, proof accounting) is always
// computed deterministically in this file from the approved playbook data
// (frameworks.js, hooks.js, goalMappings.js, awareness.js) and the actual
// business profile built by businessProfileBuilder.js. This guarantees a
// valid, proof-safe plan even with no AI provider configured or available.
//
// The AI provider (OpenAI/Gemini, same env vars as src/ai.js) is used only
// as an optional enhancement pass to (a) localize/polish dialogue and hook
// phrasing in the requested language, and (b) write more natural prose
// explanations — never to invent frameworks, hooks, scores, or proof. Its
// output is validated before anything from it is used, and any failure
// silently falls back to the deterministic plan.
//
// This version wires in the deep-understanding reliability upgrade:
// independent hook scoring + hard safety gates (hookScoring.js), materially
// distinct creative angles (angleDiversity.js), a final copy-quality pass
// (copyQuality.js) that specifically catches the previous "authoring
// instruction leaked into the customer-facing caption" bug, and a real
// UGCScene model with duration/word-count validation (ugcScript.js).

const crypto = require("node:crypto");
const { randomUUID } = crypto;

const { getFrameworkById, STATIC_AD_FRAMEWORKS } = require("./frameworks");
const { HOOK_TEMPLATES, candidateHooks, fillHookTemplate } = require("./hooks");
const { getGoalMapping } = require("./goalMappings");
const { BrandeeCreativePlanSchema } = require("./schemas");
const {
  computeAvailableProofTypes,
  buildRestrictedClaims,
  aspectRatioForPlatform,
  buildDecisionConstraints,
  validateFrameworkAlignment
} = require("./decisionEngine");
const { BrandeeError, toBrandeeError } = require("./errors");
const { getPlannerConfig, isReasoningModel } = require("./modelConfig");
const { scoreHookIndependently } = require("./hookScoring");
const { buildDistinctAngles } = require("./angleDiversity");
const { normalizeRawPhrase, validatePlanCopyQuality } = require("./copyQuality");
const { buildUgcScenes, validateScenes, validateCtaAlignment } = require("./ugcScript");

const fetchImpl = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

// ---------------------------------------------------------------------------
// Evidence assembly for the FINAL PLAN's proof.available list (flat
// EvidenceItem shape — see schemas.js comment on why this differs from the
// richer BusinessProfile EvidenceSchema).
// ---------------------------------------------------------------------------

function buildEvidenceList({ businessAnalysis, form }) {
  const evidence = [];
  const proof = businessAnalysis?.proof || {};
  if (businessAnalysis?.businessName) {
    evidence.push({ claim: `Business name: ${businessAnalysis.businessName}`, source: "website", sourceUrl: businessAnalysis.sourceUrl, confidence: businessAnalysis.businessNameConfidence || 0.5 });
  }
  (businessAnalysis?.productsOrServices || []).forEach((p) => {
    evidence.push({ claim: `Offers: ${p.name}`, source: "website", sourceUrl: (p.sourceUrls || [])[0] || businessAnalysis.sourceUrl, confidence: p.confidence || 0.5 });
  });
  // contactMethods is now an ExtractedContact[] ({type, value, sourceUrl}),
  // not a flat string[] — the previous implementation would have rendered
  // "[object Object]" here once the schema changed; fixed by reading the
  // structured fields directly.
  (businessAnalysis?.contactMethods || []).forEach((c) => {
    evidence.push({ claim: `Contact method (${c.type}): ${c.value}`, source: "website", sourceUrl: c.sourceUrl || businessAnalysis.sourceUrl, confidence: 0.8 });
  });
  if (proof.yearsInBusiness?.value) evidence.push({ claim: `${proof.yearsInBusiness.value} years in business`, source: "website", sourceUrl: proof.yearsInBusiness.sourceUrl || businessAnalysis.sourceUrl, confidence: 0.6 });
  if (proof.reviewCount?.value) evidence.push({ claim: `${proof.reviewCount.value} reviews mentioned`, source: "website", sourceUrl: proof.reviewCount.sourceUrl || businessAnalysis.sourceUrl, confidence: 0.5 });
  if (proof.rating?.value) evidence.push({ claim: `${proof.rating.value}-star rating mentioned`, source: "website", sourceUrl: proof.rating.sourceUrl || businessAnalysis.sourceUrl, confidence: 0.5 });
  (proof.testimonials || []).forEach((t) => {
    evidence.push({ claim: `Testimonial: "${t.quote}"`, source: "website", sourceUrl: t.sourceUrl || businessAnalysis.sourceUrl, sourceExcerpt: t.quote, confidence: 0.7 });
  });
  if (form?.whatYouSell) evidence.push({ claim: `What you sell: ${form.whatYouSell}`, source: "user", confidence: 0.9 });
  if (form?.idealCustomer) evidence.push({ claim: `Ideal customer: ${form.idealCustomer}`, source: "user", confidence: 0.9 });
  if (form?.offer) evidence.push({ claim: `Offer: ${form.offer}`, source: "user", confidence: 0.9 });
  if (form?.differentiator) evidence.push({ claim: `Differentiator: ${form.differentiator}`, source: "user", confidence: 0.9 });
  return evidence;
}

// ---------------------------------------------------------------------------
// Hook variable filling — factual variables only from real data; everything
// else gets a safe, generic (non-factual) filler so templates read
// naturally without inventing specifics. Every RAW user-supplied string is
// normalized first (PART 22 fix — see copyQuality.js normalizeRawPhrase for
// the "business owner, companies" -> "business owners and companies" fix).
// ---------------------------------------------------------------------------

const RESULT_PHRASE_BY_GOAL = {
  purchase: "get exactly what you need",
  messages: "get a fast recommendation",
  booking: "get booked in",
  signup: "get signed up in minutes",
  visit: "find exactly what you need",
  discover: "see what's new",
  recover: "finish your order"
};

const ACTION_PHRASE_BY_GOAL = {
  purchase: "buy today",
  messages: "send a message",
  booking: "book your slot",
  signup: "sign up",
  visit: "visit today",
  discover: "check it out",
  recover: "finish your order"
};

function buildHookValues({ businessAnalysis, form, goal }) {
  const proof = businessAnalysis?.proof || {};
  const goalMapping = getGoalMapping(goal);
  const whatYouSell = normalizeRawPhrase(form?.whatYouSell);
  const idealCustomer = normalizeRawPhrase(form?.idealCustomer);
  const differentiator = normalizeRawPhrase(form?.differentiator);
  const topic = whatYouSell || businessAnalysis?.industry || businessAnalysis?.businessName || "your business";
  return {
    topic,
    activity: whatYouSell || topic,
    solution: businessAnalysis?.businessName || whatYouSell || "this",
    problem: businessAnalysis?.primaryProblemsSolved?.[0] || `dealing with ${whatYouSell || "this"} the hard way`,
    result: RESULT_PHRASE_BY_GOAL[goal] || businessAnalysis?.functionalBenefits?.[0] || businessAnalysis?.primaryBenefits?.[0] || goalMapping?.label || "the result you want",
    expense: whatYouSell || "the usual way",
    years: proof.yearsInBusiness?.value || undefined,
    customer_count: proof.customerCount?.value || undefined,
    customer_type: idealCustomer || "customers like you",
    solution_type: whatYouSell || "solution",
    product_type: whatYouSell || "offer",
    time_period: "a few days",
    offer: differentiator ? undefined : (form?.offer ? normalizeRawPhrase(form.offer) : businessAnalysis?.offers?.[0] || undefined),
    opportunity: (form?.offer && normalizeRawPhrase(form.offer)) || whatYouSell || "this",
    action: ACTION_PHRASE_BY_GOAL[goal] || goalMapping?.ctaExamples?.[0]?.toLowerCase() || "get started",
    audience: idealCustomer || "your customers",
    alternative: "a simpler option",
    undesired_effort: "the extra hassle",
    change: "your options run out"
  };
}

// ---------------------------------------------------------------------------
// Hook scoring — now delegates to hookScoring.js (independent per-dimension
// scoring + hard safety gates) instead of the old flat 8-dimension scorer.
// Rejected hooks are RETAINED (not dropped) for Super Admin diagnostics —
// see `rejectedHookScores` on the plan.
// ---------------------------------------------------------------------------

function rankedHookScores({ goal, awareness, businessAnalysis, form, platform, allowedHookTemplateIds, limit = 6 }) {
  const availableProofTypes = computeAvailableProofTypes({ businessAnalysis, form });
  const candidates = allowedHookTemplateIds
    ? HOOK_TEMPLATES.filter((h) => allowedHookTemplateIds.includes(h.id))
    : candidateHooks({ availableProofTypes: [...availableProofTypes] });
  const values = buildHookValues({ businessAnalysis, form, goal });

  const hasVerifiedYearsInBusiness = Boolean(businessAnalysis?.proof?.yearsInBusiness?.value);
  const hasVerifiedDeadline = availableProofTypes.has("real_deadline");

  const filledTexts = [];
  const scored = candidates.map((hookTemplate) => {
    const filledText = fillHookTemplate(hookTemplate.template, values);
    const hasRequiredProof = hookTemplate.requiredProof.every((p) => availableProofTypes.has(p));
    const scoreResult = scoreHookIndependently({
      hookTemplate,
      filledText,
      goal,
      awareness,
      platform,
      hasRequiredProof,
      hasVerifiedYearsInBusiness,
      hasVerifiedDeadline,
      values,
      siblingTexts: filledTexts
    });
    filledTexts.push(filledText);
    return scoreResult;
  });

  scored.sort((a, b) => b.total - a.total);
  const approved = scored.filter((s) => s.status !== "rejected");
  const rejected = scored.filter((s) => s.status === "rejected");
  return { approved: approved.slice(0, limit), rejected, allScored: scored };
}

// ---------------------------------------------------------------------------
// Three distinct marketing angles — category diversity (existing logic)
// PLUS problem/outcome/message diversity via angleDiversity.js (PART 17 fix).
// ---------------------------------------------------------------------------

function buildAngles({ goal, awareness, businessAnalysis, form, platform, allowedHookTemplateIds }) {
  const { allScored } = rankedHookScores({ goal, awareness, businessAnalysis, form, platform, allowedHookTemplateIds, limit: HOOK_TEMPLATES.length });
  const approvedScored = allScored.filter((s) => s.status !== "rejected");
  const bestPerCategory = new Map();
  for (const hs of approvedScored) {
    const current = bestPerCategory.get(hs.category);
    if (!current || current.total < hs.total) bestPerCategory.set(hs.category, hs);
  }
  const distinctCategoryHooks = [...bestPerCategory.values()].sort((a, b) => b.total - a.total).slice(0, 3);

  const { angles, similarityWarnings } = buildDistinctAngles({
    hookCandidates: distinctCategoryHooks,
    businessAnalysis,
    form,
    goal,
    awarenessLevel: awareness
  });

  return { angles, similarityWarnings };
}

// ---------------------------------------------------------------------------
// UGC script — delegates to ugcScript.js. No more inline authoring
// instructions leaking into the caption (PART 21/23 fix); localization notes
// go into `warnings` instead, visible internally, never printed as if it
// were part of the ad copy.
// ---------------------------------------------------------------------------

function buildScript({ primaryHookText, goal, businessAnalysis, form, language, angle }) {
  const goalMapping = getGoalMapping(goal);
  const cta = form?.offer
    ? `${goalMapping.ctaExamples[0]} — ${normalizeRawPhrase(form.offer)}`
    : goalMapping.ctaExamples[0];

  const scenes = buildUgcScenes({ primaryHookText, goal, ctaText: cta, businessAnalysis, form, language, angle });
  const sceneIssues = validateScenes(scenes, { language });
  const ctaAlignment = validateCtaAlignment(scenes, goalMapping);

  const warnings = [];
  if (language !== "english") {
    warnings.push(`This script was generated in English scaffolding and should be reviewed for natural ${language === "taglish" ? "Taglish" : "Filipino"} phrasing before publishing (automatic translation was not applied in the deterministic pass).`);
  }
  for (const problem of sceneIssues) {
    warnings.push(`Scene ${problem.sceneNumber}: ${problem.issues.join("; ")}`);
  }
  if (!ctaAlignment.ok) warnings.push(...ctaAlignment.issues);

  return {
    language,
    durationSeconds: scenes.reduce((sum, s) => sum + s.durationSeconds, 0),
    scenes,
    warnings
  };
}

// ---------------------------------------------------------------------------
// Static-ad concept — enriched per PART 25 (subheadline, verified benefit,
// differentiator, asset requirements, prohibited claims, aspect ratios) and
// validated for framework/headline alignment (PART 20) before being
// accepted; falls back to the next candidate framework if misaligned.
// ---------------------------------------------------------------------------

function buildStaticAdConcept({ frameworkCandidates, primaryHookText, businessAnalysis, form, goal, platform, proofRestrictions }) {
  const goalMapping = getGoalMapping(goal);
  const differentiator = (businessAnalysis?.differentiators || [])[0] || (form?.differentiator ? normalizeRawPhrase(form.differentiator) : null);
  const verifiedBenefit = (businessAnalysis?.functionalBenefits || businessAnalysis?.primaryBenefits || [])[0] || null;

  let chosenFramework = frameworkCandidates[0];
  let alignment = { aligned: true, reasons: [] };
  for (const candidate of frameworkCandidates) {
    const headline = primaryHookText;
    const result = validateFrameworkAlignment({ framework: candidate, headline, businessAnalysis });
    if (result.aligned) {
      chosenFramework = candidate;
      alignment = result;
      break;
    }
    alignment = result; // keep the last-tried reasons in case none align
  }

  const supportingCopy = [verifiedBenefit, differentiator].filter(Boolean).slice(0, 3);

  return {
    framework: chosenFramework.name,
    headline: primaryHookText,
    subheadline: differentiator || null,
    supportingCopy: supportingCopy.length ? supportingCopy : ["Benefit copy pending — add a differentiator or offer to strengthen this."],
    verifiedBenefit,
    differentiator,
    visualLayout: chosenFramework.layoutRules.join(" "),
    layoutDirection: chosenFramework.layoutRules.join(" "),
    assetRequirements: [platform === "website" ? "16:9 hero image" : "9:16 vertical creative", "Legible on mobile at thumbnail size"],
    proofUsed: [],
    prohibitedClaims: proofRestrictions || [],
    aspectRatios: [aspectRatioForPlatform(platform)],
    callToAction: form?.offer ? `${goalMapping.ctaExamples[0]} — ${normalizeRawPhrase(form.offer)}` : goalMapping.ctaExamples[0],
    _frameworkAlignment: alignment
  };
}

function buildCreatorRecommendation({ form, businessAnalysis, awareness }) {
  const persona = form?.language === "taglish" || form?.language === "filipino"
    ? "Filipino creator, relatable and conversational"
    : "Creator matching your target audience's everyday look";
  const setting = businessAnalysis?.businessType === "service"
    ? "Everyday office/service setting relevant to the business"
    : "Natural home or lifestyle setting where the product is used";
  const deliveryStyle = ["unaware", "problem_aware"].includes(awareness)
    ? "Warm, conversational, low-pressure"
    : "Confident, direct, benefit-forward";
  // PART 24 — distinguish creator TYPE so an authority-style script never
  // gets paired with a generic avatar implying personal use it never had.
  const creatorType = businessAnalysis?.businessType === "service" ? "business_representative" : "product_demonstrator";

  return {
    persona,
    ageRange: null,
    setting,
    deliveryStyle,
    voiceStyle: "Friendly and sincere",
    creatorType,
    explanation: `Designed to preserve creator consistency and match ${form?.idealCustomer ? normalizeRawPhrase(form.idealCustomer) : "your audience"} — matched to a ${deliveryStyle.toLowerCase()} delivery for a ${awareness.replace("_", " ")} audience. This creator should be framed as a ${creatorType.replace("_", " ")}, not implied to be a real past customer unless one is authorized.`
  };
}

// ---------------------------------------------------------------------------
// Recommendation rationale (PART 26) — plain-language explanation of every
// major decision, without exposing internal prompt mechanics.
// ---------------------------------------------------------------------------

function buildRecommendationRationale({ decisionConstraints, chosenAngle, staticAdConcept, businessAnalysis }) {
  return {
    whyThisGoal: decisionConstraints.goalExplanation,
    whyThisAwareness: decisionConstraints.awareness.explanation,
    whyThisAngle: chosenAngle ? `Focuses on "${chosenAngle.customerProblem}" leading to "${chosenAngle.desiredOutcome}", using a ${chosenAngle.category.replace("_", " ")} hook.` : "",
    whyThisFramework: staticAdConcept._frameworkAlignment?.aligned
      ? `The ${staticAdConcept.framework} framework fit the verified proof available for this business.`
      : `The ${staticAdConcept.framework} framework was used with caution: ${staticAdConcept._frameworkAlignment?.reasons?.join(" ") || ""}`,
    whyThisFormat: "UGC video plus a static-ad variant were chosen to cover both scroll-stopping motion and quick-scan placements.",
    proofSupporting: (businessAnalysis?.evidence || []).filter((e) => e.sourceType !== "inference").slice(0, 5).map((e) => e.statement),
    proofMissing: businessAnalysis?.missingInformation || [],
    blockedFrameworksExplained: (decisionConstraints.blockedFrameworks || []).map((f) => `${f.id}: ${f.reason}`),
    whatIsBeingTested: "The angles above test different customer problems/outcomes against each other — keep whichever gets more replies, saves, or conversions and retire the rest."
  };
}

// ---------------------------------------------------------------------------
// Deterministic full plan
// ---------------------------------------------------------------------------

function orderByPreference(items, preferredOrder) {
  const rank = (id) => { const i = preferredOrder.indexOf(id); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
  return [...items].sort((a, b) => rank(a.id) - rank(b.id));
}

function buildDeterministicPlan({ businessAnalysis: rawBusinessAnalysis, form, planId }) {
  // Fold user-provided differentiator/offer into the analysis used for
  // classification/selection when the website itself didn't surface them —
  // both are legitimate "source: user" facts, not inventions.
  const businessAnalysis = {
    ...rawBusinessAnalysis,
    differentiators: rawBusinessAnalysis.differentiators?.length ? rawBusinessAnalysis.differentiators : (form.differentiator ? [normalizeRawPhrase(form.differentiator)] : []),
    offers: rawBusinessAnalysis.offers?.length ? rawBusinessAnalysis.offers : (form.offer ? [normalizeRawPhrase(form.offer)] : []),
    primaryProblemsSolved: rawBusinessAnalysis.primaryProblemsSolved?.length ? rawBusinessAnalysis.primaryProblemsSolved : []
  };

  const decisionConstraints = buildDecisionConstraints({ businessAnalysis, form });
  const { selectedGoal, recommendedGoal, goalChanged, goalExplanation, effectiveGoal, awareness, allowedFrameworkIds } = decisionConstraints;

  const frameworkCandidates = orderByPreference(
    allowedFrameworkIds.map((id) => getFrameworkById(id)).filter(Boolean),
    getGoalMapping(effectiveGoal)?.preferredFrameworks || []
  );
  const safeFrameworkCandidates = frameworkCandidates.length ? frameworkCandidates : [getFrameworkById("reasons-why")];

  const { approved: approvedHookScores, rejected: rejectedHookScores } = rankedHookScores({
    goal: effectiveGoal, awareness: awareness.level, businessAnalysis, form, platform: form.platform,
    allowedHookTemplateIds: decisionConstraints.allowedHookTemplateIds, limit: 6
  });
  const primary = approvedHookScores[0];
  const alternativesScored = approvedHookScores.slice(1, 4);

  const { angles, similarityWarnings } = buildAngles({ goal: effectiveGoal, awareness: awareness.level, businessAnalysis, form, platform: form.platform, allowedHookTemplateIds: decisionConstraints.allowedHookTemplateIds });
  const chosenAngle = angles[0] || null;

  const script = buildScript({ primaryHookText: primary?.hook || "Here's something worth knowing.", goal: effectiveGoal, businessAnalysis, form, language: form.language, angle: chosenAngle });
  const staticAdConcept = buildStaticAdConcept({ frameworkCandidates: safeFrameworkCandidates, primaryHookText: primary?.hook || script.scenes[0].dialogue, businessAnalysis, form, goal: effectiveGoal, platform: form.platform, proofRestrictions: decisionConstraints.proofRestrictions });
  const creatorRecommendation = buildCreatorRecommendation({ form, businessAnalysis, awareness: awareness.level });
  const recommendationRationale = buildRecommendationRationale({ decisionConstraints, chosenAngle, staticAdConcept, businessAnalysis });

  const warnings = [...(script.warnings || [])];
  if (!approvedHookScores.length) warnings.push("No approved hooks scored highly enough for this business yet — consider adding a differentiator or offer.");
  if ((businessAnalysis?.missingInformation || []).length) warnings.push(`Missing from the website: ${businessAnalysis.missingInformation.join(", ")}.`);
  if (businessAnalysis?.fetchStatus !== "ok") warnings.push("Brandee could not fully read this website automatically — this plan leans on the details you entered manually.");
  if (similarityWarnings.length) warnings.push("Some creative angles are more similar than ideal given the limited business information available — consider adding a differentiator or more page content.");
  if (rejectedHookScores.length) warnings.push(`${rejectedHookScores.length} candidate hook(s) were rejected by Brandee's proof-safety check and are not shown.`);

  const assumptions = [];
  if (!businessAnalysis?.industry) assumptions.push("Industry was not confirmed from the website — Brandee used what you sell instead.");
  if (!(businessAnalysis?.proof?.testimonials || []).length) assumptions.push("No verified testimonial was found, so the Testimonial framework and social-proof hooks were not used.");

  const plan = {
    planId,
    createdAt: new Date().toISOString(),
    sourceUrl: businessAnalysis.sourceUrl || form.url,
    businessSummary: {
      name: businessAnalysis.businessName || "Your business",
      businessType: businessAnalysis.businessType,
      industry: businessAnalysis.industry || form.whatYouSell,
      offer: (form.offer && normalizeRawPhrase(form.offer)) || businessAnalysis.offers?.[0] || "Not specified",
      targetAudience: normalizeRawPhrase(form.idealCustomer),
      primaryProblem: businessAnalysis.primaryProblemsSolved?.[0] || "Not confirmed from the website",
      primaryBenefit: businessAnalysis.functionalBenefits?.[0] || businessAnalysis.primaryBenefits?.[0] || (form.differentiator && normalizeRawPhrase(form.differentiator)) || "Not confirmed from the website",
      differentiators: businessAnalysis.differentiators?.length ? businessAnalysis.differentiators : (form.differentiator ? [normalizeRawPhrase(form.differentiator)] : [])
    },
    selectedGoal,
    recommendedGoal,
    goalChanged,
    goalExplanation,
    awareness,
    angles,
    strategy: {
      primaryAngle: chosenAngle?.name || "Primary angle",
      alternativeAngles: angles.slice(1).map((a) => a.name),
      staticAdFramework: { id: "pending", name: staticAdConcept.framework, explanation: safeFrameworkCandidates[0]?.description || "" },
      videoFormat: `${awareness.level.replace("_", "-")} UGC-style ${businessAnalysis.businessType === "service" ? "service" : "product"} video`,
      hookCategory: primary?.category || "question",
      hookTemplateId: primary?.templateId || "h081",
      primaryHook: primary?.hook || script.scenes[0].dialogue,
      alternativeHooks: alternativesScored.map((h) => h.hook),
      explanation: `Selected because it fits the "${getGoalMapping(effectiveGoal)?.label}" goal and a ${awareness.level.replace("_", " ")} audience, using only proof Brandee could verify.`
    },
    proof: {
      available: buildEvidenceList({ businessAnalysis, form }),
      missing: businessAnalysis.missingInformation || [],
      restrictedClaims: decisionConstraints.proofRestrictions
    },
    script,
    creatorRecommendation,
    production: {
      platform: form.platform,
      aspectRatio: aspectRatioForPlatform(form.platform),
      durationSeconds: script.durationSeconds,
      callToAction: staticAdConcept.callToAction,
      numberOfVariations: 3
    },
    staticAdConcept,
    hookScores: approvedHookScores,
    rejectedHookScores,
    recommendationRationale,
    businessProfileConfirmationRequired: Boolean(businessAnalysis.confirmationRequired),
    warnings,
    assumptions,
    generatedBy: "deterministic"
  };

  // Fix the staticAdFramework.id properly (framework.id not name-derived).
  const matchedFramework = safeFrameworkCandidates.find((f) => f.name === staticAdConcept.framework) || safeFrameworkCandidates[0];
  plan.strategy.staticAdFramework = { id: matchedFramework.id, name: matchedFramework.name, explanation: matchedFramework.description };

  // Internal-only field, never part of the schema — strip before validation.
  delete plan.staticAdConcept._frameworkAlignment;

  return { plan, angles, decisionConstraints };
}

// ---------------------------------------------------------------------------
// Optional AI enhancement pass — prose/dialogue polish only, never structure.
// ---------------------------------------------------------------------------

// See productAnalysisService.js's identical comment — reasoning-family
// models take real "thinking" time, measured well past the old ceiling.
const AI_TIMEOUT_MS = 45000;

function buildEnhancementPrompt({ plan, businessAnalysis, form }) {
  return [
    "You are Brandee, AIStaff's outcome-first AI marketing agent.",
    "Your first job is not to generate a video. Your first job is to determine what marketing content the business needs.",
    "You are given a Brandee Creative Plan that was already built deterministically from an approved static-ad framework library and an approved 100-hook library.",
    "You must NOT change the selected framework id, hook template ids, hook scores, or proof lists.",
    "You MAY rewrite prose fields to sound more natural and specific to this business, and localize dialogue into the requested language.",
    "You must never invent testimonials, review counts, ratings, customer counts, years in business, awards, certifications, guarantees, discounts, deadlines, or scarcity that are not already present in the plan's proof.available list.",
    "Never write meta-instructions, placeholders, or notes-to-self into any field — every field you return is shown directly to the customer as-is.",
    "",
    `Requested language: ${form.language}`,
    `Website summary (public content only): ${businessAnalysis.summary}`,
    `What they sell: ${form.whatYouSell}`,
    `Ideal customer: ${form.idealCustomer}`,
    "",
    "Current deterministic plan (JSON):",
    JSON.stringify({
      goalExplanation: plan.goalExplanation,
      awarenessExplanation: plan.awareness.explanation,
      strategyExplanation: plan.strategy.explanation,
      primaryHook: plan.strategy.primaryHook,
      alternativeHooks: plan.strategy.alternativeHooks,
      scenes: plan.script.scenes,
      staticAdHeadline: plan.staticAdConcept.headline,
      staticAdSupportingCopy: plan.staticAdConcept.supportingCopy
    }, null, 2),
    "",
    "Return ONLY a JSON object with this exact shape (no extra keys, no markdown fences):",
    "{",
    '  "goalExplanation": string,',
    '  "awarenessExplanation": string,',
    '  "strategyExplanation": string,',
    '  "primaryHook": string,',
    '  "alternativeHooks": string[],',
    '  "scenes": [{"sceneNumber": number, "dialogue": string, "caption": string}],',
    '  "staticAdHeadline": string,',
    '  "staticAdSupportingCopy": string[]',
    "}"
  ].join("\n");
}

async function callAiModel(prompt, { provider, model, apiKeyConfigured }) {
  if (provider === "openai" && apiKeyConfigured) {
    // Reasoning-family models (gpt-5.6-terra among them, confirmed against
    // the live API) reject a custom `temperature` outright and expect
    // `reasoning_effort` instead; standard models need the opposite.
    const reasoning = isReasoningModel(model);
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        ...(reasoning ? { reasoning_effort: "medium" } : { temperature: 0.4 })
      })
    });
    if (!response.ok) throw new Error(`OpenAI error ${response.status} (model: ${model})`);
    const json = await response.json();
    return json.choices?.[0]?.message?.content || "{}";
  }
  if (provider === "gemini" && apiKeyConfigured) {
    const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ contents: [{ parts: [{ text: `${prompt}\nReturn only valid JSON, no markdown fences.` }] }], generationConfig: { temperature: 0.4 } })
    });
    if (!response.ok) throw new Error(`Gemini error ${response.status} (model: ${model})`);
    const json = await response.json();
    return json.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
  }
  return null; // mock / not configured — caller keeps deterministic plan
}

async function callConfiguredAiProvider(prompt) {
  const config = getPlannerConfig();
  if (!config.model && config.provider !== "mock") return null;
  try {
    return await callAiModel(prompt, config);
  } catch (error) {
    if (config.fallbackModel) {
      return callAiModel(prompt, { ...config, model: config.fallbackModel });
    }
    throw error;
  }
}

function parseJsonLoose(text) {
  const cleaned = String(text || "").replace(/^```json\s*|```$/g, "").trim();
  return JSON.parse(cleaned);
}

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("AI enhancement timed out")), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Best-effort AI polish. Never throws — on any failure, returns the plan
 * unchanged. ALSO runs the deterministic copy-quality pass (PART 21) over
 * whatever comes back before accepting it, since an AI rewrite is exactly
 * the kind of place a stray "insert proof here" or grammar slip could sneak
 * back in — the same gate applies whether the text came from the
 * deterministic builder or the AI polish pass.
 */
async function enhancePlanWithAi(plan, { businessAnalysis, form }) {
  const prompt = buildEnhancementPrompt({ plan, businessAnalysis, form });
  let raw;
  try {
    raw = await withTimeout(callConfiguredAiProvider(prompt), AI_TIMEOUT_MS);
  } catch (error) {
    return { plan, aiUsed: false, aiError: error.message };
  }
  if (!raw) return { plan, aiUsed: false, aiError: null };

  let parsed;
  try {
    parsed = parseJsonLoose(raw);
  } catch {
    try {
      const repaired = await withTimeout(
        callConfiguredAiProvider(`${prompt}\n\nYour previous response was not valid JSON. Return ONLY valid JSON, nothing else.`),
        AI_TIMEOUT_MS
      );
      parsed = parseJsonLoose(repaired);
    } catch (error) {
      return { plan, aiUsed: false, aiError: `AI response could not be parsed: ${error.message}` };
    }
  }

  try {
    const merged = { ...plan };
    if (typeof parsed.goalExplanation === "string" && parsed.goalExplanation.trim()) merged.goalExplanation = parsed.goalExplanation.trim();
    merged.awareness = { ...plan.awareness, explanation: typeof parsed.awarenessExplanation === "string" && parsed.awarenessExplanation.trim() ? parsed.awarenessExplanation.trim() : plan.awareness.explanation };
    merged.strategy = {
      ...plan.strategy,
      explanation: typeof parsed.strategyExplanation === "string" && parsed.strategyExplanation.trim() ? parsed.strategyExplanation.trim() : plan.strategy.explanation,
      primaryHook: typeof parsed.primaryHook === "string" && parsed.primaryHook.trim() ? parsed.primaryHook.trim() : plan.strategy.primaryHook,
      alternativeHooks: Array.isArray(parsed.alternativeHooks) && parsed.alternativeHooks.length ? parsed.alternativeHooks.filter((h) => typeof h === "string") : plan.strategy.alternativeHooks
    };
    if (Array.isArray(parsed.scenes)) {
      merged.script = {
        ...plan.script,
        scenes: plan.script.scenes.map((scene) => {
          const match = parsed.scenes.find((s) => s.sceneNumber === scene.sceneNumber);
          if (!match) return scene;
          return {
            ...scene,
            dialogue: typeof match.dialogue === "string" && match.dialogue.trim() ? match.dialogue.trim() : scene.dialogue,
            caption: typeof match.caption === "string" && match.caption.trim() ? match.caption.trim() : scene.caption
          };
        })
      };
    }
    merged.staticAdConcept = {
      ...plan.staticAdConcept,
      headline: typeof parsed.staticAdHeadline === "string" && parsed.staticAdHeadline.trim() ? parsed.staticAdHeadline.trim() : plan.staticAdConcept.headline,
      supportingCopy: Array.isArray(parsed.staticAdSupportingCopy) && parsed.staticAdSupportingCopy.length ? parsed.staticAdSupportingCopy.filter((c) => typeof c === "string") : plan.staticAdConcept.supportingCopy
    };
    merged.generatedBy = "ai";

    // PART 21 — run the SAME copy-quality gate on AI-touched text. If the AI
    // pass introduced a grammar issue or leaked a placeholder, reject the AI
    // version wholesale and keep the deterministic plan rather than trying
    // to guess which fields are safe.
    const copyIssues = validatePlanCopyQuality(merged);
    if (copyIssues.length) {
      return { plan, aiUsed: false, aiError: `AI-enhanced plan failed the copy-quality check (${copyIssues.map((i) => i.field).join(", ")}), kept deterministic plan.` };
    }

    const validated = BrandeeCreativePlanSchema.safeParse(merged);
    if (!validated.success) return { plan, aiUsed: false, aiError: "AI-enhanced plan failed schema validation, kept deterministic plan." };
    return { plan: validated.data, aiUsed: true, aiError: null };
  } catch (error) {
    return { plan, aiUsed: false, aiError: error.message };
  }
}

/**
 * Full entry point: builds the deterministic plan, validates it (including
 * the PART 21 copy-quality pass), then attempts a best-effort AI polish
 * pass. Always returns a schema-valid plan or throws a typed BrandeeError.
 */
async function generateCreativePlan({ businessAnalysis, form, planId = randomUUID(), requestId } = {}) {
  let deterministicPlan;
  let decisionConstraints;
  try {
    ({ plan: deterministicPlan, decisionConstraints } = buildDeterministicPlan({ businessAnalysis, form, planId }));
  } catch (error) {
    if (error instanceof BrandeeError) throw error;
    throw toBrandeeError(error, { code: "BRANDEE_PLANNER_MODEL_FAILED", stage: "planning", requestId });
  }

  let baseValidation = BrandeeCreativePlanSchema.safeParse(deterministicPlan);
  let copyIssues = baseValidation.success ? validatePlanCopyQuality(baseValidation.data) : [];

  if (!baseValidation.success || copyIssues.length) {
    // One repair attempt — rebuild once more (idempotent inputs) before
    // giving up typed, per PART 21/30 (BRANDEE_COPY_QUALITY_FAILED).
    const retry = buildDeterministicPlan({ businessAnalysis, form, planId });
    const retryValidation = BrandeeCreativePlanSchema.safeParse(retry.plan);
    const retryCopyIssues = retryValidation.success ? validatePlanCopyQuality(retryValidation.data) : [];

    if (!retryValidation.success) {
      throw new BrandeeError("BRANDEE_PLANNER_SCHEMA_FAILED", {
        internalMessage: `Deterministic plan failed schema validation after retry: ${retryValidation.error.message}`,
        metadata: { issues: retryValidation.error.issues?.slice(0, 5) },
        requestId
      });
    }
    if (retryCopyIssues.length) {
      throw new BrandeeError("BRANDEE_COPY_QUALITY_FAILED", {
        internalMessage: `Plan copy failed quality checks after retry: ${JSON.stringify(retryCopyIssues).slice(0, 500)}`,
        requestId
      });
    }
    deterministicPlan = retryValidation.data;
    decisionConstraints = retry.decisionConstraints;
  } else {
    deterministicPlan = baseValidation.data;
  }

  const { plan: finalPlan, aiUsed, aiError } = await enhancePlanWithAi(deterministicPlan, { businessAnalysis, form });
  return { plan: finalPlan, aiUsed, aiError, decisionConstraints };
}

module.exports = {
  computeAvailableProofTypes,
  buildEvidenceList,
  buildRestrictedClaims,
  buildHookValues,
  rankedHookScores,
  buildAngles,
  aspectRatioForPlatform,
  buildDecisionConstraints,
  buildDeterministicPlan,
  generateCreativePlan
};
