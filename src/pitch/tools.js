"use strict";

const { config } = require("./config");
const { createMessengerBooking } = require("../messenger-webhook");

/**
 * Tools available to Pitch during a call.
 *
 * Follows the rule from docs/handoff-masterplan.md: tools do things and
 * return FACTS. They never return words to speak. `send_sms` takes the
 * message the MODEL composed — so a Taglish call produces a Taglish text —
 * and returns {sent: true} or a reason, leaving the model to say whatever
 * fits the moment.
 *
 * `book_appointment` reuses the exact same booking creation logic the
 * Messenger/Facebook side already uses (createMessengerBooking, in
 * messenger-webhook.js) — same database table, same admin Bookings
 * calendar, same conflict checking. Calls just have a phone number and a
 * voice instead of a Facebook conversation, so `conversation_id` is left
 * null and `source` is "pitch" instead of "messenger" for that one row.
 *
 * Guardrails live HERE, in code, not in the prompt:
 *   - one SMS per call by default (a model with an unlimited messaging tool
 *     is a liability)
 *   - length enforced rather than silently truncated by the SIM
 *   - recipient defaults to the verified caller ID from the INVITE
 */

function declarations() {
  const list = [];
  if (config.sms.enabled) {
    list.push({
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
    });
  }
  list.push({
    name: "book_appointment",
    description:
      "Create a real booking on the calendar once the caller has given you " +
      "a name, what the booking is for, and an exact date and time. Only " +
      "call this once you actually have those details — ask for whichever " +
      "one is still missing instead of guessing.",
    parameters: {
      type: "OBJECT",
      properties: {
        customer_name: {
          type: "STRING",
          description: "The caller's name, as they gave it.",
        },
        service_name: {
          type: "STRING",
          description: "What the booking is for, e.g. \"Table for two\", \"Room booking\", \"Consultation\".",
        },
        start_at: {
          type: "STRING",
          description:
            "Exact local date and time as YYYY-MM-DDTHH:MM (24-hour). Resolve " +
            "relative dates like \"tomorrow\" or \"Friday\" to an actual date yourself " +
            "before calling this.",
        },
        party_size: {
          type: "STRING",
          description: "Number of people, if relevant to this kind of booking. Omit if not applicable.",
        },
        notes: {
          type: "STRING",
          description: "Any other detail the caller gave — seating preference, occasion, special request.",
        },
      },
      required: ["customer_name", "service_name", "start_at"],
    },
  });
  return list;
}

/**
 * Execute a tool call. Returns a plain facts object for the model.
 * `state` is per-call scratch so limits survive across turns.
 */
async function execute({ name, args, ua, callerId, companyId, callId, state, log }) {
  if (name === "send_sms") return executeSendSms({ args, ua, callerId, state, log });
  if (name === "book_appointment") return executeBookAppointment({ args, callerId, companyId, callId, log });
  return { error: "unknown_tool", detail: `no tool named ${name}` };
}

async function executeSendSms({ args, ua, callerId, state, log }) {
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

async function executeBookAppointment({ args, callerId, companyId, callId, log }) {
  if (!companyId) {
    return { booked: false, reason: "no_company_configured" };
  }

  const fieldValues = {};
  if (args.party_size) fieldValues.party_size = String(args.party_size).slice(0, 40);

  try {
    const result = await createMessengerBooking({
      companyId,
      conversationId: null,
      lead: null,
      request: {
        customer_name: args.customer_name,
        mobile: callerId || null,
        service_name: args.service_name,
        start_at: args.start_at,
        field_values: fieldValues,
        notes: args.notes || null,
        source_call_id: callId || null,
      },
      source: "pitch",
    });

    if (!result.ok) {
      log.info(`booking: not created — ${result.reason}`);
      return { booked: false, reason: result.reason };
    }

    log.info(`booking: ${result.reused ? "reused existing" : "created"} — ${result.booking.id} (${result.booking.service_name} @ ${result.booking.start_at})`);
    return {
      booked: true,
      reused: !!result.reused,
      booking_id: result.booking.id,
      service_name: result.booking.service_name,
      start_at: result.booking.start_at,
      status: result.booking.status,
    };
  } catch (err) {
    log.error(`booking: failed — ${err.message}`);
    return { booked: false, reason: "create_failed", detail: err.message };
  }
}

module.exports = { declarations, execute };
