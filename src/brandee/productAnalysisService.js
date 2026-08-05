// GPT-5.6 Sol product research + field-suggestion generation for the
// Brandee Image Ad Workspace ("Analyze Product").
//
// Follows the exact deterministic-first, AI-optional pattern already
// established by creativePlanner.js (same model config via
// getImageCreativePlanningConfig(), same call-then-validate-then-fallback
// shape, same JSON-repair-retry) — a correct, honest result is always
// produced even with no AI provider configured (the real situation in this
// environment today), and any AI-call failure/invalid-JSON falls back to
// suggestions derived only from data that was actually extracted, never
// fabricated specs, prices, or customer results.
//
// Reuses rather than duplicates:
// - productUrlExtractor.js for single-product-URL research (the same,
//   already-proven path "Fill from link" already used)
// - businessProfileBuilder.js for optional business-website context
//   (service benefits, offers) when a business URL is supplied
// - evidenceModel.js for the verified/owner-supplied/inference
//   classification that becomes this feature's claim-status system
//   (Verified / Owner Confirmed / Needs Confirmation)
// - copyQuality.js's normalizeRawPhrase for cleaning any raw text before
//   it is shown back to the owner or substituted into a prompt

const { z } = require("zod");
const { getImageCreativePlanningConfig, isReasoningModel } = require("./modelConfig");
const { extractProductFromUrl } = require("./productUrlExtractor");
const { buildBusinessProfile } = require("./businessProfileBuilder");
const { makeEvidence, isVerified, isUserSupplied, isInferred } = require("./evidenceModel");
const { normalizeRawPhrase } = require("./copyQuality");

const fetchImpl = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
// GPT-5.6-family reasoning models take real "thinking" time before
// responding — measured at ~31s for this module's actual research prompt
// at reasoning_effort:"medium" against the live API, well past the old
// 15s ceiling (which meant analyzeProduct was ALWAYS timing out and
// silently falling back to deterministic mode the moment credits existed
// to actually reach this code path). 45s comfortably covers normal
// variance above that measured baseline without making a single retry
// attempt (the JSON-repair retry below can still double this in the rare
// worst case) balloon past what's reasonable for an interactive request.
const AI_TIMEOUT_MS = 45000;

// --- Claim status mapping (spec: Verified / Owner Confirmed / Needs Confirmation) ---
// Reuses evidenceModel.js's existing three-way split rather than inventing
// a parallel classification.
function claimStatusFromEvidence(evidence) {
  if (isVerified(evidence)) return "verified";
  if (isUserSupplied(evidence)) return "owner_confirmed";
  return "needs_confirmation"; // isInferred(evidence) and anything else
}

function claimFromEvidence(evidence, { type = "product" } = {}) {
  return {
    id: `claim_${Math.random().toString(36).slice(2, 10)}`,
    text: evidence.statement,
    type,
    status: claimStatusFromEvidence(evidence),
    sourceIds: evidence.sourceUrl ? [evidence.sourceUrl] : [],
    requiresConfirmation: isInferred(evidence)
  };
}

// --- Suggestion + response schema -----------------------------------------

const SuggestionSchema = z.object({
  text: z.string().min(1).max(400),
  angle: z.string().max(60).optional().nullable(),
  reason: z.string().max(200).optional().nullable()
});

const AiAnalysisResponseSchema = z.object({
  detectedCategory: z.string().max(80).optional().nullable(),
  targetAudience: z.string().max(200).optional().nullable(),
  productCapabilities: z.array(z.string().max(140)).max(8).optional().default([]),
  serviceBenefits: z.array(z.string().max(140)).max(8).optional().default([]),
  advertisingAngles: z.array(z.string().max(100)).max(4).optional().default([]),
  fields: z.record(z.array(SuggestionSchema).max(4)).optional().default({})
});

// The model reliably returns a few more items than asked for in a given
// array field (confirmed directly against the live API: advertisingAngles
// came back with 5-6 items against a requested/schema max of 4, on 2 of 3
// consecutive runs) — a minor, harmless overage that Zod's .max() treats
// as a hard rejection of the ENTIRE response object, discarding perfectly
// good suggestions for every other field along with it. Trims each
// known array field down to its schema limit BEFORE validation, so an
// overage in one non-critical field (advertising angles) can never nuke
// suggestions for productName/productDescription/mainFeatures/etc.
function clampAiAnalysisArrays(raw) {
  if (!raw || typeof raw !== "object") return raw;
  const clamped = { ...raw };
  if (Array.isArray(clamped.productCapabilities)) clamped.productCapabilities = clamped.productCapabilities.slice(0, 8);
  if (Array.isArray(clamped.serviceBenefits)) clamped.serviceBenefits = clamped.serviceBenefits.slice(0, 8);
  if (Array.isArray(clamped.advertisingAngles)) clamped.advertisingAngles = clamped.advertisingAngles.slice(0, 4);
  if (clamped.fields && typeof clamped.fields === "object") {
    const fields = {};
    for (const [key, list] of Object.entries(clamped.fields)) fields[key] = Array.isArray(list) ? list.slice(0, 4) : list;
    clamped.fields = fields;
  }
  return clamped;
}

// --- Shared AI-call helpers (same shape as creativePlanner.js's, kept
// local rather than shared to avoid coupling two independently-evolving
// AI-call sites — same convention already used across this subsystem's
// other modules). ---

function parseJsonLoose(text) {
  const cleaned = String(text || "").replace(/^```json\s*|```\s*$/g, "").trim();
  return JSON.parse(cleaned);
}

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Research model timed out")), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function callResearchModel(prompt, { timeoutMs = AI_TIMEOUT_MS } = {}) {
  const config = getImageCreativePlanningConfig();
  if (!config.apiKeyConfigured || !config.model || config.provider === "mock") {
    throw Object.assign(new Error("Research model not configured"), { code: "NOT_CONFIGURED" });
  }

  async function call(p) {
    if (config.provider === "openai") {
      // GPT-5.6-family/reasoning models reject a custom `temperature`
      // outright (confirmed against the live API) and use
      // `reasoning_effort` instead; standard models (e.g. this getter's
      // own OPENAI_MODEL fallback) need the opposite. Branch on the actual
      // configured model rather than assuming one family unconditionally.
      const reasoning = isReasoningModel(config.model);
      const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: p }],
          response_format: { type: "json_object" },
          ...(reasoning ? { reasoning_effort: config.reasoningEffort || "medium" } : { temperature: 0.4 })
        })
      });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw Object.assign(new Error(`Research provider error ${response.status} (model: ${config.model}): ${errorBody.slice(0, 300)}`), { status: response.status, providerBody: errorBody });
      }
      const json = await response.json();
      return json.choices?.[0]?.message?.content || "{}";
    }
    if (config.provider === "gemini") {
      const response = await fetchImpl(`https://generativelanguage.googleapis.com/v1beta/models/${config.model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contents: [{ parts: [{ text: `${p}\nReturn only valid JSON, no markdown fences.` }] }], generationConfig: { temperature: 0.4 } })
      });
      if (!response.ok) {
        const errorBody = await response.text().catch(() => "");
        throw Object.assign(new Error(`Research provider error ${response.status} (model: ${config.model}): ${errorBody.slice(0, 300)}`), { status: response.status, providerBody: errorBody });
      }
      const json = await response.json();
      return json.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    }
    throw new Error(`Unsupported research provider: ${config.provider}`);
  }

  try {
    const raw = await withTimeout(call(prompt), timeoutMs);
    return parseJsonLoose(raw);
  } catch (firstError) {
    try {
      const repaired = await withTimeout(call(`${prompt}\n\nYour previous response was not valid JSON. Return ONLY a valid JSON object, nothing else.`), timeoutMs);
      return parseJsonLoose(repaired);
    } catch (secondError) {
      throw firstError.message?.includes("not valid JSON") ? secondError : firstError;
    }
  }
}

// Turns a raw callResearchModel() failure into an honest, specific warning
// instead of a generic "didn't respond in time" that could just as easily
// mask a wrong/unsupported model name, an auth failure, or (as actually
// happened once in this environment) the connected OpenAI account being
// out of billing credits — genuinely different problems needing genuinely
// different fixes, so the warning should say which one it actually was.
function describeResearchError(error) {
  const body = String(error?.providerBody || "");
  if (/insufficient_quota|credit_balance_exhausted|no credits remaining/i.test(body)) {
    return "Brandee's AI research model is unavailable — the connected OpenAI account has no billing credits remaining. Add credits to resume AI suggestions; extracted-data suggestions still work.";
  }
  if (error?.status === 401 || /invalid_api_key/i.test(body)) {
    return "Brandee's AI research model is unavailable — the configured API key was rejected. Showing suggestions from your extracted data only.";
  }
  if (error?.status === 404 || /model_not_found/i.test(body)) {
    return "Brandee's AI research model is unavailable — the configured model name isn't available on this account. Showing suggestions from your extracted data only.";
  }
  if (error?.message === "Research model timed out") {
    return "Brandee's AI research model didn't respond in time — showing suggestions from your extracted data only.";
  }
  return "Brandee's AI research model returned an error — showing suggestions from your extracted data only.";
}

// --- Prompt ------------------------------------------------------------

function buildResearchPrompt({ template, extracted, businessProfile, productName, productDescription, existingFields }) {
  const fieldKeys = ["productName", "targetCustomer", "productDescription", "mainFeatures", "mainBenefit", ...((template.fields || []).map((f) => f.key))];
  const lines = [
    "You are Brandee, an AI creative strategist helping a small/medium Filipino business owner prepare a truthful image advertisement.",
    "Never invent specifications, prices, guarantees, customer results, or competitor weaknesses. If you are not confident about a fact, omit it rather than guessing.",
    `The owner selected the "${template.name}" creative approach (framework: ${template.frameworkKey || template.id}).`,
    productName ? `Product name so far: ${productName}` : null,
    productDescription ? `Product description so far: ${productDescription}` : null,
    extracted ? `Extracted from the product's own listing page: ${JSON.stringify({ name: extracted.productName, description: extracted.description, price: extracted.price })}` : null,
    businessProfile ? `Extracted from the business's own website (use ONLY for service/offer context, not product specs): ${JSON.stringify({ offers: businessProfile.offers, productsOrServices: businessProfile.productsOrServices, businessOutcomes: businessProfile.businessOutcomes })}` : null,
    Object.keys(existingFields || {}).length ? `Fields the owner already filled in (do not contradict these, only build on them): ${JSON.stringify(existingFields)}` : null,
    "Return a single JSON object with this exact shape:",
    JSON.stringify({
      detectedCategory: "string or null",
      targetAudience: "one sentence describing the likely customer, or null",
      productCapabilities: ["verifiable product capability strings, only from what was actually extracted above"],
      serviceBenefits: ["business/service benefit strings, only from what was actually extracted above"],
      advertisingAngles: ["short phrases naming a distinct advertising angle"],
      fields: Object.fromEntries(fieldKeys.map((k) => [k, "array of up to 3 objects: {text, angle, reason}"]))
    }),
    "For every field in `fields`, give 2-3 real alternatives grounded in the information above. If there is not enough information to write a specific field responsibly, return an empty array for it rather than inventing content."
  ].filter(Boolean);
  return lines.join("\n\n");
}

// --- Deterministic fallback (zero AI dependency) ------------------------
// Conservative on purpose: only ever echoes back data that was actually
// extracted or typed. Produces an empty suggestion list for a field rather
// than inventing copy when no real source data exists for it.

function deterministicAnalysis({ extracted, businessProfile }) {
  const fields = {};
  if (extracted?.productName) fields.productName = [{ text: normalizeRawPhrase(extracted.productName), angle: "from your product page", reason: "Extracted directly from the product page you provided." }];
  if (extracted?.description) fields.productDescription = [{ text: normalizeRawPhrase(extracted.description), angle: "from your product page", reason: "Extracted directly from the product page you provided." }];
  if (businessProfile?.businessOutcomes?.length) {
    fields.mainBenefit = businessProfile.businessOutcomes.slice(0, 2).map((o) => ({ text: normalizeRawPhrase(o.statement || o), angle: "from your business site", reason: "Found on your own website." }));
  }
  return {
    detectedCategory: null,
    targetAudience: null,
    productCapabilities: [],
    serviceBenefits: (businessProfile?.offers || []).slice(0, 5).map((o) => normalizeRawPhrase(o.statement || o)),
    advertisingAngles: [],
    fields
  };
}

// --- Main entry point -----------------------------------------------------

/**
 * @param {object} input
 * @param {string|null} input.productUrl
 * @param {string|null} input.businessWebsite
 * @param {string|null} input.productName
 * @param {string|null} input.productDescription
 * @param {object} input.template - resolved template object (from templateCatalog), needed for its field schema
 * @param {object} input.existingFields - fields the owner has already filled in, never overwritten
 * @param {function} [input.fetchHtmlPage] - test-only override, forwarded to extractProductFromUrl (matches its own existing DI pattern) so this service is testable without real network calls
 */
async function analyzeProduct({ productUrl, businessWebsite, productName, productDescription, template, existingFields = {}, fetchHtmlPage = undefined }) {
  const warnings = [];
  const sources = [];
  const evidence = [];

  let extracted = null;
  if (productUrl) {
    const result = await extractProductFromUrl(productUrl, fetchHtmlPage ? { fetchHtmlPage } : undefined);
    if (result.ok) {
      extracted = result.extracted;
      sources.push({ id: productUrl, name: "Product listing page", pageTitle: extracted.productName || productUrl, sourceType: "official_product_page", supportsClaims: ["productName", "productDescription", "price"] });
      if (extracted.productName) evidence.push(makeEvidence({ statement: extracted.productName, sourceType: "website", sourceUrl: productUrl, entityType: "product_name" }));
      if (extracted.description) evidence.push(makeEvidence({ statement: extracted.description, sourceType: "website", sourceUrl: productUrl, entityType: "product_description" }));
    } else {
      warnings.push(result.message || "Could not read the product page you provided.");
    }
  }

  let businessProfile = null;
  if (businessWebsite) {
    try {
      businessProfile = await buildBusinessProfile(businessWebsite);
      sources.push({ id: businessWebsite, name: "Business website", pageTitle: businessProfile.businessName || businessWebsite, sourceType: "official_business_website", supportsClaims: ["serviceBenefits", "mainBenefit"] });
      for (const offer of businessProfile.offers || []) evidence.push(makeEvidence({ statement: offer.statement || offer, sourceType: "website", sourceUrl: businessWebsite, entityType: "offer" }));
    } catch {
      warnings.push("Could not read your business website. Service-related suggestions will be limited.");
    }
  }

  if (!productUrl && !businessWebsite && !productName && !productDescription) {
    warnings.push("Add a product link, business website, product name, or description so Brandee has something to research.");
  }

  const config = getImageCreativePlanningConfig();
  let ai = null;
  let aiUsed = false;
  if (config.apiKeyConfigured && config.provider !== "mock") {
    try {
      const raw = await callResearchModel(buildResearchPrompt({ template, extracted, businessProfile, productName, productDescription, existingFields }));
      const validated = AiAnalysisResponseSchema.safeParse(clampAiAnalysisArrays(raw));
      if (validated.success) {
        ai = validated.data;
        aiUsed = true;
      } else {
        // A schema mismatch is a real, occasionally-occurring outcome with
        // this reasoning model (confirmed: the exact same prompt succeeds
        // on one run and fails shape validation on another) — previously
        // silent, indistinguishable from "nothing went wrong, there was
        // just nothing to suggest." Surface it honestly like every other
        // failure mode here, and get the client to encourage a retry.
        warnings.push("Brandee's AI research model returned an unexpected response shape — try Analyze Product again, or continue with your extracted data.");
      }
    } catch (error) {
      warnings.push(describeResearchError(error));
    }
  }

  const base = ai || deterministicAnalysis({ extracted, businessProfile });

  // Never let a suggestion silently overwrite something the owner already
  // typed — the caller (API route) filters again defensively, but flagging
  // it here too keeps this service correct on its own.
  const fieldSuggestions = {};
  for (const [key, list] of Object.entries(base.fields || {})) {
    if (!Array.isArray(list) || !list.length) continue;
    fieldSuggestions[key] = list.map((s, i) => ({
      id: `sugg_${key}_${i}_${Math.random().toString(36).slice(2, 8)}`,
      fieldKey: key,
      text: normalizeRawPhrase(s.text),
      angle: s.angle || null,
      reason: s.reason || null,
      status: aiUsed ? "needs_confirmation" : (extracted || businessProfile) ? "verified" : "owner_confirmed",
      sourceIds: extracted ? [productUrl] : businessProfile ? [businessWebsite] : [],
      confidence: aiUsed ? "medium" : (extracted || businessProfile) ? "high" : "low"
    }));
  }

  const claims = [
    ...evidence.map((e) => claimFromEvidence(e, { type: e.entityType === "offer" ? "service" : "product" })),
    ...(ai?.productCapabilities || []).map((text) => claimFromEvidence(makeEvidence({ statement: text, sourceType: "inference", confidence: 0.5, entityType: "capability" }), { type: "product" })),
    ...(ai?.serviceBenefits || []).map((text) => claimFromEvidence(makeEvidence({ statement: text, sourceType: "inference", confidence: 0.5, entityType: "benefit" }), { type: "service" }))
  ];

  const suggestedFieldCount = Object.keys(fieldSuggestions).length;

  return {
    status: "completed",
    aiUsed,
    detectedProduct: {
      name: extracted?.productName || productName || null,
      brand: null,
      model: null,
      category: ai?.detectedCategory || null,
      confidence: extracted ? "medium" : "low"
    },
    productCapabilities: base.productCapabilities || [],
    serviceBenefits: base.serviceBenefits || [],
    targetAudiences: ai?.targetAudience ? [ai.targetAudience] : [],
    advertisingAngles: ai?.advertisingAngles || [],
    fieldSuggestions,
    suggestedFieldCount,
    claims,
    sources,
    warnings
  };
}

// --- Per-field AI assistance (Phase 3: the sparkle-icon popover menu) -----
// One parameterized prompt template driven by an action->instruction map,
// rather than 20 bespoke prompts — same model, same call/validate/fallback
// pattern as analyzeProduct above, so every action gets the same honesty
// guarantees for free.

const FIELD_ASSIST_ACTIONS = {
  suggest_from_research: "Suggest strong options grounded in the product research already gathered.",
  improve: "Rewrite the owner's current answer to be clearer and more persuasive while preserving its exact meaning and every fact already in it. Do not add any new claim.",
  benefit_focused: "Rewrite to foreground the practical benefit to the customer, not just the feature.",
  more_persuasive: "Rewrite to be more persuasive while staying strictly truthful and adding no new claim.",
  shorter: "Rewrite to be noticeably shorter while keeping the essential meaning.",
  clearer: "Rewrite to be simpler and easier to understand at a glance.",
  for_target_customer: "Rewrite so the language speaks directly to the stated target customer.",
  alternatives: "Generate genuinely different alternative phrasings — not minor rewordings of each other.",
  translate_en: "Translate the current answer to natural English, preserving its exact meaning.",
  translate_fil: "Translate the current answer to natural Filipino, preserving its exact meaning.",
  tone_professional: "Rewrite in a professional, business tone.",
  tone_conversational: "Rewrite in a warm, conversational tone.",
  compare_product: "Write a comparison of verifiable product capabilities against a clearly named product category — never an unnamed competitor.",
  compare_service: "Write a comparison of this business's service model against an alternative buying/service model (e.g. renting vs. buying and maintaining one's own equipment) — never attack a competitor by name.",
  defensible_points: "List only comparison points that are specific and defensible if challenged, never vague superiority claims.",
  remove_risky: "Rewrite, removing any claim that could not be defended if challenged (e.g. 'always', 'guaranteed', 'zero downtime', 'cheapest', 'best').",
  verified_only: "Keep only claims directly supported by the product/business research already gathered; remove anything else.",
  cta_message: "Write a call to action that asks the customer to send a message.",
  cta_quotation: "Write a call to action that asks the customer to request a quotation.",
  cta_booking: "Write a call to action that asks the customer to book or schedule.",
  cta_purchase: "Write a call to action that asks the customer to buy now.",
  cta_store_visit: "Write a call to action that invites the customer to visit the store."
};

function buildFieldAssistPrompt({ fieldLabel, action, mode, currentValue, template, context }) {
  const instruction = FIELD_ASSIST_ACTIONS[action] || FIELD_ASSIST_ACTIONS.suggest_from_research;
  const lines = [
    "You are Brandee, an AI creative strategist helping a small/medium Filipino business owner prepare a truthful image advertisement.",
    "Never invent specifications, prices, guarantees, customer results, or competitor weaknesses beyond what is given below.",
    `The owner selected the "${template.name}" creative approach.`,
    `You are assisting with the field: "${fieldLabel}".`,
    instruction,
    mode === "improve" && currentValue ? `The owner's current answer to rewrite: "${currentValue}"` : null,
    mode === "generate_again" ? "Use a genuinely different angle from the obvious/typical phrasing." : null,
    context && Object.keys(context).length ? `Known context: ${JSON.stringify(context)}` : null,
    'Return a single JSON object: { "suggestions": [ {"text": string, "angle": string or null, "reason": string or null}, ... up to 4 items ] }'
  ].filter(Boolean);
  return lines.join("\n\n");
}

const FieldAssistResponseSchema = z.object({ suggestions: z.array(SuggestionSchema).max(6).optional().default([]) });

/**
 * Per-field AI assistance (the sparkle-icon popover). "suggest_from_research"
 * is special-cased to reuse whatever the last full analyzeProduct() call
 * already produced for this exact field — no extra AI call needed, and it
 * stays consistent with what "Review Suggestions" already showed. Every
 * other action makes one fresh, narrowly-scoped call through the same
 * callResearchModel used by analyzeProduct, so it inherits the same
 * timeout/retry/honest-failure behavior.
 */
async function generateFieldAssist({ fieldKey, fieldLabel, action, mode = "suggest", currentValue = null, template, context = {}, existingAnalysisSuggestions = [] }) {
  if (action === "suggest_from_research" && existingAnalysisSuggestions.length) {
    return { suggestions: existingAnalysisSuggestions, aiUsed: false, mode: "suggest" };
  }
  const config = getImageCreativePlanningConfig();
  if (!config.apiKeyConfigured || config.provider === "mock") {
    return { suggestions: [], aiUsed: false, unavailable: true, mode };
  }
  try {
    const raw = await callResearchModel(buildFieldAssistPrompt({ fieldLabel, action, mode, currentValue, template, context }));
    const validated = FieldAssistResponseSchema.safeParse(raw && typeof raw === "object" && Array.isArray(raw.suggestions) ? { ...raw, suggestions: raw.suggestions.slice(0, 6) } : raw);
    if (!validated.success || !validated.data.suggestions.length) return { suggestions: [], aiUsed: false, mode };
    const suggestions = validated.data.suggestions.map((s, i) => ({
      id: `assist_${fieldKey}_${action}_${i}_${Math.random().toString(36).slice(2, 8)}`,
      fieldKey,
      text: normalizeRawPhrase(s.text),
      angle: s.angle || null,
      reason: s.reason || null,
      status: "needs_confirmation",
      sourceIds: [],
      confidence: "medium"
    }));
    return { suggestions, aiUsed: true, mode };
  } catch (error) {
    return { suggestions: [], aiUsed: false, error: true, errorMessage: describeResearchError(error), mode };
  }
}

module.exports = {
  analyzeProduct,
  claimStatusFromEvidence,
  claimFromEvidence,
  deterministicAnalysis,
  buildResearchPrompt,
  AiAnalysisResponseSchema,
  SuggestionSchema,
  FIELD_ASSIST_ACTIONS,
  buildFieldAssistPrompt,
  generateFieldAssist,
  describeResearchError,
  clampAiAnalysisArrays
};

