// Environment-driven model configuration for Brandee.
//
// Adds BRANDEE_EXTRACTION_*/BRANDEE_PLANNER_* variables so extraction (cheap,
// factual normalization) and planning (creative strategy) can be pointed at
// different providers/models independently of each other and of the rest of
// the app's Messenger AI pipeline (src/ai.js), while still falling back to
// the already-configured AI_PROVIDER/OPENAI_MODEL/GEMINI_MODEL so nothing
// breaks for an existing deployment that only ever set the generic vars.
//
// Deliberately does NOT hard-code a specific model name as a default (e.g.
// "gpt-5-mini") — this repo's actually-configured model is whatever
// OPENAI_MODEL/GEMINI_MODEL already is, and defaulting to an unverified
// model name could silently point production at a model the connected
// account doesn't have access to.

function getExtractionConfig() {
  const provider = process.env.BRANDEE_EXTRACTION_PROVIDER || process.env.AI_PROVIDER || "mock";
  const model = process.env.BRANDEE_EXTRACTION_MODEL
    || (provider === "gemini" ? process.env.GEMINI_MODEL : process.env.OPENAI_MODEL)
    || null;
  return {
    provider,
    model,
    apiKeyConfigured: provider === "gemini" ? Boolean(process.env.GEMINI_API_KEY) : Boolean(process.env.OPENAI_API_KEY)
  };
}

function getPlannerConfig() {
  const provider = process.env.BRANDEE_PLANNER_PROVIDER || process.env.AI_PROVIDER || "mock";
  const model = process.env.BRANDEE_PLANNER_MODEL
    || (provider === "gemini" ? process.env.GEMINI_MODEL : process.env.OPENAI_MODEL)
    || null;
  const fallbackModel = process.env.BRANDEE_PLANNER_FALLBACK_MODEL || null;
  return {
    provider,
    model,
    fallbackModel,
    apiKeyConfigured: provider === "gemini" ? Boolean(process.env.GEMINI_API_KEY) : Boolean(process.env.OPENAI_API_KEY)
  };
}

module.exports = { getExtractionConfig, getPlannerConfig };
