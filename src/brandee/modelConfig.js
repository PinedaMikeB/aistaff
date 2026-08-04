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

// Image Ad template-workflow model configuration (creative planning +
// revision interpretation — GPT-5.6 Sol, per this codebase's existing
// "GPT-5.6 <name>" internal naming convention, see e.g. the site chat
// widget's GPT-5.6 Luna). Deliberately separate from getPlannerConfig()
// above, which is the OLDER whole-business marketing-plan planner
// (planner.js) — this is a narrower, template-workflow-specific model used
// for turning one product+template into a structured creative brief and for
// interpreting natural-language image revisions (imageWorkflow.js /
// creativePlanner.js). Falls back to the shared AI_PROVIDER/OPENAI_MODEL
// vars so it works out of the box in any environment that already has those
// configured, exactly like getExtractionConfig()/getPlannerConfig() do.
function getImageCreativePlanningConfig() {
  const provider = process.env.BRANDEE_PLANNING_PROVIDER || process.env.AI_PROVIDER || "mock";
  const model = process.env.BRANDEE_PLANNING_MODEL
    || (provider === "gemini" ? process.env.GEMINI_MODEL : process.env.OPENAI_MODEL)
    || null;
  const reasoningEffort = process.env.BRANDEE_PLANNING_REASONING_EFFORT || "medium";
  return {
    provider,
    model,
    reasoningEffort,
    apiKeyConfigured: provider === "gemini" ? Boolean(process.env.GEMINI_API_KEY) : Boolean(process.env.OPENAI_API_KEY)
  };
}

// GPT Image 2 (or whichever image-generation model is actually configured)
// — used only for the first low-resolution preview and for reference-image
// revision edits (PART 13/14/17). No image-generation provider is wired
// into this codebase's OpenAI usage anywhere else (verified), so this is a
// new, narrow integration; when no key/model is configured (the default in
// this environment) callers must fail HONESTLY (see imageGenProvider.js)
// rather than fabricate a result — the same posture already used for video
// generation (videoTeaserRenderer.js's probeVideoProviderAvailability).
function getImageGenConfig() {
  const provider = process.env.BRANDEE_IMAGE_PROVIDER || (process.env.OPENAI_API_KEY ? "openai" : "mock");
  const model = process.env.BRANDEE_IMAGE_MODEL || "gpt-image-2";
  return {
    provider,
    model,
    apiKeyConfigured: provider === "openai" ? Boolean(process.env.OPENAI_API_KEY) : false
  };
}

module.exports = { getExtractionConfig, getPlannerConfig, getImageCreativePlanningConfig, getImageGenConfig };
