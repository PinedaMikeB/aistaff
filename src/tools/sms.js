/**
 * send_sms — shared between Pitch (live call) and the public demo.
 *
 * SAME capability, DIFFERENT exposed parameters, because the two scopes have
 * different proof of who owns the number:
 *
 *   PITCH — the caller is ON the line. `callerId` comes from the SIP INVITE,
 *           so they demonstrably control it. `to_number` is offered as an
 *           override for "text my other phone".
 *
 *   DEMO  — an anonymous stranger typed a number into a public form. The
 *           recipient is pinned to the DemoSession and `to_number` is NOT in
 *           the schema at all, so the model cannot choose one. Not primarily a
 *           safety fence: if a demo text lands on a stranger's phone, the
 *           prospect never sees the payoff and the demo fails at its job.
 *
 * The model composes the message itself, in whatever language the person used.
 * No templates, no language flag — a Taglish conversation produces a Taglish
 * text (docs/handoff-masterplan.md).
 */

const { SCOPES, defineTool } = require("./registry");
const { normalizePhone } = require("../phone");

const MAX_CHARS = 300;
const DEMO_SMS_PER_SESSION = 1;
const DEMO_SMS_PER_DAY = 25;

// Budget guard, not a spam guard — at 5-25/day carrier filtering is not the
// risk; an unbounded loop burning credits is. Resets daily, in memory: a
// restart clearing it is acceptable for a ceiling this size.
const dailyCounter = { day: null, sent: 0 };

function today() {
  return new Date().toISOString().slice(0, 10);
}

function bumpDaily() {
  if (dailyCounter.day !== today()) {
    dailyCounter.day = today();
    dailyCounter.sent = 0;
  }
  dailyCounter.sent += 1;
  return dailyCounter.sent;
}

function dailyRemaining() {
  if (dailyCounter.day !== today()) return DEMO_SMS_PER_DAY;
  return Math.max(0, DEMO_SMS_PER_DAY - dailyCounter.sent);
}

/** PH mobile only. No short codes, no premium, no international. */
function isSendablePhMobile(e164) {
  return typeof e164 === "string" && /^\+639\d{9}$/.test(e164);
}

defineTool({
  name: "send_sms",
  description:
    "Send a text message to the person you are talking to. Use it only when " +
    "they have agreed to receive one. Compose the message yourself, in the " +
    "same language they are using. Do not send anything they did not ask for.",
  parameters: {
    type: "object",
    properties: {
      message: {
        type: "string",
        description:
          `The full text to send, at most ${MAX_CHARS} characters. Write it ` +
          "yourself in the language the person is using."
      },
      to_number: {
        type: "string",
        description:
          "Only when the person asks for the text to go to a DIFFERENT number " +
          "than the one they are calling from. Otherwise omit it."
      }
    },
    required: ["message"]
  },
  scopes: [SCOPES.PITCH, SCOPES.DEMO],
  // The demo model never even SEES to_number — the recipient is the session's
  // number, decided in code.
  hideParams: { demo: ["to_number"] },

  guard: async (args, ctx) => {
    const message = String(args.message || "").trim();
    if (!message) return { reason: "empty_message" };
    if (message.length > MAX_CHARS) {
      return { reason: "too_long", max_characters: MAX_CHARS, actual_characters: message.length };
    }
    if (ctx.scope === SCOPES.DEMO) {
      if ((ctx.smsSent || 0) >= DEMO_SMS_PER_SESSION) {
        return { reason: "limit_reached", limit: DEMO_SMS_PER_SESSION };
      }
      if (dailyRemaining() <= 0) return { reason: "daily_limit_reached" };
      if (!isSendablePhMobile(ctx.mobileNumber)) {
        return { reason: "no_verified_mobile_on_file" };
      }
    }
    return null;
  },

  handler: async (args, ctx) => {
    if (!ctx.sendSms) return { sent: false, reason: "sms_transport_unavailable" };

    // Recipient resolution is the whole security difference between scopes.
    const to = ctx.scope === SCOPES.DEMO
      ? ctx.mobileNumber
      : normalizePhone(args.to_number || ctx.callerId) || String(ctx.callerId || "").trim();

    if (!to) return { sent: false, reason: "no_usable_number" };

    try {
      await ctx.sendSms(to, String(args.message).trim());
      if (ctx.scope === SCOPES.DEMO) bumpDaily();
      return { sent: true, to };
    } catch (error) {
      return { sent: false, reason: "send_failed", detail: error.message };
    }
  }
});

module.exports = { MAX_CHARS, DEMO_SMS_PER_SESSION, DEMO_SMS_PER_DAY, isSendablePhMobile, dailyRemaining };
