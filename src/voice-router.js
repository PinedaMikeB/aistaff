"use strict";

/**
 * Voice subject router (Phone + Website Call), 2026-10-21.
 *
 * CODE decides what happens on a voice turn; the AI only labels the subject (from a list that code
 * builds from the business's own Director workflows plus fixed subjects) and picks out a name or
 * company if the caller said one. Chat channels (Closer on Messenger, email, website chat) do not
 * use this file.
 *
 *   workflow already in progress -> Director continues that step
 *   workflow subject             -> Director (starts that workflow)
 *   sales / billing / business   -> fast spoken answer from the knowledge base + next step decided here
 *   small_talk                   -> short reply + ask how to help (no knowledge base)
 *   unrelated                    -> polite redirect to what the business helps with (no knowledge base)
 */

const { prisma } = require("./db");

const FIXED = [
  { key: "sales", about: "buying, renting, prices, quotations, packages, availability of products or services" },
  { key: "billing", about: "invoices, payments, balances, receipts, collection" },
  { key: "business_question", about: "any other question about this business (location, hours, how things work, policies)" },
  { key: "small_talk", about: "greetings, thanks, how are you, checking if someone is there" },
  { key: "unrelated", about: "anything not related to this business (weather, news, jokes, personal topics, other companies)" },
];

function baseUrl() { return String(process.env.VOICE_LLM_BASE_URL || "").replace(/\/v1\/?$/, "").replace(/\/$/, ""); }

async function chatJSON(system, user, maxTokens = 80) {
  const res = await fetch(`${baseUrl()}/v1/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ model: "sealion", temperature: 0, max_tokens: maxTokens, chat_template_kwargs: { enable_thinking: false },
      messages: [{ role: "system", content: system }, { role: "user", content: user }] }),
    signal: AbortSignal.timeout(Number(process.env.VOICE_ROUTER_TIMEOUT_MS || 8000)),
  });
  const j = await res.json();
  const text = String(j?.choices?.[0]?.message?.content || "");
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : {};
}

function clean(v, max = 80) { return String(v || "").replace(/[{}"<>]/g, "").trim().slice(0, max); }

/** Returns { subject, action, flowKey?, name?, company?, ms }. Never throws: on any problem the Director decides. */
async function route({ companyId, conversationId, message }) {
  const started = Date.now();
  try {
    const director = require("./director");
    const flows = await director.loadFlows(companyId);
    const active = await director.activeDraft(companyId, conversationId, flows).catch(() => null);
    if (active) return { subject: "in_workflow", action: "director", ms: Date.now() - started };
    if (!baseUrl()) return { subject: "unknown", action: "director", ms: 0 };
    const options = [...FIXED];
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    for (const f of flows) {
      if (!f.trigger) continue;
      const yn = await chatJSON(
        `A phone caller to ${company?.name || "a business"} said something. Decide if it means: ${String(f.trigger).slice(0, 300)}\nAsking how much something costs, or renting/buying, is NOT this.\nReturn JSON only: {"match":"yes"} or {"match":"no"}`,
        String(message || "").slice(0, 500), 20).catch(() => ({}));
      if (String(yn.match).toLowerCase() === "yes") return { subject: f.key, action: "director", flowKey: f.key, ms: Date.now() - started };
    }
    const out = await chatJSON(
      `You label what a phone caller to ${company?.name || "a business"} is talking about. Choose exactly ONE subject key:\n`
      + options.map((o) => `- ${o.key}: ${o.about}`).join("\n")
      + `\nAlso copy the caller's own name and company name if they said them in this message (else empty).`
      + `\nReturn JSON only: {"subject":"<key>","name":"","company":""}`,
      String(message || "").slice(0, 500));
    const subject = options.some((o) => o.key === out.subject) ? out.subject : "business_question";
    const flow = null;
    const action = subject === "unrelated" ? "redirect" : subject === "small_talk" ? "small_talk" : "answer";
    return { subject, action, flowKey: flow ? flow.key : undefined, name: clean(out.name), company: clean(out.company), ms: Date.now() - started };
  } catch (err) {
    return { subject: "error", action: "director", error: err.message, ms: Date.now() - started };
  }
}

/** The next step after a spoken answer, decided here (not by the AI). */
function nextStep(subject, known) {
  if (subject === "sales") {
    return !known.name || !known.company
      ? { item: "their name and company, so the team can prepare a quotation" }
      : { item: "what exactly they need (model, quantity or package), so the team can prepare the quotation" };
  }
  if (subject === "billing") {
    return !known.company ? { item: "their company name, so the billing team can check their account" } : { item: "what their billing concern is" };
  }
  return { item: "if there is anything else you can help them with" };
}

/** Short spoken reply for small talk, unrelated, or a fast knowledge answer. */
async function shortReply({ companyId, conversationId, message, action, subject }) {
  const [company, recent, conversation] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
    prisma.message.findMany({ where: { conversation_id: conversationId }, orderBy: { created_at: "desc" }, take: 6, select: { sender_type: true, message_text: true } }),
    prisma.conversation.findUnique({ where: { id: conversationId }, include: { leads: { orderBy: { created_at: "desc" }, take: 1 } } }),
  ]);
  const lead = conversation?.leads?.[0];
  const known = { name: conversation?.customer_name || lead?.customer_name, company: lead?.company_name };
  const director = require("./director");
  let task;
  let knowledge = "";
  if (action === "redirect" || action === "small_talk") {
    const flows = await director.loadFlows(companyId).catch(() => []);
    const helps = [...flows.map((f) => String(f.name || f.key.split(".").pop().replace(/_/g, " "))), "orders and sales questions", "billing"].join(", ");
    task = action === "redirect"
      ? { task: "off_topic", tell: [`you can only help with ${company?.name || "this business"} matters: ${helps}`], ask: [{ item: "what they need help with today" }] }
      : { task: "small_talk", tell: ["reply briefly and kindly to what they said"], ask: [{ item: "how you can help them today" }] };
  } else {
    const rows = await prisma.knowledgeBase.findMany({ where: { company_id: companyId, active: true, confirmed: true }, orderBy: [{ display_order: "asc" }, { created_at: "asc" }] });
    knowledge = require("./knowledge-base").renderKnowledgeForPrompt(rows, new Date(), companyId, Number(process.env.VOICE_KB_PROMPT_BUDGET_CHARS || 12000));
    task = { task: "answer_from_knowledge",
      tell: ["answer their question in one or two sentences using ONLY the business facts below; if the facts do not cover it, say the team will confirm — never invent prices, dates or promises"],
      ask: [nextStep(subject, known)] };
  }
  const prompt = director.communicatorPrompt({
    companyName: company?.name || "the business", tone: "", addressAs: known.name || "",
    history: recent.reverse(), message, language: "", task, replyStyle: "casual", channel: "phone", channelInstructions: "",
  }) + (knowledge ? `\n\nBUSINESS FACTS (the only source for your answer):\n${knowledge}` : "");
  const out = await chatJSON(prompt, "Write the reply now.", 140);
  return String(out.reply || "").trim();
}

module.exports = { route, shortReply };
