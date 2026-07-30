const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const { prisma } = require("./db");

const REQUIRED_FIELDS = [
  "customer_name",
  "company_name",
  "location",
  "service_needed",
  "urgency",
  "mobile_number",
  "email"
];

const DEFAULT_QUALIFICATION_QUESTIONS = [
  { question: "What service or product do you need quoted?", field_key: "service_needed", required: true },
  { question: "Where is your office or project location?", field_key: "location", required: true },
  { question: "How urgent is this request?", field_key: "urgency", required: true },
  { question: "May I get your company name?", field_key: "company_name", required: true },
  { question: "May I get the contact person's name?", field_key: "customer_name", required: true },
  { question: "What mobile number and email should our team use?", field_key: "mobile_number", required: true }
];

function isCustomerQuestion(message) {
  const text = String(message || "").trim();
  if (!text) return false;
  return /^(what|how|why|when|where|who|can|could|do|does|did|is|are|will|would|should|magkano|paano|ano|saan|ilan|may|mayroon)\b/i.test(text)
    || /\?\s*$/.test(text)
    || /how will you|how do you|what is|what does|tell me about/i.test(text);
}

function isQualificationFieldFilled(lead, fieldKey) {
  if (fieldKey === "mobile_number") return Boolean(lead.mobile_number && lead.email);
  return Boolean(lead[fieldKey]);
}

function getNextQualificationQuestion(customQuestions, lead) {
  const questions = customQuestions?.length ? customQuestions : DEFAULT_QUALIFICATION_QUESTIONS;
  return questions.find((question) => question.required !== false && !isQualificationFieldFilled(lead, question.field_key)) || null;
}

function captureQualificationAnswer(message, lead, customQuestions) {
  const patch = extractLeadPatch(message, lead);
  const mergedLead = { ...lead, ...patch };
  if (isCustomerQuestion(message)) return patch;

  const next = getNextQualificationQuestion(customQuestions, mergedLead);
  if (!next || isQualificationFieldFilled(mergedLead, next.field_key)) return patch;

  if (next.field_key === "mobile_number") {
    if (patch.mobile_number || patch.email) return patch;
    return patch;
  }

  if (!patch[next.field_key]) {
    patch[next.field_key] = String(message || "").trim().slice(0, 200);
  }
  return patch;
}

function stripTrailingQuestions(text) {
  const cleaned = String(text || "").trim();
  const sentences = cleaned.match(/[^.!?]+[.!?]?/g) || [cleaned];
  const kept = [];
  for (const sentence of sentences) {
    if (/\?/.test(sentence) && kept.length > 0) break;
    kept.push(sentence.trim());
  }
  return kept.join(" ").trim() || cleaned.split("?")[0].trim();
}

function replyAlreadyAsksQualificationQuestion(text, nextQuestion) {
  if (!nextQuestion || !/\?/.test(String(text || ""))) return false;
  const lower = String(text).toLowerCase();
  const questionLower = String(nextQuestion.question || "").toLowerCase();
  return lower.includes(questionLower.slice(0, 24))
    || (nextQuestion.field_key === "service_needed" && /service|product|quoted|kailangan/i.test(lower))
    || (nextQuestion.field_key === "location" && /location|office|project|saan|where/i.test(lower))
    || (nextQuestion.field_key === "urgency" && /urgent|when|kailan/i.test(lower))
    || (nextQuestion.field_key === "company_name" && /company name|business name/i.test(lower))
    || (nextQuestion.field_key === "customer_name" && /contact person|your name|pangalan/i.test(lower))
    || (nextQuestion.field_key === "mobile_number" && /mobile|email|number|contact/i.test(lower));
}

function buildQualificationReply(parsedReply, lead, customQuestions) {
  if (quotationReady(lead)) return parsedReply;
  const next = getNextQualificationQuestion(customQuestions, lead);
  if (!next) return parsedReply;

  const brief = stripTrailingQuestions(parsedReply);
  if (replyAlreadyAsksQualificationQuestion(brief, next)) return brief;
  return `${brief} ${next.question}`.trim();
}

function includesAny(text, words) {
  const lower = String(text || "").toLowerCase();
  return words.some((word) => lower.includes(word));
}

function scoreLead(lead) {
  if (lead.urgency && includesAny(lead.urgency, ["today", "asap", "urgent", "this week", "rush"])) return "hot";
  const complete = REQUIRED_FIELDS.filter((field) => Boolean(lead[field])).length;
  if (complete >= 5 || lead.budget) return "warm";
  return "cold";
}

function quotationReady(lead) {
  return Boolean(lead.company_name && lead.location && lead.service_needed && lead.mobile_number);
}

function extractLeadPatch(message, currentLead = {}) {
  const text = String(message || "");
  const patch = {};
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  const phone = text.match(/(?:\+?63|0)?9\d{9}/);
  if (email) patch.email = email[0];
  if (phone) patch.mobile_number = phone[0];

  const locationMatch = text.match(/\b(?:in|at|sa|from)\s+([A-Za-z][A-Za-z\s.-]{2,40})/i);
  if (locationMatch && !currentLead.location) patch.location = locationMatch[1].trim();

  const companyMatch = text.match(/(?:company|business|from)\s+(?:is\s+)?([A-Za-z0-9&.,\-\s]{3,50})/i);
  if (companyMatch && !currentLead.company_name) patch.company_name = companyMatch[1].trim();

  if (!currentLead.service_needed && includesAny(text, ["quotation", "quote", "rental", "install", "service", "supply", "copier", "cctv", "aircon"])) {
    patch.service_needed = text.slice(0, 140);
  }
  if (!currentLead.urgency && includesAny(text, ["today", "tomorrow", "this week", "urgent", "asap", "next week"])) {
    patch.urgency = text.slice(0, 80);
  }
  if (!currentLead.budget && includesAny(text, ["budget", "₱", "php", "pesos"])) {
    patch.budget = text.slice(0, 80);
  }
  return patch;
}

function missingFields(lead) {
  return REQUIRED_FIELDS.filter((field) => !lead[field]);
}

function fieldQuestion(field) {
  const questions = {
    customer_name: "May I get the contact person's name?",
    company_name: "What is your company name?",
    location: "Where is your office or project location?",
    service_needed: "What service or item do you need quoted?",
    urgency: "When do you need this?",
    mobile_number: "What mobile number can our team contact?",
    email: "What email should we use for the official quotation?"
  };
  return questions[field] || "May I get one more detail for the quotation?";
}

function buildGuardrailPrompt({ company, kb, lead, message, customQuestions }) {
  const kbText = kb.map((item) => `Q: ${item.question}\nA: ${item.answer}`).join("\n\n");
  const questionText = customQuestions.map((q) => `- ${q.question} (${q.field_key})`).join("\n");
  const nextQuestion = getNextQualificationQuestion(customQuestions, lead);
  return [
    "You are a B2B sales assistant for Facebook Page Messenger.",
    "Reply politely and quickly. Answer only using the company knowledge base.",
    "Ask exactly ONE qualification question per reply.",
    "Never invent prices, discounts, final availability, or services outside the knowledge base.",
    "Never send a final quotation unless settings explicitly allow auto-send.",
    "If the customer asks for a human, stop and request human handoff.",
    "",
    `Company: ${company.name}`,
    `Industry: ${company.industry || "B2B sales"}`,
    `Knowledge base:\n${kbText || "No approved knowledge base yet."}`,
    `Qualification questions:\n${questionText || "Use standard B2B quotation questions."}`,
    nextQuestion ? `Next required qualification question: ${nextQuestion.question}` : "All required qualification fields are captured.",
    `Current lead JSON: ${JSON.stringify(lead)}`,
    `Customer message: ${message}`,
    "",
    "Return JSON with keys: reply, intent, handoff_reason."
  ].join("\n");
}

async function callOpenAI(prompt) {
  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      messages: [{ role: "user", content: prompt }],
      response_format: { type: "json_object" },
      temperature: 0.2
    })
  });
  if (!response.ok) throw new Error(`OpenAI error ${response.status}`);
  const json = await response.json();
  return {
    model: json.model,
    content: json.choices?.[0]?.message?.content || "{}",
    promptTokens: json.usage?.prompt_tokens || 0,
    completionTokens: json.usage?.completion_tokens || 0
  };
}

async function callGemini(prompt) {
  const model = process.env.GEMINI_MODEL || "gemini-1.5-flash";
  const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${process.env.GEMINI_API_KEY}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [{ parts: [{ text: `${prompt}\nReturn only valid JSON.` }] }],
      generationConfig: { temperature: 0.2 }
    })
  });
  if (!response.ok) throw new Error(`Gemini error ${response.status}`);
  const json = await response.json();
  return {
    model,
    content: json.candidates?.[0]?.content?.parts?.[0]?.text || "{}",
    promptTokens: json.usageMetadata?.promptTokenCount || 0,
    completionTokens: json.usageMetadata?.candidatesTokenCount || 0
  };
}

function mockReply({ lead, message, customQuestions = [] }) {
  if (includesAny(message, ["human", "agent", "tao", "staff"])) {
    return {
      reply: "I understand. I will ask a team member to assist you. Please wait while our team reviews your inquiry.",
      intent: "human_requested",
      handoff_reason: "Customer requested a human"
    };
  }
  if (quotationReady(lead)) {
    return {
      reply: "Thank you. I have collected the details. Our team will review this and prepare the official quotation.",
      intent: "quotation_ready",
      handoff_reason: ""
    };
  }
  const next = getNextQualificationQuestion(customQuestions, lead);
  const question = next?.question || fieldQuestion(missingFields(lead)[0] || "service_needed");
  return {
    reply: `Thank you for your inquiry. ${question}`,
    intent: "qualifying",
    handoff_reason: ""
  };
}

async function generateSalesReply({ companyId, conversationId, message }) {
  const [company, settings, kb, customQuestions, conversation] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId } }),
    prisma.companySetting.findUnique({ where: { company_id: companyId } }),
    prisma.knowledgeBase.findMany({ where: { company_id: companyId, active: true }, orderBy: { created_at: "desc" }, take: 20 }),
    prisma.qualificationQuestion.findMany({ where: { company_id: companyId, active: true }, orderBy: { display_order: "asc" } }),
    prisma.conversation.findUnique({ where: { id: conversationId }, include: { leads: { orderBy: { created_at: "desc" }, take: 1 } } })
  ]);

  const currentLead = conversation?.leads?.[0] || {};
  const patch = captureQualificationAnswer(message, currentLead, customQuestions);
  const lead = { ...currentLead, ...patch };
  lead.lead_score = scoreLead(lead);
  lead.quotation_ready = quotationReady(lead);

  const prompt = buildGuardrailPrompt({ company, kb, lead, message, customQuestions });
  const provider = process.env.AI_PROVIDER || "mock";
  let aiResult;
  try {
    if (provider === "openai" && process.env.OPENAI_API_KEY) aiResult = await callOpenAI(prompt);
    else if (provider === "gemini" && process.env.GEMINI_API_KEY) aiResult = await callGemini(prompt);
    else aiResult = { model: "mock-guardrail", content: JSON.stringify(mockReply({ lead, message, customQuestions })), promptTokens: 0, completionTokens: 0 };
  } catch (error) {
    aiResult = { model: `${provider}-fallback`, content: JSON.stringify(mockReply({ lead, message, customQuestions })), promptTokens: 0, completionTokens: 0 };
  }

  let parsed;
  try {
    parsed = JSON.parse(aiResult.content.replace(/^```json|```$/g, "").trim());
  } catch {
    parsed = mockReply({ lead, message, customQuestions });
  }

  const needsHuman = Boolean(parsed.handoff_reason) || includesAny(message, ["human", "agent", "tao", "complaint", "discount"]);
  const reply = needsHuman
    ? (parsed.reply || mockReply({ lead, message, customQuestions }).reply)
    : buildQualificationReply(parsed.reply || mockReply({ lead, message, customQuestions }).reply, lead, customQuestions);
  await prisma.aiLog.create({
    data: {
      company_id: companyId,
      conversation_id: conversationId,
      model: aiResult.model || provider,
      prompt_tokens: aiResult.promptTokens || 0,
      completion_tokens: aiResult.completionTokens || 0
    }
  });

  return {
    reply,
    intent: parsed.intent || "qualifying",
    handoffReason: parsed.handoff_reason || (needsHuman ? "Human review required" : ""),
    leadPatch: patch,
    leadScore: lead.lead_score,
    quotationReady: lead.quotation_ready,
    needsHuman,
    settings
  };
}

module.exports = {
  generateSalesReply,
  scoreLead,
  quotationReady,
  extractLeadPatch,
  getNextQualificationQuestion,
  captureQualificationAnswer
};
