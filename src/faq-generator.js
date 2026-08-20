/**
 * Anticipate the questions this business's customers will actually ask, then
 * check whether Closer can already answer them.
 *
 * WHY THIS IS THE MOST VALUABLE SCREEN IN THE WIZARD:
 *
 * Those questions get asked either way. Without this, they arrive one at a
 * time from real customers over weeks, with Closer failing each one before
 * anyone notices. This front-loads them into one sitting where the owner is
 * already paying attention.
 *
 * And the owner CONFIRMS every answer, which turns a model's guess into a
 * human-verified fact. Same safeguard as the upload flow — suggest, then
 * confirm — applied to the highest-value content in the product.
 *
 * TWO RULES THAT MATTER:
 *
 * 1. NEVER STORE "NA". If a row said `Q: May warranty ba? / A: NA`, Closer
 *    would treat "NA" as the fact and could say it to a customer. Not
 *    applicable is a SKIP, not an answer, and nothing is written.
 *
 * 2. NEVER STORE AN ANSWER TWICE. Questions already covered by the price list
 *    or shipping table are shown for verification but NOT saved as new rows.
 *    Two copies of a price drift apart the moment one is edited — exactly the
 *    problem found in AIStaff's own pricing entry.
 *
 * RULE 2 (masterplan): returns questions and a coverage verdict — facts. Any
 * answer stored is written by the OWNER, never by the model.
 */

const fetchImpl = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const { getModelFor } = require("./model-registry");
const { renderKnowledgeForPrompt } = require("./knowledge-base");

async function callModel(prompt) {
  const { provider, model } = await getModelFor("faq_generation");
  if (provider !== "openai" || !process.env.OPENAI_API_KEY) {
    throw new Error("FAQ generation needs an OpenAI model configured in AI Studio");
  }
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" }
  };
  // GPT-5.x rejects any temperature but the default — see §20.0.
  if (!/^gpt-5/i.test(model)) body.temperature = 0.3;

  const response = await fetchImpl("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI error ${response.status}: ${detail.slice(0, 200)}`);
  }
  const json = await response.json();
  return JSON.parse(json.choices?.[0]?.message?.content || "{}");
}

/**
 * Generate the questions, and mark which ones the knowledge base already
 * answers.
 *
 * The model does BOTH in one pass on purpose: it has the knowledge base in
 * front of it, so asking "is this already covered, and where" is nearly free,
 * and a second call would double the cost and the latency.
 */
async function generateFaqCheck({ company, knowledge, industryPack, count = 30 }) {
  const kbText = renderKnowledgeForPrompt(knowledge, new Date(), company?.id);

  const prompt = [
    "You are helping a business owner prepare their AI sales agent. Answer only with JSON.",
    "",
    `The business: ${company.name}${company.industry ? ` — ${company.industry}` : ""}.`,
    `Business type: ${industryPack || "general"}.`,
    "",
    "Their knowledge base:",
    kbText || "(empty)",
    "",
    `Task: list the ${count} questions REAL CUSTOMERS of this business are most likely to ask over Facebook Messenger.`,
    "Base them on what this business actually sells, not generic business questions.",
    "Write each question the way a Filipino customer would really type it, in the language they would use — Taglish where that is natural.",
    "Order them by how often they would be asked, most common first.",
    "",
    // Without this the model produces only questions it can already answer,
    // because the knowledge base is sitting in front of it. A run that says
    // "30 of 30 covered" is useless — the whole value is finding the gaps.
    "IMPORTANT: do not limit yourself to what the knowledge base covers. Include the awkward, practical and commercial questions customers ask before buying even when nothing here answers them — refunds, cancellation, contracts, onboarding time, support hours, data privacy, who to contact when something breaks, what happens if it does not work.",
    "A useful list has real gaps in it. If everything comes back covered, you have only asked the easy questions.",
    "",
    "For each question, decide whether the knowledge base above ALREADY answers it.",
    'Reply exactly: {"questions":[{"question":"...","covered":true|false,"source":"which entry answers it, or empty","suggested_category":"Pricing|Shipping|Policies|Availability|Promos|Business|Media"}]}',
    "",
    "covered = true only if the knowledge base genuinely contains the answer. If it is partly covered or you are unsure, use false — a false negative costs the owner one look, a false positive leaves a question their customers cannot get answered.",
    "Never write the answer yourself. The owner answers anything not covered."
  ].join("\n");

  const parsed = await callModel(prompt);
  const rows = Array.isArray(parsed.questions) ? parsed.questions : [];

  return rows
    .filter((q) => q && typeof q.question === "string" && q.question.trim())
    .slice(0, count)
    .map((q) => ({
      question: q.question.trim().slice(0, 300),
      covered: q.covered === true,
      source: typeof q.source === "string" ? q.source.slice(0, 120) : "",
      category: typeof q.suggested_category === "string" ? q.suggested_category.slice(0, 40) : "Business"
    }));
}

/**
 * Lead fields a qualification question may write to.
 *
 * A `field_key` only works if it matches a real Lead column. The screen let
 * owners type anything, one said "preferred_payment_method", and the reply
 * path crashed on every message (§20.0). Generation is now constrained to
 * this list, and anything else is stored as a note instead of being lost.
 */
const LEAD_FIELDS = [
  { key: "customer_name", label: "Their name" },
  { key: "company_name", label: "Their company name" },
  { key: "mobile_number", label: "Mobile number" },
  { key: "email", label: "Email" },
  { key: "location", label: "Location or area" },
  { key: "service_needed", label: "What they need" },
  { key: "budget", label: "Budget" },
  { key: "urgency", label: "How soon they need it" },
  { key: "notes", label: "Anything else (free note)" }
];

/**
 * Suggest qualification questions for this business.
 *
 * Runs AFTER identity and products are filled — generating from an empty
 * knowledge base produces generic questions, which is exactly the friction
 * this is meant to remove.
 */
async function generateQualificationQuestions({ company, knowledge, industryPack, count = 8 }) {
  const kbText = renderKnowledgeForPrompt(knowledge, new Date(), company?.id);

  const prompt = [
    "You are helping a business owner set up their AI sales agent. Answer only with JSON.",
    "",
    `The business: ${company.name}${company.industry ? ` — ${company.industry}` : ""}.`,
    `Business type: ${industryPack || "general"}.`,
    "",
    "Their knowledge base:",
    kbText || "(empty)",
    "",
    `Task: list up to ${count} questions the agent should ask a customer, in order, to turn a chat into a lead this business can actually follow up and sell to.`,
    "Ask only what THIS business needs. A Facebook clothing seller does not need a company name or a project location; a copier rental company does.",
    "Phrase each one conversationally, the way a helpful salesperson would ask it in Messenger — never like a form field.",
    "Put the easy, low-commitment questions first and contact details last. People give a phone number after they are interested, not before.",
    "",
    "Each question must store its answer in one of these fields:",
    LEAD_FIELDS.map((f) => `  ${f.key} — ${f.label}`).join("\n"),
    "Use notes for anything that does not fit another field.",
    "",
    'Reply exactly: {"questions":[{"question":"...","field_key":"...","required":true|false,"why":"one short line on why this helps close the sale"}]}'
  ].join("\n");

  const parsed = await callModel(prompt);
  const rows = Array.isArray(parsed.questions) ? parsed.questions : [];
  const valid = new Set(LEAD_FIELDS.map((f) => f.key));

  return rows
    .filter((q) => q && typeof q.question === "string" && q.question.trim())
    .map((q) => ({
      question: q.question.trim().slice(0, 300),
      // Anything unrecognised becomes a note rather than being dropped — the
      // question is still useful even if the field guess was wrong.
      field_key: valid.has(q.field_key) ? q.field_key : "notes",
      required: q.required !== false,
      why: typeof q.why === "string" ? q.why.slice(0, 160) : ""
    }))
    .slice(0, count);
}

module.exports = { generateFaqCheck, generateQualificationQuestions, LEAD_FIELDS };
