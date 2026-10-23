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

const SAVE_CALLER = {
  name: "save_caller_details",
  description:
    "Save the caller's details with their phone number (always, no permission " +
    "question) so next time they are greeted by name and not asked again. Call it " +
    "once you have their name. Set consent=false ONLY if the caller asks you to " +
    "delete or not keep their details.",
  parameters: {
    type: "OBJECT",
    properties: {
      consent: { type: "BOOLEAN", description: "Leave out (saved). false only if the caller asked to delete their details." },
      name: { type: "STRING", description: "The caller's full name as they said it." },
      address_as: { type: "STRING", description: "How to address them, e.g. Ma'am Ana or Sir Jun." },
      organization: { type: "STRING", description: "Their company." },
      branch: { type: "STRING", description: "Their branch or site." },
      department: { type: "STRING", description: "Their department." },
    },
    required: ["name"],
  },
};

function declarations() {
  if (!config.sms.enabled) return [SAVE_CALLER];
  return [SAVE_CALLER, {
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
  if (name === "save_caller_details") {
    try {
      const result = await require("../contacts").saveCaller(process.env.PITCH_COMPANY_ID || null, callerId, {
        ...args, consent: !(args.consent === false || String(args.consent).toLowerCase() === "false"),
      });
      log.info(`contacts: save_caller_details consent=${args.consent} -> ${JSON.stringify(result)}`);
      return result;
    } catch (err) {
      log.error(`contacts: save failed — ${err.message}`);
      return { saved: false, reason: "save_failed" };
    }
  }
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
