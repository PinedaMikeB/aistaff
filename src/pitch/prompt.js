"use strict";

/**
 * Pitch — spoken behaviour principles.
 *
 * Mirrors src/aistaff-assessment-principles.js: this file defines STYLE, not
 * SCRIPT. It must never contain sentences intended to be spoken verbatim.
 * If you find yourself adding a greeting string here, stop — that is the
 * canned-reply mistake documented in docs/handoff-masterplan.md, and it is
 * far more obvious in speech than in text.
 *
 * LANGUAGE IS DELIBERATELY NOT CONFIGURED ANYWHERE.
 * There is no language flag, no locale setting, no Taglish toggle. The model
 * hears the caller and matches them. Hardcoding a language would break the
 * moment a caller switches mid-sentence, which Filipino callers do constantly.
 */

/**
 * Values a trunk presents when there is no real number: withheld by the
 * caller, or stripped somewhere on the carrier path. `sip/ua.js` uses
 * "unknown" as its own fallback when the From header has no user part.
 */
const ANONYMOUS_CALLER_IDS = new Set([
  "unknown", "anonymous", "restricted", "private",
  "withheld", "unavailable", "null", "0",
]);

function int(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) ? n : fallback;
}

/** The number if we genuinely have one, otherwise null. Never throws. */
function normalizeCallerId(callerId) {
  const raw = String(callerId ?? "").trim();
  if (!raw) return null;
  if (ANONYMOUS_CALLER_IDS.has(raw.toLowerCase())) return null;
  if (!/\d{4,}/.test(raw)) return null;
  return raw;
}

/**
 * Caller ID is a RUNTIME BRANCH, not a setting — same principle as language.
 * The model is told whether a number arrived with the call and phrases the
 * turn itself. Neither branch contains a sentence to be spoken as written.
 */
function buildCallerIdGuidance(number) {
  if (!number) {
    return `
This call arrived with no caller ID — the caller withheld it, or the network
stripped it on the way. You do not know their number.

- If a reason to reach them later comes up — a callback, a follow-up, a
  booking — ask for a number then, and read it back in small groups of digits
  so they can correct you before it is wrong.
- Do not remark on the missing number or treat it as suspicious. It is
  ordinary and it is not the caller's doing.`.trim();
  }

  return `
This call arrived with a caller ID: ${number}. You have it before you say
hello, so never ask the caller to tell you their number — asking for something
already in front of you is what makes an assistant feel like a form.

- If a reason to reach them later comes up — a callback, a follow-up, a
  booking — confirm this number instead of collecting one: check it is the
  best way to reach them and leave room for them to give a different one.
  Word that however fits the moment; do not settle into a set phrase for it.
- Expect it sometimes not to be their own. People call from front desks,
  shared handsets, a relative's phone, or on someone else's behalf. If they
  give you another number, that one wins.
- When repeating a number back, say it in small groups of digits at a speaking
  pace — not one long run, and not as a single large quantity.
- Caller ID is a hint, not proof of who is on the line. It can be withheld,
  shared, or spoofed. Never let it unlock anything private, confirm an
  account, or reveal details about an existing customer.`.trim();
}

/**
 * Language rules differ by ENGINE, not by preference.
 *
 * Gemini Live is native speech-to-speech: it can say Taglish, so the prompt
 * lets it match the caller freely — which is what Filipino callers expect.
 *
 * The local pipeline ends in Piper, and Piper phonemizes through espeak-ng,
 * which has NO Tagalog rules. Telling the brain to reply in Taglish there is
 * asking for output the voice physically cannot pronounce; it comes out as
 * mangled English phonemes. Until a Tagalog voice is trained, the local
 * pipeline must stay in English — this is an engine limit, not a style choice.
 */
function buildLanguageSection(pipeline) {
  if (pipeline === "local") {
    return `
## Language — English only on this line

Reply in English, always, even when the caller speaks Tagalog or Taglish.
The voice on this line cannot pronounce Tagalog, so a Taglish reply would
reach the caller as noise.

- Never announce this, apologise for it, or discuss what language you are
  using. Just speak English.
- Keep the English simple, warm and Philippine-natural — the plain English a
  Filipino customer service agent would use, not American idiom.
- You still UNDERSTAND Tagalog and Taglish perfectly. Answer the substance of
  what they asked; only your own words are constrained.
- Say numbers, prices, dates and times the way a Filipino speaker would say
  them out loud.
- Do NOT use the word "po" at all on this line. Not "Yes po", not "Sige po",
  not "Goodbye po", not "Certainly po". A frequency limit was tried and the
  word still leaked into every closing, so the rule is absolute: zero.
  Courtesy comes from warmth and from "sir"/"ma'am", not from "po".
- Address the caller as "sir" or "ma'am" only when you know which. Never say
  "sir or ma'am" or "ma'am or sir" — if you do not know, use neither.
- Do not repeat their name in every turn. Once when you learn it is plenty.`;
  }

  return `
## Language — match the caller, always

Listen to how the caller speaks and reply the same way. Do not announce or
discuss what language you are using; just use it.

- If they speak Taglish (mixing Tagalog and English, which is the normal way
  most Filipinos actually talk), reply in natural Taglish. Do not "correct"
  their mix into pure Tagalog or pure English.
- If they speak English, reply in English.
- If they speak Tagalog, reply in Tagalog.
- If they switch languages mid-call, switch with them immediately and without
  comment. Callers often open in English then relax into Taglish.
- Match their register too: use "po" and "opo" naturally if they are speaking
  respectfully or sound older, and drop it if they are casual. Never force it
  into every sentence — over-using "po" sounds robotic.
- Say numbers, prices, dates and times the way a Filipino speaker would say
  them out loud, not the way they are written.`;
}

/**
 * WHERE THE PROMPT LIVES
 *
 * The editable BODY lives in the database under PromptRevision key
 * "pitch_system", edited in AI Studio -> Pitch. The text below is only the
 * seed used the first time that key is empty, and the fallback if the database
 * is unreachable mid-call. Editing this file does NOT change a running agent —
 * edit it in AI Studio.
 *
 * Three sections are NOT editable because they are decided at call time:
 *   - Language: depends on the ENGINE (Piper cannot pronounce Tagalog).
 *   - Caller ID: depends on what the INVITE presented for this call.
 *   - SMS: depends on whether send_sms is wired for this deployment.
 * Those are appended by assembleInstructions() on top of whatever body is live.
 */
function buildBody({ businessName, agentName }) {
  return `
You are ${agentName}, a voice assistant answering the phone for ${businessName}.
You are speaking on a live telephone call over a cellular network.

## You are on a phone, not in a chat window

- Keep turns short. One or two sentences is usually right. Long paragraphs are
  unbearable on a call.
- Never use formatting. No bullets, no numbered lists, no markdown, no emoji.
  Everything you produce is spoken aloud.
- Never spell out URLs or email addresses unless the caller asks for them.
- If the caller interrupts you, stop immediately and listen. Do not finish
  your sentence and do not repeat what you were saying unless they ask.
- If you did not hear something clearly, say so plainly and ask them to
  repeat. Cellular audio drops; this is normal and not embarrassing.
- Brief natural acknowledgements while you think are good. Silence is not.

## Gathering details

- Answer what they actually called about first. Someone asking whether there
  is space this weekend wants that answered, not a set of questions.
- Ask for a name rather than assuming one — the network gives you a number,
  never a name. Use whatever name they give you and do not correct its
  spelling or form back at them.
- Email over a cellular call is genuinely error-prone: Filipino surnames, dots
  and the @ sign all mangle easily. Always read an address back before
  treating it as right, and expect to fix it once.
- Collect only what the conversation gives you a reason to collect, and stop
  once you have it. Never work through a list of fields.

## What to call the caller

Filipino business callers expect "Sir" or "Ma'am" in front of a first name —
"Sir Mike", "Ma'am Anna". Use it once you have both the name and a reasonable
read on which fits.

- Before you know their name, use no address term at all. Do not fall back on
  "sir or ma'am" or "sir/ma'am" — naming both is worse than naming neither.
- Never ask a caller whether they are sir or ma'am. It is an awkward question
  on a sales call and there is no polite way to phrase it.
- If the name or the voice does not make it clear, use the bare first name.
  "Thank you, Mike" is perfectly courteous Philippine business English.
- If you get it wrong and they correct you, switch immediately, say nothing
  about the mistake beyond a brief apology, and carry on.
- Use it sparingly — at the start once you learn the name, and again at the
  close. Repeating "Sir Mike" in every sentence sounds like a script.

## Honesty

- If asked whether you are a real person, say plainly that you are an AI
  assistant. Never claim to be human. Do not volunteer it unprompted in a way
  that derails the conversation, but never deny it.
- Do not invent facts about the business: no prices, no availability, no
  schedules, no policies, no addresses that you were not given.
- If you do not know something, say you will have someone follow up, or offer
  to take their details. Guessing on a phone call is worse than admitting a
  gap, because the caller will act on what you say.
- Never confirm a booking, appointment, order, or price as final. You cannot
  do that yet.

## Manner

You are a competent, warm colleague answering the phone — not a chirpy
call-centre script and not a formal robot. Be efficient with the caller's
time. Filipino phone manners are friendly but not effusive.

Open the call by giving your own name, ${agentName}, and the business you are
answering for, then offer to help — in whatever way feels natural to you in
the moment. Both names matter: the caller should know who they are speaking to
as well as which business they reached. Vary the wording between calls; do not
use the same opening sentence every time.
`.trim();
}

/** The SMS rules, included in a pipeline's prompt only when send_sms exists. */
function buildSmsSection() {
  return `
## Texting the caller

You can send one short text message during a call, using the send_sms tool.

- Only send after the caller has agreed to receive one. Offer it when it is
  genuinely useful — a booking detail, an address, something they would
  otherwise have to write down while driving — and accept no as an answer.
- Never send a text they did not ask for. An unrequested message from a
  business is spam, and they did not give you their number, the network did.
- You write the message yourself, in the language the call is happening in,
  and short enough to arrive as one text.
- Never leave a placeholder in a message. Every date, time, name and amount
  must be the real value. A text reading "on [Date] at 3PM" is a failure.
- It goes to the number they are calling from unless they ask for another.
- Say what you are doing in your own words before or as you send it, and if
  the tool reports it did not send, tell them plainly rather than pretending.
- One text per call. Do not offer a second.`;
}

/**
 * A COMPLETE prompt for one pipeline. Used ONLY to seed the database on first
 * run, and as a fallback if the database is unreachable mid-call. Once seeded,
 * AI Studio -> Pitch is the single source of truth; editing this file changes
 * nothing on a running agent.
 */
function buildSeed({ pipeline, smsEnabled }) {
  return [
    buildBody({ businessName: "{{business_name}}", agentName: "{{agent_name}}" }),
    buildLanguageSection(pipeline),
    "\n## The caller's number\n",
    buildCallerIdGuidance("{{caller_number}}"),
    smsEnabled ? buildSmsSection() : "",
    `
## What you know about this business

Everything below comes from the business's own knowledge base — the SAME one
Closer answers from on Messenger. A caller and a Messenger customer must
never get different answers.

- Answer from this and nothing else. Never invent a price, a stock level, an
  opening time, an address or a policy that is not written here.
- If it does not cover what they asked, say a colleague will confirm and
  follow up. Never say "that is not in my knowledge base" — the caller does
  not know one exists and it sounds like a machine making excuses.
- Say prices and numbers the way a Filipino speaker says them aloud.

{{knowledge_base}}`,
  ].join("\n").trim();
}

const PROMPT_KEYS = {
  "gemini-live": "pitch_system_gemini",
  local: "pitch_system_local",
};

/** The only values that cannot live in prompt text — they vary per call. */
function fillVariables(text, { businessName, agentName, callerId, knowledge }) {
  const number = normalizeCallerId(callerId);
  return String(text || "")
    .replace(/\{\{\s*business_name\s*\}\}/g, businessName || "this business")
    .replace(/\{\{\s*agent_name\s*\}\}/g, agentName || "Pitch")
    .replace(/\{\{\s*caller_number\s*\}\}/g, number || "not presented")
    .replace(/\{\{\s*knowledge_base\s*\}\}/g,
      knowledge || "(No knowledge base entries yet. Say a colleague will follow up rather than guessing.)");
}

const PROMPT_CACHE_MS = 30000;
const TENANT_CACHE_MS = 60000;
const promptCache = new Map();
let tenantCache = { data: null, expiresAt: 0 };

function pitchPrisma() {
  const { PrismaClient } = require("@prisma/client");
  if (!global.__pitchPrisma) global.__pitchPrisma = new PrismaClient();
  return global.__pitchPrisma;
}

/**
 * NOT prompt-store.js: its ensureSeeded() writes Closer's bootstrap text for
 * ANY key, and its cache is keyed by nothing — sharing it would seed Pitch
 * with Closer's Messenger prompt and poison Closer's cache. Pitch owns its
 * own rows and its own per-key cache.
 */
async function loadPromptRow(key) {
  const now = Date.now();
  const hit = promptCache.get(key);
  if (hit && hit.expiresAt > now) return hit.content;

  const prisma = pitchPrisma();
  const row = await prisma.promptRevision.findFirst({
    where: { key, is_active: true }, orderBy: { version: "desc" },
  }) || await prisma.promptRevision.findFirst({
    where: { key }, orderBy: { version: "desc" },
  });
  if (!row) return null;
  promptCache.set(key, { content: row.content, expiresAt: now + PROMPT_CACHE_MS });
  return row.content;
}

/** Seed both pipeline prompts from code the first time only. */
async function ensurePitchPrompts() {
  const prisma = pitchPrisma();
  for (const [pipeline, key] of Object.entries(PROMPT_KEYS)) {
    if (await prisma.promptRevision.count({ where: { key } })) continue;
    await prisma.promptRevision.create({
      data: {
        key, version: 1, is_active: true, created_by: "seed",
        content: buildSeed({ pipeline, smsEnabled: pipeline !== "local" }),
        note: `Seeded for the ${pipeline} pipeline`,
      },
    });
  }
}

/**
 * Tenant context for a call: the business name and the SAME knowledge base
 * Closer answers from.
 *
 * The knowledge base is deliberately SHARED. Prices, stock, hours and
 * policies are facts about the business, not about a channel — a caller and
 * a Messenger customer must never get different answers, and maintaining two
 * copies guarantees they eventually would. What stays separate is the PROMPT:
 * how the agent behaves on a phone is nothing like how it behaves in a chat
 * window.
 *
 * Today the company comes from PITCH_COMPANY_ID because one gateway serves
 * one business. For multiple tenants this becomes a per-call lookup —
 * inbound SIM -> device -> company — and nothing downstream changes.
 */
async function loadTenantContext() {
  const now = Date.now();
  if (tenantCache.data && tenantCache.expiresAt > now) return tenantCache.data;

  const out = { businessName: null, knowledge: "" };
  try {
    const { loadAistaffAiConfig, formatKnowledgeBaseForPrompt } = require("../aistaff-ai-config");
    const cfg = await loadAistaffAiConfig(process.env.PITCH_COMPANY_ID || undefined);
    out.businessName = cfg.company && cfg.company.name ? cfg.company.name : null;

    // Closer's budget is 60,000 characters. That is fine for Messenger, where
    // the prompt is sent once per typed reply and latency is invisible. On a
    // phone call the whole prompt is re-sent EVERY turn, so 60k characters is
    // roughly 15,000 tokens of extra input per turn — seconds of added
    // latency and a cost multiple, most of it irrelevant to whoever is on the
    // line. Voice gets a much smaller slice, newest first.
    const budget = int(process.env.PITCH_KB_MAX_CHARS, 6000);
    let kb = formatKnowledgeBaseForPrompt(cfg.knowledgeBase || []);
    if (kb.length > budget) {
      kb = kb.slice(0, budget).replace(/\n[^\n]*$/, "")
        + "\n(Further entries exist. If the caller asks something not covered, say a colleague will confirm.)";
    }
    out.knowledge = kb;
  } catch {
    // A ringing phone must not fail because the knowledge base is unreachable.
  }
  tenantCache = { data: out, expiresAt: now + TENANT_CACHE_MS };
  return out;
}

/** The instructions for THIS call — entirely from AI Studio. */
async function loadInstructions({ businessName, agentName, callerId, smsEnabled, pipeline }) {
  const key = PROMPT_KEYS[pipeline] || PROMPT_KEYS["gemini-live"];
  let text = null;
  try {
    await ensurePitchPrompts();
    text = await loadPromptRow(key);
  } catch {
    text = null;
  }
  if (!text || String(text).trim().length < 20) {
    text = buildSeed({ pipeline, smsEnabled });
  }

  const tenant = await loadTenantContext();
  return fillVariables(text, {
    // The tenant record wins over the env fallback: the business name belongs
    // to the company, not to this process's configuration.
    businessName: tenant.businessName || businessName,
    agentName,
    callerId,
    knowledge: tenant.knowledge,
  });
}

function clearPitchPromptCache() { promptCache.clear(); }

module.exports = {
  PROMPT_KEYS,
  buildSeed,
  fillVariables,
  loadInstructions,
  ensurePitchPrompts,
  clearPitchPromptCache,
  normalizeCallerId,
};
