// Template recommendation engine (PART 9).
//
// Design mirrors planner.js's deterministic-first pattern: eligibility and a
// base ranking are ALWAYS computed deterministically from the actual product
// form + the hard proof-safety rules below, so "Recommended for your
// product" always returns something sane with zero AI dependency. An
// optional AI pass (GPT-5.6 Sol via creativePlanner.js's shared call helper)
// may re-order the top candidates and write more natural customer-facing
// reasons, but it can NEVER promote a template that failed the deterministic
// eligibility check — the hard safety rules are enforced in code, not left
// to the model's judgment.

const { getPlannerConfig } = require("./modelConfig");
const { callPlanningModel } = require("./creativePlanner");

// PART 9 rules 2-6 — a template must never even be a *candidate* if its
// proof requirement isn't met by real, supplied evidence.
function isEligible(template, form) {
  const req = template.proofRequirement;
  if (!req) return true;
  if (req === "testimonial") return Boolean(form.testimonialQuote && form.testimonialAttribution);
  if (req === "offer") return Boolean(form.regularPrice || form.promoPrice || form.discountText || form.offerDetails);
  if (req === "comparison") return Boolean(form.additionalNotes && /vs\.?|compare|better than|instead of/i.test(form.additionalNotes));
  if (req === "before_after_proof") return Boolean(form.additionalNotes && /before|after/i.test(form.additionalNotes));
  if (req === "claim_evidence") return true; // the claim/evidence fields are collected on the template step itself, not gate-able earlier
  return true;
}

function baseScore(template, form) {
  let score = 0;
  const audience = (form.audienceType || "").toUpperCase();
  if (audience && template.audienceType && template.audienceType !== "UNIVERSAL") {
    score += template.audienceType === audience ? 3 : -1;
  }
  if (template.isFeatured) score += 1;
  if (template.frameworkKey === "question" && /\?|why do|how do|still/i.test(form.productDescription || "")) score += 2;
  if (template.frameworkKey === "offer" && (form.promoPrice || form.discountText)) score += 3;
  if (template.frameworkKey === "testimonial" && form.testimonialQuote) score += 3;
  if ((template.frameworkKey === "reasons_why" || template.frameworkKey === "iphone_notes" || template.frameworkKey === "features_and_benefits") && (form.mainFeatures || "").split(/\n|,/).filter(Boolean).length >= 3) score += 2;
  return score;
}

function deterministicReason(template) {
  const byFramework = {
    question: "Your product description reads like it answers a question your customer is already asking.",
    offer: "You've supplied a real, current offer — this framework leads with it.",
    testimonial: "You have a real customer quote, which this framework is built to showcase.",
    reasons_why: "Your main features give this framework enough real reasons to list.",
    iphone_notes: "A relatable 'note to self' framing works well with your listed features.",
    features_and_benefits: "You have concrete features that map to clear customer benefits.",
    before_and_after: "A before/after framing can work well if you can supply real before/after evidence.",
    bold_claim: "If you have one strong, defensible claim, this framework leads with it.",
    us_vs_them: "If you have a genuine comparison point, this framework makes it visual.",
    sticky_notes: "A handful of short, likeable selling points suit this friendly layout."
  };
  return byFramework[template.frameworkKey] || "This is a solid general-purpose layout for your product.";
}

/**
 * Returns up to 3 recommended templates (PART 9), each with a rank and a
 * concise, customer-facing reason. `templates` must already be the eligible
 * (proof-safe) ACTIVE catalog for this request — see the /image/recommend
 * route, which fetches it from templateCatalog before calling this.
 */
async function recommendTemplates({ templates, form }) {
  const eligible = templates.filter((t) => isEligible(t, form));
  const scored = eligible
    .map((t) => ({ template: t, score: baseScore(t, form) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3)
    .map((entry, i) => ({ templateId: entry.template.id, rank: i + 1, reason: deterministicReason(entry.template) }));

  const config = getPlannerConfig();
  if (!config.apiKeyConfigured || config.provider === "mock" || !scored.length) {
    return { recommendations: scored, aiUsed: false };
  }

  // Optional AI polish: only allowed to REWRITE the `reason` text for
  // clarity/warmth and re-ORDER the same 3 (already proof-safe) candidates —
  // never allowed to introduce a new templateId that wasn't already
  // deterministically eligible.
  try {
    const prompt = [
      "You are Brandee, a marketing assistant. Given a product and up to 3 pre-approved ad template candidates, write one short, warm, customer-facing sentence explaining why each fits — 1 sentence, under 25 words, no invented facts, no ratings/awards/guarantees.",
      `Product: ${form.productName}. Description: ${form.productDescription}. Target customer: ${form.targetCustomer}.`,
      `Candidates (in current rank order): ${scored.map((s) => `${s.templateId}`).join(", ")}`,
      "Return ONLY JSON: { \"recommendedTemplateIds\": [ { \"templateId\": string, \"rank\": number, \"reason\": string } ] } using ONLY the candidate templateIds already given, same set, you may reorder."
    ].join("\n");
    const result = await callPlanningModel(prompt, { timeoutMs: 6000 });
    if (result?.recommendedTemplateIds?.length) {
      const allowedIds = new Set(scored.map((s) => s.templateId));
      const filtered = result.recommendedTemplateIds.filter((r) => allowedIds.has(r.templateId)).slice(0, 3);
      if (filtered.length === scored.length) {
        return { recommendations: filtered.map((r, i) => ({ templateId: r.templateId, rank: i + 1, reason: String(r.reason || "").slice(0, 160) || deterministicReason(eligible.find((t) => t.id === r.templateId)) })), aiUsed: true };
      }
    }
  } catch {
    // Any AI failure silently keeps the deterministic recommendations.
  }
  return { recommendations: scored, aiUsed: false };
}

module.exports = { recommendTemplates, isEligible };
