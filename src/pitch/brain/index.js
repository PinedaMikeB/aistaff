"use strict";

const { OpenAiRealtimeBrain } = require("./openai-realtime");
const { GeminiLiveBrain } = require("./gemini-live");
const { config } = require("../config");

/**
 * Brain provider selection.
 *
 * Follows the existing AI_PROVIDER pattern in src/ai.js. Adding Gemini Live
 * later means implementing the same small surface — connect(), write(pcm8k),
 * greet(), close(), and the events audio / barge_in / transcript / error —
 * and registering it here. No call-handling code should need to change.
 */
function createBrain({ callerId, tools } = {}) {
  const shared = {
    businessName: config.business.name,
    agentName: config.business.agentName,
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

    default:
      throw new Error(`PITCH: unknown PITCH_BRAIN_PROVIDER "${config.brainProvider}"`);
  }
}

module.exports = { createBrain };
