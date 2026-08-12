"use strict";

const { config } = require("./config");

/**
 * Tools available to Pitch during a call.
 *
 * Follows the rule from docs/handoff-masterplan.md: tools do things and
 * return FACTS. They never return words to speak. `send_sms` takes the
 * message the MODEL composed — so a Taglish call produces a Taglish text —
 * and returns {sent: true} or a reason, leaving the model to say whatever
 * fits the moment.
 *
 * Guardrails live HERE, in code, not in the prompt:
 *   - one SMS per call by default (a model with an unlimited messaging tool
 *     is a liability)
 *   - length enforced rather than silently truncated by the SIM
 *   - recipient defaults to the verified caller ID from the INVITE
 */

function declarations() {
  if (!config.sms.enabled) return [];
  return [{
    name: "send_sms",
    description:
      "Send a text message to the caller. Only use this after the caller has " +
      "agreed to receive a text. Compose the message yourself in the same " +
      "language the caller is speaking. Do not use this to send anything the " +
      "caller did not ask for.",
    parameters: {
      type: "OBJECT",
      properties: {
        message: {
          type: "STRING",
          description:
            `The full text to send, at most ${config.sms.maxChars} characters. ` +
            "Write it yourself in the caller's language.",
        },
        to_number: {
          type: "STRING",
          description:
            "Only set this if the caller asked for the text to go to a " +
            "DIFFERENT number than the one they are calling from. Otherwise " +
            "omit it and their caller ID is used.",
        },
      },
      required: ["message"],
    },
  }];
}

/**
 * Execute a tool call. Returns a plain facts object for the model.
 * `state` is per-call scratch so limits survive across turns.
 */
async function execute({ name, args, ua, callerId, state, log }) {
  if (name !== "send_sms") {
    return { error: "unknown_tool", detail: `no tool named ${name}` };
  }
  if (!config.sms.enabled) {
    return { sent: false, reason: "sms_disabled" };
  }

  const message = String(args.message || "").trim();
  if (!message) return { sent: false, reason: "empty_message" };
  if (message.length > config.sms.maxChars) {
    return {
      sent: false,
      reason: "too_long",
      max_characters: config.sms.maxChars,
      actual_characters: message.length,
    };
  }

  state.smsSent = state.smsSent || 0;
  if (state.smsSent >= config.sms.maxPerCall) {
    return { sent: false, reason: "limit_reached", limit: config.sms.maxPerCall };
  }

  const to = String(args.to_number || callerId || "").trim();
  if (!/\d{7,}/.test(to)) {
    return { sent: false, reason: "no_usable_number" };
  }

  try {
    await ua.sendMessage(to, message);
    state.smsSent += 1;
    log.info(`sms: sent to ${to} (${message.length} chars)`);
    return { sent: true, to };
  } catch (err) {
    log.error(`sms: failed — ${err.message}`);
    return { sent: false, reason: "send_failed", detail: err.message };
  }
}

module.exports = { declarations, execute };
