/**
 * Does this uploaded file actually belong in this step?
 *
 * Why this exists: uploading "Articles of Incorporation.pdf" to the PRICE LIST
 * step extracted "By laws" and offered it as product data. Nothing checked
 * whether the content matched what the step asked for, so a legal document
 * would have been saved as a price list and quoted to a customer.
 *
 * Design: WARN, never block. The client knows their business better than we
 * do — a "Rate Card" might legitimately look like a legal document. We say
 * what it looks like and let them decide. Blocking a correct upload is worse
 * than flagging an odd one.
 *
 * RULE 2: returns FACTS (a classification and what it appears to be), never a
 * customer-facing sentence. The wizard writes its own warning copy.
 */

const fetchImpl = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

/** What each step is actually asking for, in plain terms for the classifier. */
const STEP_EXPECTATIONS = {
  identity: "a description of the business: what it sells and who buys it",
  products: "products or services with their prices",
  promos: "a promotion, discount, bundle or special offer",
  media: "a description of a photo, poster or video",
  shipping: "delivery or shipping fees, areas served, or lead times",
  policies: "business policies: payment terms, returns, warranty, downpayment",
  availability: "stock levels, opening hours, or appointment availability",
  boundaries: "rules about what the agent must not say"
};

/**
 * Cheap deterministic pre-check for the pricing step. If the text plainly
 * contains money, it is relevant and we skip the model call entirely — most
 * uploads are legitimate, and paying for a classification on every one is
 * waste.
 */
function obviouslyHasPrices(text) {
  const t = String(text || "");
  if (/[₱$]\s?\d/.test(t)) return true;
  if (/\b(php|usd)\s?\d/i.test(t)) return true;
  // Three or more lines that end in a number: the shape of a price list.
  const priced = t.split("\n").filter((l) => /\d[\d,]{1,}(\.\d{2})?\s*$/.test(l.trim())).length;
  return priced >= 3;
}

async function checkRelevance({ stepId, filename, text }) {
  const expectation = STEP_EXPECTATIONS[stepId];
  if (!expectation) return { checked: false };

  const sample = String(text || "").trim().slice(0, 1500);
  if (sample.length < 20) return { checked: false };

  if (stepId === "products" && obviouslyHasPrices(sample)) {
    return { checked: true, matches: true, looksLike: null };
  }

  const prompt = [
    "You are classifying an uploaded business document. Answer only with JSON.",
    `The person was asked to upload: ${expectation}.`,
    `File name: ${filename}`,
    "File content follows between triple dashes.",
    "---",
    sample,
    "---",
    'Reply exactly: {"matches": true|false, "looks_like": "<3-6 word description of what this document actually is>"}',
    "matches is true if the content could reasonably be what was asked for.",
    "Do not explain. Do not add any other field."
  ].join("\n");

  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0
      })
    });
    if (!response.ok) return { checked: false };
    const json = await response.json();
    const parsed = JSON.parse(json.choices?.[0]?.message?.content || "{}");
    return {
      checked: true,
      matches: parsed.matches !== false,
      looksLike: typeof parsed.looks_like === "string" ? parsed.looks_like.slice(0, 80) : null
    };
  } catch (error) {
    // A classifier failure must never cost the client their upload.
    console.log("[intake-relevance] check failed: %s", error.message);
    return { checked: false };
  }
}

/**
 * Turn extracted rate-card text into structured rows.
 *
 * A courier rate card (J&T, LBC) is a MATRIX: weight bands down the side,
 * regions across the top, 30 cells. Flattening that by hand is 30 rows of
 * typing and a guaranteed transcription error, and a misread 115 vs 175 is a
 * wrong quote to a real customer.
 *
 * So the model flattens it and the CLIENT CHECKS IT. This returns rows, never
 * prose — the wizard renders them as editable fields, so a wrong cell is a
 * two-second fix rather than a silent error. Nothing here is stored unreviewed.
 *
 * RULE 2: returns FACTS (label/value/note triples), never a sentence for the
 * agent to recite.
 */
async function structureRows({ stepId, text }) {
  if (stepId !== "shipping") return null;
  const sample = String(text || "").trim().slice(0, 4000);
  if (sample.length < 20) return null;

  const prompt = [
    "Convert this shipping rate information into rows. Answer only with JSON.",
    "For a weight-by-region matrix, produce ONE row per combination.",
    'Each row: {"label": "region and weight band", "value": "the fee exactly as written", "note": "lead time if stated, else empty"}',
    "Copy amounts exactly. Never invent a rate that is not present.",
    "If the text is a general statement rather than a rate table, return an empty array.",
    'Reply exactly: {"rows": [...]}  Maximum 60 rows.',
    "---",
    sample,
    "---"
  ].join("\n");

  try {
    const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        messages: [{ role: "user", content: prompt }],
        response_format: { type: "json_object" },
        temperature: 0
      })
    });
    if (!response.ok) return null;
    const json = await response.json();
    const parsed = JSON.parse(json.choices?.[0]?.message?.content || "{}");
    if (!Array.isArray(parsed.rows)) return null;
    return parsed.rows
      .filter((r) => r && (r.label || r.value))
      .slice(0, 60)
      .map((r) => ({
        label: String(r.label || "").slice(0, 200),
        value: String(r.value || "").slice(0, 200),
        note: String(r.note || "").slice(0, 200)
      }));
  } catch (error) {
    // Falling back to the raw text is fine — it still reaches the agent as
    // prose. Losing the upload would not be.
    console.log("[intake-structure] failed: %s", error.message);
    return null;
  }
}

module.exports = { checkRelevance, structureRows, obviouslyHasPrices, STEP_EXPECTATIONS };
