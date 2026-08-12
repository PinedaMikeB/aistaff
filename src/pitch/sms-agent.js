"use strict";

const { config } = require("./config");
const { log } = require("./log");

/**
 * Pitch over SMS — replies to texts the customer sent first.
 *
 * Deliberately NOT the Gemini Live brain. Live is a speech-to-speech session
 * billed at audio rates; texting through it would be slow and expensive.
 * This uses a normal Gemini text call instead.
 *
 * Same two rules as the voice side:
 *   1. No language setting. The model reads how they wrote and answers the
 *      same way — English, Tagalog, Taglish, whatever they used.
 *   2. No scripted copy. The model writes every word, including how it says
 *      "this is my last text, please call instead".
 *
 * State is IN MEMORY for now — a restart forgets every thread. Persisting it
 * (and greeting people by name) needs the external_id migration.
 */

const THREADS = new Map();

// Honoured however they are written, in either language.
const STOP_WORDS = /\b(stop|unsubscribe|tigil|ayaw|huwag|wag na|opt out)\b/i;

function todayKey() {
  return new Date().toLocaleDateString("en-PH", { timeZone: "Asia/Manila" });
}

function inQuietHours(now = new Date()) {
  const hour = Number(now.toLocaleString("en-PH", {
    timeZone: "Asia/Manila", hour: "2-digit", hour12: false,
  }));
  const { quietStartHour: start, quietEndHour: end } = config.sms;
  return start > end ? (hour >= start || hour < end) : (hour >= start && hour < end);
}

function getThread(number) {
  const existing = THREADS.get(number);
  const now = Date.now();
  if (existing && now - existing.lastAt < config.sms.threadIdleMs) {
    if (existing.day !== todayKey()) {
      existing.day = todayKey();
      existing.sentToday = 0;
    }
    return existing;
  }
  const fresh = {
    number, messages: [], sentToday: 0, day: todayKey(),
    lastAt: now, rapidCount: 0, stopped: false,
  };
  THREADS.set(number, fresh);
  return fresh;
}

/**
 * The SMS persona. Principles only — every word the customer reads is the
 * model's, so a Taglish text gets a Taglish answer with no template anywhere.
 */
function buildSmsPrompt({ businessName, agentName, thread, lastAllowedReply }) {
  return `
You are ${agentName}, answering text messages for ${businessName}, a business in
the Philippines. Someone has texted this number.

## Language
Read how they wrote and answer the same way. If they text in English, answer in
English. Tagalog, answer in Tagalog. Taglish — the natural mix most Filipinos
use — answer in that same mix. Never announce or comment on which language you
are using, and never ask them to pick one. If they switch, switch with them.

## Manner
- This is SMS. Be brief. One or two sentences is usually right, and you must
  stay under ${config.sms.maxChars} characters including spaces.
- Warm and respectful, the way a good staff member texts. Filipino phone
  manners are friendly but not effusive. Use "po" naturally if they do, or if
  the tone calls for it — but do not force it into every sentence.
- No greeting boilerplate on every message. You are mid-conversation.
- Never use emoji unless they used one first.

## Honesty
- If asked whether you are a person, say plainly that you are an AI assistant
  for ${businessName}. Never claim to be human.
- Answer only from what you actually know. If you do not know a price, a
  schedule, or whether something is available, say so and offer to have someone
  follow up, or invite them to call.
- Never confirm a booking, a price, or a commitment as final.
- You cannot see any previous phone call. Do not pretend to remember one.

## Identity
- You know their mobile number because they texted from it. Never ask for it.
- Do not ask for their name unless you genuinely need it. If they give it, use
  it naturally — not in every message.
${lastAllowedReply ? `
## This is your last text in this thread
You have reached the limit of replies you can send right now. In THIS message,
finish what you were saying and let them know they can call this same number to
continue, or that you will pick it up when they text again later. Say it in your
own words, in their language, without sounding like an error message. Do not
send anything after this.` : ""}

## The conversation so far
${thread.messages.map((m) => `${m.role === "them" ? "Them" : "You"}: ${m.text}`).join("\n")}

Write only the text message to send. No quotes, no labels, no preamble.
`.trim();
}

async function generateReply({ thread, lastAllowedReply }) {
  const model = config.gemini.textModel;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${encodeURIComponent(config.gemini.apiKey)}`;

  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{
        role: "user",
        parts: [{
          text: buildSmsPrompt({
            businessName: config.business.name,
            agentName: config.business.agentName,
            thread, lastAllowedReply,
          }),
        }],
      }],
      // Headroom: some models spend part of the budget reasoning before they
      // write, and a truncated SMS is worse than a slow one.
      generationConfig: { temperature: 0.9, maxOutputTokens: 400 },
    }),
  });

  const data = await res.json();
  if (data.error) throw new Error(data.error.message || "gemini text error");
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || "").join("").trim();
  if (!text) throw new Error("empty reply from model");
  return text;
}

/**
 * Handle one inbound SMS. Every guard here is code, not prompt text.
 */
async function handleInbound({ from, text, ua }) {
  if (!config.sms.enabled || !config.sms.replyEnabled) return;

  const thread = getThread(from);
  const now = Date.now();
  const gap = now - thread.lastAt;
  thread.lastAt = now;
  thread.messages.push({ role: "them", text });
  if (thread.messages.length > 20) thread.messages = thread.messages.slice(-20);

  log.info(`sms: from ${from} — ${text.slice(0, 60)}`);

  // A stop request is absolute and needs no model.
  if (STOP_WORDS.test(text)) {
    thread.stopped = true;
    log.info(`sms: ${from} asked to stop — no further replies`);
    return;
  }
  if (thread.stopped) return;

  // Loop guard: replies arriving faster than a person types, repeatedly.
  thread.rapidCount = gap < config.sms.loopWindowMs ? thread.rapidCount + 1 : 0;
  if (thread.rapidCount >= config.sms.maxRapidExchanges) {
    log.warn(`sms: ${from} looks like an auto-responder loop — holding off`);
    return;
  }
  if (thread.sentToday >= config.sms.maxPerThreadPerDay) {
    log.warn(`sms: ${from} hit the daily thread limit`);
    return;
  }
  if (inQuietHours()) {
    log.info(`sms: quiet hours — not replying to ${from} now`);
    return;
  }

  // How many we may send for THIS inbound message.
  const budget = Math.min(
    config.sms.maxPerInbound,
    config.sms.maxPerThreadPerDay - thread.sentToday
  );

  for (let i = 0; i < budget; i++) {
    // Warn them inside the final message, since afterwards we cannot text.
    const lastAllowed = i === budget - 1;
    let reply;
    try {
      reply = await generateReply({ thread, lastAllowedReply: lastAllowed });
    } catch (err) {
      log.error(`sms: could not generate a reply — ${err.message}`);
      return;
    }

    if (reply.length > config.sms.maxChars) reply = reply.slice(0, config.sms.maxChars).trim();

    try {
      await ua.sendMessage(from, reply);
      thread.sentToday += 1;
      thread.messages.push({ role: "us", text: reply });
      log.info(`sms: replied to ${from} (${reply.length} chars)`);
    } catch (err) {
      log.error(`sms: send failed to ${from} — ${err.message}`);
      return;
    }

    // Only continue to a second message if the model clearly left it hanging.
    if (!/[,:;]$|\.\.\.$/.test(reply)) break;
  }
}

/** Wipe a thread — used by tests and by an operator kill switch. */
function forget(number) {
  if (number) THREADS.delete(number); else THREADS.clear();
}

module.exports = { handleInbound, forget, inQuietHours, getThread, STOP_WORDS };
