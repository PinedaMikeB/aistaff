/**
 * Which model runs which function.
 *
 * Built 2026-08-18. Model choices were spread across .env and code defaults and
 * had already drifted: GEMINI_MODEL still read "gemini-1.5-flash", which is
 * what a provider switch would silently have used. Nobody chose that.
 *
 * Now: one table, one screen, no deploy. The catalogue below is for the
 * dropdown and the cost column — it is a convenience list, not a whitelist, so
 * a model released next week can be typed in without a migration.
 *
 * Prices are USD per 1M tokens, checked 2026-08-18. They change; the note field
 * records when each was last verified.
 */

const { prisma } = require("./db");

/** Every AI call in the product, so nothing is invisible. */
const FUNCTIONS = [
  { fn: "closer_reply", label: "Closer conversation", detail: "Every Messenger and website reply. Large prompt, short answer — input price dominates.", provider: "openai", model: "gpt-4.1-mini" },
  { fn: "upload_relevance", label: "Upload relevance check", detail: "Decides whether an uploaded file matches the wizard step.", provider: "openai", model: "gpt-4.1-mini" },
  { fn: "rate_structuring", label: "Rate card to rows", detail: "Flattens a courier matrix into editable shipping rows.", provider: "openai", model: "gpt-4.1-mini" },
  { fn: "vision_extract", label: "Price list reading (vision)", detail: "Reads prices off photos, posters and PDFs. Needs a vision-capable model.", provider: "gemini", model: "gemini-3.5-flash-lite", vision: true },
  { fn: "demo_agent", label: "Demo agent", detail: "The opt-in prospect demo. No longer on the webhook path.", provider: "gemini", model: "gemini-3.5-flash-lite" },
  { fn: "faq_generation", label: "Question and FAQ suggestions", detail: "Anticipates what customers will ask and drafts qualification questions. Runs on demand in the wizard, not per message.", provider: "openai", model: "gpt-4.1-mini" }
];

/**
 * Catalogue for the dropdown. `inCents` / `outCents` are USD cents per 1M
 * tokens, so the UI can show what a change costs.
 *
 * NOTE ON GEMINI 3.x PRICING: $0.75/$3.75 is INTRODUCTORY and expires
 * 31 Dec 2026, doubling to $1.50/$7.50 on 1 Jan 2027. Budget on the 2027 rate
 * for anything meant to still be running next year.
 */
const CATALOGUE = [
  { provider: "openai", model: "gpt-5.6-luna", label: "GPT-5.6 Luna", inCents: 20, outCents: 120, note: "Cheapest of the current options. Already runs the site chat widget." },
  { provider: "openai", model: "gpt-4.1-mini", label: "GPT-4.1 mini", inCents: 40, outCents: 160, note: "What Closer runs today." },
  { provider: "openai", model: "gpt-5-mini", label: "GPT-5 mini", inCents: null, outCents: null, note: "Used by Brandee extraction. Confirm current price before switching Closer." },
  { provider: "gemini", model: "gemini-3.1-flash-lite", label: "Gemini 3.1 Flash-Lite", vision: true, inCents: 25, outCents: 150, note: "Cheap, fast." },
  { provider: "gemini", model: "gemini-3.5-flash-lite", label: "Gemini 3.5 Flash-Lite", vision: true, inCents: null, outCents: null, note: "Current vision and demo model. Measured clean Taglish." },
  { provider: "gemini", model: "gemini-3.7-flash", label: "Gemini 3.7 Flash", vision: true, inCents: 75, outCents: 375, note: "INTRO price to 31 Dec 2026, then 150/750. Strong at coding and agents." },
  { provider: "gemini", model: "gemini-3-flash", label: "Gemini 3 Flash", vision: true, inCents: 50, outCents: 300, note: "Middle option." }
];

/** Reads fall back to the seeded default, so a missing row never breaks a reply. */
async function getModelFor(fn) {
  const fallback = FUNCTIONS.find((f) => f.fn === fn);
  try {
    const row = await prisma.modelSetting.findUnique({ where: { fn } });
    if (row) return { provider: row.provider, model: row.model };
  } catch (error) {
    console.warn("[model-registry] lookup failed for %s, using default: %s", fn, error.message);
  }
  return fallback
    ? { provider: fallback.provider, model: fallback.model }
    : { provider: "openai", model: "gpt-4.1-mini" };
}

async function ensureSeeded() {
  for (const f of FUNCTIONS) {
    await prisma.modelSetting.upsert({
      where: { fn: f.fn },
      update: {},
      create: { fn: f.fn, provider: f.provider, model: f.model, note: "Seeded from the value in use on 2026-08-18." }
    });
  }
}

async function listSettings() {
  await ensureSeeded();
  const rows = await prisma.modelSetting.findMany();
  const byFn = new Map(rows.map((r) => [r.fn, r]));
  return FUNCTIONS.map((f) => {
    const row = byFn.get(f.fn);
    const cat = CATALOGUE.find((c) => c.model === (row?.model || f.model));
    return {
      fn: f.fn,
      label: f.label,
      detail: f.detail,
      provider: row?.provider || f.provider,
      model: row?.model || f.model,
      updated_by: row?.updated_by || null,
      updated_at: row?.updated_at || null,
      vision: Boolean(f.vision),
      inCents: cat?.inCents ?? null,
      outCents: cat?.outCents ?? null
    };
  });
}

async function setModelFor({ fn, provider, model, updatedBy }) {
  const known = FUNCTIONS.find((f) => f.fn === fn);
  if (!known) return null;
  // Vision functions need a model that can read images. The dropdown offered
  // every model for every function, so "Price list reading (vision)" could be
  // set to a text-only model and every upload would fail. Guarded here rather
  // than only in the UI, since the API is callable directly.
  if (known.vision) {
    const entry = CATALOGUE.find((c) => c.model === model);
    if (!entry || !entry.vision) {
      return { error: `${model} cannot read images. Choose a vision-capable model for ${known.label}.` };
    }
  }
  const saved = await prisma.modelSetting.upsert({
    where: { fn },
    update: { provider, model, updated_by: updatedBy || null },
    create: { fn, provider, model, updated_by: updatedBy || null }
  });
  console.log("[model-registry] %s -> %s/%s by %s", fn, provider, model, updatedBy || "unknown");
  return saved;
}

module.exports = { FUNCTIONS, CATALOGUE, getModelFor, listSettings, setModelFor, ensureSeeded };
