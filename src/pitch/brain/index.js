"use strict";

const { OpenAiRealtimeBrain } = require("./openai-realtime");
const { GeminiLiveBrain } = require("./gemini-live");
const { LocalPipelineBrain } = require("./local-pipeline");
const { config } = require("../config");

/**
 * Brain provider selection.
 *
 * Follows the existing AI_PROVIDER pattern in src/ai.js. Adding Gemini Live
 * later means implementing the same small surface — connect(), write(pcm8k),
 * greet(), close(), and the events audio / barge_in / transcript / error —
 * and registering it here. No call-handling code should need to change.
 */
function createBrain({ callerId, tools, tenant, inbox } = {}) {
  // A claimed phone line uses its tenant's own name and greeting
  // (Settings > Channels > Mobile Phone); otherwise AI Studio's defaults.
  const p = (tenant && tenant.pitch) || {};
  const shared = {
    businessName: (tenant && tenant.businessName) || config.business.name,
    agentName: p.agent_name || config.business.agentName,
    tenant,
    // Per-call, not config: what the INVITE presented for this caller.
    callerId,
    tools,
  };

  switch (config.brainProvider) {
    case "openai":
      if (!config.openai.apiKey) {
        throw new Error("PITCH: OPENAI_API_KEY is required for the openai brain provider");
      }
      return new OpenAiRealtimeBrain({
        apiKey: config.openai.apiKey,
        model: config.openai.realtimeModel,
        voice: config.openai.voice,
        ...shared,
      });

    case "gemini":
      if (!config.gemini.apiKey) {
        throw new Error("PITCH: GEMINI_API_KEY is required for the gemini brain provider");
      }
      return new GeminiLiveBrain({
        apiKey: config.gemini.apiKey,
        model: config.gemini.liveModel,
        voice: config.gemini.voice,
        ...shared,
      });

    case "local":
    case "local-pipeline":
      return new LocalPipelineBrain({
        geminiApiKey: config.gemini.apiKey,
        openaiApiKey: config.openai.apiKey,
        // Tenant greeting + tenant hint words (Settings > Channels > Mobile Phone) on top of
        // AI Studio's global ASR context. The ASR gets the combined list on every request.
        localConfig: Object.assign({}, config.localPipeline,
          p.greeting ? { greetingText: p.greeting } : {},
          Array.isArray(p.asr_words) && p.asr_words.length
            ? { asrContext: [config.localPipeline.asrContext, p.asr_words.join(", ")].filter(Boolean).join(", ") }
            : {}),
        businessName: shared.businessName,
        agentName: shared.agentName,
        callerId: shared.callerId,
        tenant,
        inbox,
      });

    default:
      throw new Error(`PITCH: unknown PITCH_BRAIN_PROVIDER "${config.brainProvider}"`);
  }
}

module.exports = { createBrain };
