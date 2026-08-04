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
const { getImageCreativePlanningConfig } = require("./modelConfig");

const fetchImpl = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const AI_TIMEOUT_MS = 12000;

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
      const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
        body: JSON.stringify({
          model: config.model,
          messages: [{ role: "user", content: p }],
          response_format: { type: "json_object" },
          temperature: 0.4
        })
      });
      if (!response.ok) throw new Error(`Planning provider error ${response.status} (model: ${config.model})`);
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
    `Selected template/framework: ${template.name} (${template.frameworkKey || "general"})`,
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
    return { plan: deterministicCreativeDirection({ form, template }), aiUsed: false, model: null };
  }
  try {
    const raw = await callPlanningModel(buildPlanningPrompt({ form, template, priorPlan }));
    const validated = CreativeDirectionSchema.safeParse(raw);
    if (!validated.success) return { plan: deterministicCreativeDirection({ form, template }), aiUsed: false, model: config.model };
    return { plan: validated.data, aiUsed: true, model: config.model, reasoningEffort: config.reasoningEffort };
  } catch {
    return { plan: deterministicCreativeDirection({ form, template }), aiUsed: false, model: config.model };
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
    `Template/framework: ${template.name} (${template.frameworkKey || "general"})`,
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
    return { revision: validated.data, aiUsed: true };
  } catch {
    return { revision: deterministicRevision(instruction, currentContent), aiUsed: false };
  }
}

module.exports = {
  CreativeDirectionSchema,
  RevisionInstructionSchema,
  callPlanningModel,
  buildCreativePlan,
  interpretRevision,
  deterministicCreativeDirection
};
