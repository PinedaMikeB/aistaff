// GPT-5.6 Sol creative planning + revision interpretation (PART 12/13/17).
//
// Follows the exact deterministic-first, AI-optional, one-repair-retry
// pattern already established by extraction.js/planner.js in this codebase:
// a correct, safe result is ALWAYS produced even with no AI provider
// configured (the real situation in this environment today — see
// modelConfig.js's header comment), and any AI call failure/invalid-JSON/
// schema-mismatch falls back to that deterministic result rather than
// blocking the customer or fabricating something unsafe.
//
// GPT-5.6 Sol's job here is planning ONLY — it never generates image bytes
// (that's imageGenProvider.js's job) and it never invents facts beyond what
// the customer actually supplied (proof-safety is enforced both in the
// prompt and, more importantly, by never letting an AI-only field override
// anything proof-gated).

const { z } = require("zod");
const { getImageCreativePlanningConfig, isReasoningModel } = require("./modelConfig");

const fetchImpl = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
// See productAnalysisService.js's identical comment — GPT-5.6-family
// reasoning models measured ~31s for a comparable prompt, well past the
// old 12s ceiling.
const AI_TIMEOUT_MS = 45000;

const CreativeDirectionSchema = z.object({
  primaryMessage: z.string().max(200).optional().nullable(),
  headline: z.string().max(100),
  subheadline: z.string().max(160).optional().nullable(),
  cta: z.string().max(40),
  supportingPoints: z.array(z.string().max(80)).max(5).optional().default([]),
  tone: z.string().max(60).optional().nullable(),
  colorDirection: z.array(z.string().max(30)).max(3).optional().default([]),
  proofNotices: z.array(z.string().max(120)).max(3).optional().default([])
});

const RevisionInstructionSchema = z.object({
  revisionSummary: z.string().max(200),
  preserve: z.array(z.string().max(80)).max(8).optional().default([]),
  change: z.array(z.string().max(80)).max(8).optional().default([]),
  updatedCopy: z.object({
    headline: z.string().max(100).optional().nullable(),
    subheadline: z.string().max(160).optional().nullable(),
    cta: z.string().max(40).optional().nullable()
  }).optional().default({}),
  colorHint: z.string().max(30).optional().nullable(),
  understood: z.boolean().optional().default(true)
});

const FRAMEWORK_COPY_GUARDRAIL = [
  "Use the selected framework only as a compositional and persuasive structure.",
  "Do not render the framework name, internal classification, template-family label, or developer terminology inside the customer's ad unless the customer explicitly supplied or requested that exact text.",
  "Do not print phrases such as 'Us vs Them', 'Features & Benefits', 'Bold Claim', 'Question', 'Reasons Why', 'Before & After', 'Offer', 'Testimonial', 'Sticky Notes', or 'iPhone Notes' as decorative labels by default."
].join(" ");

const INTERNAL_FRAMEWORK_LABELS = new Set([
  "US VS THEM", "FEATURES & BENEFITS", "REASONS WHY", "BEFORE & AFTER", "BOLD CLAIM",
  "QUESTION", "OFFER", "TESTIMONIAL", "STICKY NOTES", "IPHONE NOTES"
]);

function explicitlySupplied(value, form = {}) {
  const needle = String(value || "").trim().toLowerCase();
  if (!needle) return false;
  return [form.productName, form.productDescription, form.mainFeatures, form.mainBenefit, form.additionalNotes, form.offerDetails, form.testimonialQuote, form.testimonialAttribution]
    .some((source) => String(source || "").toLowerCase().includes(needle));
}

function sanitizeCustomerFacingPlan(plan = {}, form = {}) {
  const next = { ...plan };
  const fallbackHeadline = form.productName || "Your product";
  const fallbackCta = form.desiredAction === "send_message" ? "Send a message" : form.desiredAction === "visit_product_page" ? "Visit product page" : "Learn more";
  const clean = (value, fallback = null) => INTERNAL_FRAMEWORK_LABELS.has(String(value || "").trim().toUpperCase()) && !explicitlySupplied(value, form) ? fallback : value;
  next.primaryMessage = clean(next.primaryMessage, form.mainBenefit || form.productDescription?.slice(0, 120) || null);
  next.headline = clean(next.headline, fallbackHeadline);
  next.subheadline = clean(next.subheadline, form.mainBenefit || null);
  next.cta = clean(next.cta, fallbackCta);
  next.supportingPoints = (next.supportingPoints || []).filter((point) => !INTERNAL_FRAMEWORK_LABELS.has(String(point || "").trim().toUpperCase()) || explicitlySupplied(point, form));
  return next;
}

function buildImageGenerationPrompt({ template, plan = {}, templateFields = {} }) {
  return [
    "Create a polished 4:5 product advertisement using the selected template as a visual reference.",
    "Preserve the reference layout balance, visual hierarchy, spacing, image placement, typography style, color relationships, and CTA placement.",
    "Replace sample product names, logos, headlines, prices, features, testimonials, proof, and sample framework labels with the supplied customer information.",
    FRAMEWORK_COPY_GUARDRAIL,
    `Customer-visible copy: ${JSON.stringify({ headline:plan.headline || templateFields.headline || null, subheadline:plan.subheadline || plan.subcopy || null, cta:plan.cta || templateFields.cta || null, supportingPoints:plan.supportingPoints || [] })}`,
    `Selected layout reference: ${template?.description || "customer-selected image-ad layout"}`
  ].join("\n");
}

function parseJsonLoose(text) {
  const cleaned = String(text || "").replace(/^```json\s*|```\s*$/g, "").trim();
  return JSON.parse(cleaned);
}

async function withTimeout(promise, ms) {
  let timer;
  const timeout = new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Planning model timed out")), ms); });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Shared low-level JSON-mode call to whichever provider is configured for
 * image-ad creative planning. Returns the PARSED object (with one repair
 * retry on invalid JSON) or throws — callers decide how to fall back.
 * Exported so templateRecommender.js can reuse the exact same call path
 * for its own optional AI polish pass, rather than duplicating it.
 */
async function callPlanningModel(prompt, { timeoutMs = AI_TIMEOUT_MS } = {}) {
  const config = getImageCreativePlanningConfig();
  if (!config.apiKeyConfigured || !config.model || config.provider === "mock") {
    throw Object.assign(new Error("Planning model not configured"), { code: "NOT_CONFIGURED" });
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
        throw Object.assign(new Error(`Planning provider error ${response.status} (model: ${config.model}): ${errorBody.slice(0, 300)}`), { status: response.status, providerBody: errorBody });
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
      if (!response.ok) throw new Error(`Planning provider error ${response.status} (model: ${config.model})`);
      const json = await response.json();
      return json.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    }
    throw new Error(`Unsupported planning provider: ${config.provider}`);
  }

  let raw;
  try {
    raw = await withTimeout(call(prompt), timeoutMs);
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

function deterministicCreativeDirection({ form, template }) {
  const mapper = {
    offer_promo: () => ({ headline: form.offerDetails || form.discountText || `Special offer on ${form.productName}`, cta: "Shop the offer" }),
    testimonial_style: () => ({ headline: `"${form.testimonialQuote || ""}"`.slice(0, 100), cta: "See why customers love it" }),
    question_ad: () => ({ headline: `Still looking for the right ${form.productName}?`, cta: "See how it helps" }),
    bold_claim: () => ({ headline: form.mainBenefit || form.productName, cta: "Learn more" })
  };
  const specific = mapper[template.id]?.() || {};
  return CreativeDirectionSchema.parse({
    primaryMessage: form.mainBenefit || form.productDescription?.slice(0, 120) || null,
    headline: specific.headline || form.productName,
    subheadline: form.mainBenefit || null,
    cta: specific.cta || (form.desiredAction === "send_message" ? "Send a message" : form.desiredAction === "visit_product_page" ? "Visit product page" : "Shop now"),
    supportingPoints: (form.mainFeatures || "").split(/\n|,/).map((s) => s.trim()).filter(Boolean).slice(0, 5),
    tone: "friendly and direct",
    colorDirection: form.brandColors || [],
    proofNotices: []
  });
}

function buildPlanningPrompt({ form, template, priorPlan }) {
  return [
    "You are Brandee, a marketing creative planner for AIStaff. You plan ad copy and layout DECISIONS only — you never generate image pixels.",
    "Never invent discounts, deadlines, reviews, ratings, testimonials, guarantees, or scarcity that the customer did not actually provide.",
    "Write in the customer's preferred language. Keep the headline under 12 words.",
    `Product name: ${form.productName}`,
    `Product description: ${form.productDescription}`,
    `Main features: ${form.mainFeatures}`,
    `Target customer: ${form.targetCustomer}`,
    `Desired action: ${form.desiredAction}`,
    `Preferred language: ${form.preferredLanguage || "english"}`,
    form.regularPrice ? `Regular price: ${form.regularPrice}` : "",
    form.promoPrice ? `Promo price: ${form.promoPrice}` : "",
    form.testimonialQuote ? `Real testimonial: "${form.testimonialQuote}" — ${form.testimonialAttribution}` : "",
    `Selected template/framework for internal planning only: ${template.name} (${template.frameworkKey || "general"})`,
    FRAMEWORK_COPY_GUARDRAIL,
    `Template description: ${template.description}`,
    priorPlan ? `Previous creative plan (for context, you may keep or improve it): ${JSON.stringify(priorPlan)}` : "",
    "",
    "Return ONLY a JSON object with this exact shape (no extra keys, no markdown fences):",
    "{",
    '  "primaryMessage": string|null,',
    '  "headline": string,',
    '  "subheadline": string|null,',
    '  "cta": string,',
    '  "supportingPoints": string[],',
    '  "tone": string|null,',
    '  "colorDirection": string[],',
    '  "proofNotices": string[]',
    "}"
  ].filter(Boolean).join("\n");
}

/**
 * Builds the structured creative direction for a first preview (PART 12).
 * Never throws — on any AI unavailability/failure, returns a correct
 * deterministic plan built straight from the product form, exactly the
 * "planner always produces a valid result" guarantee this codebase already
 * uses for the business-analysis Creative Plan feature.
 */
async function buildCreativePlan({ form, template, priorPlan = null }) {
  const config = getImageCreativePlanningConfig();
  if (!config.apiKeyConfigured || config.provider === "mock") {
    return { plan: sanitizeCustomerFacingPlan(deterministicCreativeDirection({ form, template }), form), aiUsed: false, model: null };
  }
  try {
    const raw = await callPlanningModel(buildPlanningPrompt({ form, template, priorPlan }));
    const validated = CreativeDirectionSchema.safeParse(raw);
    if (!validated.success) return { plan: sanitizeCustomerFacingPlan(deterministicCreativeDirection({ form, template }), form), aiUsed: false, model: config.model };
    return { plan: sanitizeCustomerFacingPlan(validated.data, form), aiUsed: true, model: config.model, reasoningEffort: config.reasoningEffort };
  } catch {
    return { plan: sanitizeCustomerFacingPlan(deterministicCreativeDirection({ form, template }), form), aiUsed: false, model: config.model };
  }
}

// A small set of deterministic revision instructions this app can honor
// even with no AI provider configured (PART 18/28 disclosure: without a
// configured planning model, only these recognized phrasings work).
const DETERMINISTIC_REVISION_RULES = [
  { pattern: /remove the price|no price|hide the price/i, apply: () => ({ updatedCopy: { price: null } }) },
  { pattern: /remove the (cta|call to action)/i, apply: () => ({ updatedCopy: {} }) },
  { pattern: /less text|shorter|fewer words/i, apply: (content) => ({ updatedCopy: { subheadline: null }, colorHint: null }) }
];

function deterministicRevision(instruction, currentContent) {
  const rule = DETERMINISTIC_REVISION_RULES.find((r) => r.pattern.test(instruction));
  if (!rule) {
    return { revisionSummary: instruction.slice(0, 200), preserve: ["everything not mentioned"], change: [], updatedCopy: {}, colorHint: null, understood: false };
  }
  return { revisionSummary: instruction.slice(0, 200), preserve: ["everything not mentioned"], change: [instruction.slice(0, 80)], ...rule.apply(currentContent), understood: true };
}

function buildRevisionPrompt({ form, template, currentContent, instruction }) {
  return [
    "You are Brandee, editing an EXISTING ad preview based on the customer's instruction.",
    "Edit the provided current preview. Preserve its composition, product identity, logo, typography hierarchy, and all unchanged elements. Apply only the requested revision unless a small supporting change is necessary for visual coherence.",
    "Never invent new claims, discounts, testimonials, or facts not already present.",
    `Template/framework for internal planning only: ${template.name} (${template.frameworkKey || "general"})`,
    FRAMEWORK_COPY_GUARDRAIL,
    `Current headline: ${currentContent.headline}`,
    `Current subheadline/body: ${currentContent.subcopy || "(none)"}`,
    `Current CTA: ${currentContent.cta}`,
    `Customer's revision instruction: "${instruction}"`,
    "",
    "Return ONLY a JSON object with this exact shape (no extra keys, no markdown fences):",
    "{",
    '  "revisionSummary": string,',
    '  "preserve": string[],',
    '  "change": string[],',
    '  "updatedCopy": { "headline": string|null, "subheadline": string|null, "cta": string|null },',
    '  "colorHint": string|null,',
    '  "understood": boolean',
    "}"
  ].join("\n");
}

/**
 * Interprets a natural-language revision instruction (PART 16/17) into a
 * structured set of copy changes, using the CURRENT rendered content as
 * context so unrelated fields are explicitly marked "preserve". Falls back
 * to a small deterministic rule set when no AI provider is configured —
 * `understood: false` signals the caller to show an honest "try being more
 * specific" message rather than silently doing nothing.
 */
async function interpretRevision({ form, template, currentContent, instruction }) {
  const config = getImageCreativePlanningConfig();
  if (!config.apiKeyConfigured || config.provider === "mock") {
    return { revision: deterministicRevision(instruction, currentContent), aiUsed: false };
  }
  try {
    const raw = await callPlanningModel(buildRevisionPrompt({ form, template, currentContent, instruction }));
    const validated = RevisionInstructionSchema.safeParse(raw);
    if (!validated.success) return { revision: deterministicRevision(instruction, currentContent), aiUsed: false };
    const safeRevision = { ...validated.data, updatedCopy: { ...validated.data.updatedCopy } };
    const safeCopy = sanitizeCustomerFacingPlan({ ...currentContent, ...safeRevision.updatedCopy }, form);
    for (const key of ["headline", "subheadline", "cta"]) if (safeRevision.updatedCopy[key] !== undefined) safeRevision.updatedCopy[key] = safeCopy[key];
    return { revision: safeRevision, aiUsed: true };
  } catch {
    return { revision: deterministicRevision(instruction, currentContent), aiUsed: false };
  }
}

// --- AI_GENERATED_LAYOUT: compose the final GPT Image 2 prompt -----------
// The template supplies ART DIRECTION (layout/style, from
// templateImagePrompts.js via the DB column); the customer supplies the
// FACTS. Sol merges them into one prompt. Sol is explicitly forbidden from
// inventing copy: it may only shorten/select from what the customer wrote,
// because image models render long text badly and a 40-word benefit line
// would come out as illegible mush.

const ImagePromptSchema = z.object({
  prompt: z.string().min(40).max(3500),
  visibleText: z.object({
    headline: z.string().max(80).optional().nullable(),
    cta: z.string().max(40).optional().nullable(),
    lines: z.array(z.string().max(90)).max(6).optional().default([])
  }).optional().default({})
});

function buildImagePromptComposerPrompt({ artDirection, form, template, templateFields }) {
  return [
    "You are Brandee's art director. Produce ONE final image-generation prompt for an image model.",
    "",
    "ART DIRECTION (the layout and visual style you must follow — do not change the structure):",
    artDirection,
    "",
    `CUSTOMER FACTS (the only source of any words that may appear in the ad): ${JSON.stringify({
      productName: form.productName || null,
      targetCustomer: form.targetCustomer || null,
      mainBenefit: form.mainBenefit || null,
      mainFeatures: form.mainFeatures || null,
      preferredLanguage: form.preferredLanguage || "english",
      templateFields: templateFields || {}
    })}`,
    "",
    "RULES:",
    "1. Every word that will be rendered in the image must come from the customer facts. Never invent a claim, price, statistic, testimonial, guarantee, brand name, or award.",
    "2. Image models render long text badly. SHORTEN aggressively: headline at most 6 words, call to action at most 4 words, each list/column line at most 5 words. Shortening is allowed; changing the meaning is not.",
    "3. Include at most 6 short text elements in total across the whole ad. Drop the least important rather than crowding.",
    "4. Write the text in the customer's preferred language.",
    FRAMEWORK_COPY_GUARDRAIL,
    "5. State each exact string to render, in quotes, at its named position in the layout, so the image model spells it correctly.",
    "6. The reference photo supplied alongside this prompt is the real product/subject — instruct that it be kept exactly as-is, never redrawn or replaced.",
    "",
    'Return a single JSON object: { "prompt": "<the complete final image-generation prompt>", "visibleText": { "headline": string|null, "cta": string|null, "lines": [string] } }'
  ].join("\n");
}

/**
 * Builds the final GPT Image 2 prompt for an AI_GENERATED_LAYOUT template.
 * Returns { prompt, visibleText, aiUsed }. When Sol is unavailable or
 * returns something unusable, returns { prompt: null } — callers MUST treat
 * that as "fall back to the deterministic SVG compositor", never as
 * permission to generate from the art direction alone (which would produce
 * an ad with placeholder/invented text).
 */
async function composeImagePrompt({ form, template, templateFields = {} }) {
  const artDirection = template?.imageGenPrompt || null;
  if (!artDirection) return { prompt: null, visibleText: null, aiUsed: false, reason: "no_art_direction" };
  try {
    const raw = await callPlanningModel(buildImagePromptComposerPrompt({ artDirection, form, template, templateFields }));
    const validated = ImagePromptSchema.safeParse(raw);
    if (!validated.success) return { prompt: null, visibleText: null, aiUsed: false, reason: "invalid_composer_response" };
    return { prompt: validated.data.prompt, visibleText: validated.data.visibleText || null, aiUsed: true };
  } catch (error) {
    return { prompt: null, visibleText: null, aiUsed: false, reason: "composer_error", detail: error.message };
  }
}

module.exports = {
  CreativeDirectionSchema,
  RevisionInstructionSchema,
  ImagePromptSchema,
  callPlanningModel,
  buildImageGenerationPrompt,
  buildImagePromptComposerPrompt,
  composeImagePrompt,
  sanitizeCustomerFacingPlan,
  buildCreativePlan,
  interpretRevision,
  deterministicCreativeDirection
};
