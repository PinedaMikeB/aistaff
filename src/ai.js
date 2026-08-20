const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));
const { prisma } = require("./db");
const { renderKnowledgeForPrompt } = require("./knowledge-base");
const { getActiveInstructions } = require("./prompt-store");
const { getModelFor } = require("./model-registry");
const {
  RESEARCH_START,
  RESEARCH_END,
  extractResearchContext,
  stripResearchContext
} = require("./closer-web-research");

/** The AIStaff tenant. Only this company's Closer may create payment links. */
const AISTAFF_COMPANY_ID = process.env.AISTAFF_COMPANY_ID || "00000000-0000-0000-0000-000000000001";
const BOOKING_FIELD_LABELS = {
  name: "Customer name",
  mobile: "Mobile number",
  email: "Email",
  company_name: "Company / organization",
  website: "Website",
  purpose: "Purpose (repair, meeting, onboarding, reservation)",
  service_package: "Service / package chosen",
  preferred_date: "Preferred date",
  preferred_time: "Preferred time",
  preferred_meeting_channel: "Preferred meeting channel",
  onboarding_topic: "Onboarding/setup topic",
  branch_location: "Branch / location",
  party_size: "Party size",
  guest_count: "Number of guests",
  check_in_date: "Check-in date",
  check_out_date: "Check-out date",
  room_type: "Room type",
  table_preference: "Table preference",
  doctor_preference: "Doctor / specialist preference",
  staff_preference: "Staff preference",
  therapist_preference: "Therapist preference",
  vehicle_model: "Vehicle / model",
  property_unit: "Property / unit",
  address: "Address / service location",
  concern: "Concern / reason for visit",
  special_requests: "Special requests",
  notes_remarks: "Notes / remarks",
  deposit_payment: "Deposit/payment needed",
  staff_confirmation_required: "Staff confirmation required"
};
const BOOKING_TYPE_LABELS = {
  general: "General appointment",
  ai_service_onboarding: "AI service / onboarding meeting",
  spa_salon: "Spa / salon",
  clinic_doctor: "Clinic / doctor",
  restaurant: "Restaurant reservation",
  hotel_lodging: "Hotel / lodging",
  repair_home_service: "Repair / home service",
  gym_class: "Gym / class",
  school_enrollment: "School / enrollment appointment",
  church_ministry: "Church / ministry meeting",
  real_estate: "Real estate viewing",
  car_dealership: "Car dealership / test drive",
  personal_service: "Personal service"
};

function renderBookingContext(setting, services = []) {
  if (!setting) return "Booking calendar: not configured.";
  const enabled = Boolean(setting.enabled);
  const selectedFields = Array.isArray(setting.required_fields) ? setting.required_fields : [];
  const fieldLines = selectedFields
    .map((key) => BOOKING_FIELD_LABELS[key] || key.replace(/_/g, " "))
    .filter(Boolean)
    .map((label) => `- ${label}`);
  const serviceLines = (services || [])
    .filter((service) => service.active !== false)
    .slice(0, 20)
    .map((service) => {
      const bits = [
        service.name,
        service.duration_minutes ? `${service.duration_minutes} minutes` : "",
        service.location ? `location: ${service.location}` : "",
        service.description ? `note: ${String(service.description).slice(0, 180)}` : ""
      ].filter(Boolean);
      return `- ${bits.join(" | ")}`;
    });
  return [
    `Booking calendar: ${enabled ? "enabled" : "disabled"}.`,
    `Current server time: ${new Date().toISOString()}. Use this to interpret relative dates like today, tomorrow, and next Friday before asking for confirmation.`,
    `Booking type: ${BOOKING_TYPE_LABELS[setting.booking_type] || setting.booking_type || "general"}.`,
    `Field setup mode: ${setting.field_mode || "preset"}.`,
    `Timezone: ${setting.timezone || "Asia/Manila"}.`,
    `Minimum notice: ${setting.min_notice_minutes ?? 120} minutes.`,
    `Max days ahead: ${setting.max_days_ahead ?? 30}.`,
    setting.instructions ? `Tenant booking instructions: ${setting.instructions}` : "Tenant booking instructions: none.",
    "Fields to collect before creating a booking request:",
    fieldLines.length ? fieldLines.join("\n") : "- Customer name\n- Mobile number\n- Purpose\n- Preferred date\n- Preferred time",
    "Configured bookable services:",
    serviceLines.length ? serviceLines.join("\n") : "- No services configured yet."
  ].join("\n");
}

/**
 * NO HARDCODED BEHAVIOUR. Removed 2026-08-18.
 *
 * This file used to decide, in code, what Closer should ask, how it should
 * score a lead, and whether a lead was ready to quote. All of it was Marga's
 * copier-rental business generalised to every tenant, and most of it was
 * English keyword matching:
 *
 *   REQUIRED_FIELDS              company_name, location, urgency... A Facebook
 *                                clothing seller has no "project location", so
 *                                Closer chased a field that never applied and
 *                                quotationReady() could never become true.
 *   DEFAULT_QUALIFICATION_QUESTIONS  Six fixed questions in fixed English.
 *   scoreLead()                  "today|asap|urgent|this week|rush" — Taglish
 *                                urgency ("kailangan ko bukas") scored cold.
 *   extractLeadPatch()           Sniffed for "copier|cctv|aircon" and pasted
 *                                the raw message into service_needed.
 *   captureQualificationAnswer() Assigned the customer's whole message to
 *                                whichever field was next, unread.
 *   isCustomerQuestion()         A regex of English and Tagalog question words
 *                                — a language rule in code, which is Rule 1.
 *   replyAlreadyAsksQuestion()   Keyword-matched the reply against the question.
 *
 * Closer now reads the conversation and returns what it understood. The code
 * only stores it. What to ask comes from the tenant's own qualification
 * questions; how to ask comes from the AI Studio and Settings instructions.
 * Nothing about Closer's behaviour lives here any more.
 */

/** Fields this tenant actually wants, from their own configuration. */
function requiredFieldKeys(customQuestions = []) {
  return customQuestions.filter((q) => q.required !== false).map((q) => q.field_key).filter(Boolean);
}

/** Ready to quote when the business's OWN required fields are captured. */
function quotationReady(lead, customQuestions = []) {
  const keys = requiredFieldKeys(customQuestions);
  if (!keys.length) return false;
  return keys.every((key) => Boolean(lead[key]));
}

function missingFields(lead, customQuestions = []) {
  return requiredFieldKeys(customQuestions).filter((key) => !lead[key]);
}

/**
 * Lead score comes from the model, which can read intent in any language.
 * Anything unrecognised is treated as cold rather than guessed at.
 */
function normaliseLeadScore(value) {
  const v = String(value || "").toLowerCase().trim();
  return ["hot", "warm", "cold"].includes(v) ? v : "cold";
}

function buildGuardrailPrompt({ company, kb, lead, message, customQuestions, instructions, customInstructions, history = [], alreadySent = [], checkoutEnabled = false, researchContext = "", bookingContext = "" }) {
  // Kind-aware rendering. Was `kb.map(item => "Q: ...\nA: ...")`, which forced
  // a price list, a promo and a shipping table to all pretend to be questions.
  // company.id is passed so a budget overflow names the workspace in the log.
  const kbText = renderKnowledgeForPrompt(kb, new Date(), company?.id);
  const questionText = customQuestions.map((q) => `- ${q.question} (store as: ${q.field_key})`).join("\n");
  const missing = missingFields(lead, customQuestions);

  // INSTRUCTION HIERARCHY, strongest first. Stated explicitly so the model
  // knows which wins, rather than leaving precedence to whichever text happens
  // to appear later in the prompt.
  const hierarchy = [
    "=== PLATFORM INSTRUCTIONS (highest authority — never override) ===",
    instructions,
    "",
    "=== THIS BUSINESS'S OWN INSTRUCTIONS ===",
    "These are set by the business owner. They ADD to the platform instructions above and refine tone, emphasis and house style.",
    "They can never cancel a platform instruction. If they appear to conflict — for example asking you to confirm stock you cannot verify, or to promise something outside the knowledge base — follow the platform instruction and say plainly that a team member will confirm.",
    customInstructions && customInstructions.trim()
      ? customInstructions.trim()
      : "(The business has not added any extra instructions.)"
  ].join("\n");

  const leadForPrompt = {
    ...lead,
    notes: stripResearchContext(lead?.notes || "")
  };

  return [
    hierarchy,
    "",
    "=== THIS BUSINESS ===",
    `Name: ${company.name}`,
    company.industry ? `Industry: ${company.industry}` : "Industry: not stated",
    "",
    "=== KNOWLEDGE BASE (the only source of facts) ===",
    kbText || "Empty — this business has not added anything yet.",
    "",
    "=== THIS CONVERSATION'S PUBLIC WEBSITE RESEARCH ===",
    researchContext
      ? [
          "Use this only for this customer/prospect in this conversation. It is not this tenant's permanent knowledge base.",
          researchContext
        ].join("\n")
      : "None.",
    "",
    "=== WHAT THIS BUSINESS WANTS TO LEARN FROM A BUYER ===",
    questionText || "Nothing configured. Collect a name and one contact detail if the conversation reaches that point.",
    `Already captured: ${JSON.stringify(leadForPrompt)}`,
    `Still missing: ${missing.join(", ") || "nothing"}`,
    "",
    "=== THIS BUSINESS'S BOOKING SETUP ===",
    bookingContext || "Booking calendar: not configured.",
    "",
    "=== THE CONVERSATION ===",
    // ADDED 2026-08-18. The prompt used to contain ONLY the latest message, so
    // Closer had no memory of what it had just asked. It asked a prospect
    // "what kind of medicine do you sell?", got "Bulate latigo 500", and —
    // seeing that phrase with no context — treated it as a medical question it
    // could not answer and handed off. No instruction can fix that: the model
    // genuinely did not know it had asked anything.
    history.length
      ? history.map((m) => `${m.sender_type === "ai" ? "You" : "Customer"}: ${m.message_text}`).join("\n")
      : "(no earlier messages)",
    `Customer just said: ${message}`,
    "",
    "If their message is short or looks like a fragment, read it as an ANSWER to whatever you last asked, not as a new question.",
    "",
    "=== WHAT TO RETURN ===",
    "Reply with JSON only:",
    '{"reply": "...", "follow_up_messages": [], "intent": "...", "handoff_reason": "", "lead_updates": {}, "lead_score": "hot|warm|cold", "unanswered": null, "send_media": [], "security_alert": null, "create_booking": null}',
    "",
    "reply — what you are sending the customer, in your own words.",
    "follow_up_messages — optional second Messenger bubble(s). Use at most ONE short follow-up. For B2B sales prospects, use it when the main reply answers the question but does not yet include a pain, benefit, proof point, or next-step value bridge. Use [] for support, payment confirmation, handoff, or when the main reply already carries the sales insight.",
    "intent — a short label for what they want, your choice of wording.",
    "handoff_reason — empty string unless a human is genuinely needed. Set it only when the customer asks for a person, raises a complaint, or wants something you are not permitted to decide. Never set it merely because a topic sounds sensitive.",
    "lead_updates — any details you learned about the customer in THIS message, keyed by the store-as names listed above. Only include a field when they actually told you; never guess, and never copy their whole message into a field.",
    "lead_score — how close this person is to buying, judged from the whole conversation in whatever language they used. hot = ready or urgent, warm = genuinely interested, cold = still browsing.",
    // This is what makes the "we tune it with you" promise keepable. The model
    // already knows when it had to say it could not confirm something, so it
    // reports the gap itself — no keyword matching, no guessing.
    'unanswered — set this ONLY when you could not answer because the information is missing from the knowledge base: {"question": "what they asked, in their words", "topic": "2-4 word label such as warranty, installment terms, delivery to Cebu"}. Use null when you answered fully, or when you handed off for a reason other than missing information. Use the same topic wording for the same subject so repeats group together.',
    // Real attachments, replacing the invented "[IMAGE: ...]" markers.
    'send_media — ids of files to actually attach to this reply, e.g. ["abc123:0"]. Use ONLY ids listed as SENDABLE FILES above. Send one when the customer asks to see something, or when an entry says to send it for the question they just asked. Send at most 2, and only when they genuinely help — an unasked-for attachment is spam. Use [] otherwise.',
    'create_booking — set ONLY when THIS BUSINESS\'S BOOKING SETUP says the booking calendar is enabled AND the customer has provided all details needed to create a booking request: {"customer_name":"...","mobile":"...","email":"...","service_name":"...","start_at":"ISO-8601 date/time with timezone if known","notes":"...","field_values":{"purpose":"...","preferred_date":"...","preferred_time":"...","onboarding_topic":"..."}}. Use null otherwise.',
    "Before setting create_booking, read the details back briefly in the reply and ask/confirm if anything is missing or ambiguous. Never use create_booking for a disabled booking calendar. Never claim the booking is confirmed; the system creates a pending booking request and sends the reference after your reply.",
    // The specific failure this fixes: the same image went out twice in one
    // conversation because nothing told the model it had already sent it.
    alreadySent.length
      ? `ALREADY SENT in this conversation — do NOT send these again, the customer has them:\n${alreadySent.map((u) => `  ${u}`).join("\n")}`
      : "Nothing has been attached in this conversation yet.",
    "Send a file ONCE. Do not re-send it later in the same conversation, do not attach something to every reply, and do not attach anything when a sentence answers the question. Most replies should send nothing.",
    "Never write a placeholder such as [IMAGE: ...] in your reply. If a file is being attached, the customer will see it; just introduce it in one short line.",
    // Checkout exists ONLY on AIStaff's own Page. A tenant's Closer creating an
    // AIStaff order would charge their customer for OUR subscription.
    ...(checkoutEnabled ? [
      "",
      "TAKING PAYMENT",
      'create_payment_link — set ONLY when the customer has agreed to buy AND given their email: {"email":"...","name":"...","mobile":"...","plan":"starter","billing":"monthly|annual"}. null otherwise.',
      "Ask for the email first and read it back to confirm — it becomes their login, so a typo locks them out of what they just paid for.",
      "Never ask for card details, never invent a payment link, never claim payment was received. The system creates the real link and sends it for you."
    ] : [])
  ].filter((line) => line !== null && line !== undefined).join("\n");
}

/**
 * Remove fake attachment markers before anything reaches a customer.
 *
 * The model kept writing "[IMAGE: Closer knows what to ask...]" — a
 * placeholder it invents because a media entry tells it a poster EXISTS while
 * it has no file to attach. Customers see the brackets literally and it looks
 * broken.
 *
 * A prompt rule (v9) did not hold: it was ignored on the very next message.
 * Prompt instructions are requests; code checks are guarantees, and this is
 * cheap to guarantee. Remove when real media sending ships — at that point the
 * model should emit a send_media instruction instead, and this becomes a
 * safety net rather than the fix.
 */
function stripFakeAttachments(text) {
  if (typeof text !== "string") return text;
  return text
    // [IMAGE: ...] / [VIDEO ...] / [ATTACHMENT] / [see photo] on their own
    .replace(/\[\s*(image|video|photo|attachment|file|picture|see photo|insert image)\b[^\]]*\]/gi, "")
    // Markdown image embeds, which Messenger also cannot render
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    // Tidy the whitespace the removal leaves behind
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/\s+([.,!?])/g, "$1")
    .trim();
}

async function callOpenAI(prompt, model) {
  // GPT-5.x family rejects any temperature other than the default:
  //   "Unsupported value: 'temperature' does not support 0.2 with this model."
  // Brandee hit this same wall (see BRANDEE_PLANNER_MODEL notes). Omit the
  // parameter entirely for those models rather than sending a value they
  // refuse — sending temperature:1 explicitly also works but is noise.
  const body = {
    model,
    messages: [{ role: "user", content: prompt }],
    response_format: { type: "json_object" }
  };
  if (!/^gpt-5/i.test(model)) body.temperature = 0.2;

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`
    },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    // Include the provider's message. "OpenAI error 400" alone cost a session
    // of guessing when a model rejected an unsupported parameter.
    const detail = await response.text().catch(() => "");
    throw new Error(`OpenAI error ${response.status}: ${detail.slice(0, 300)}`);
  }
  const json = await response.json();
  return {
    model: json.model,
    content: json.choices?.[0]?.message?.content || "{}",
    promptTokens: json.usage?.prompt_tokens || 0,
    completionTokens: json.usage?.completion_tokens || 0
  };
}

async function callGemini(prompt, model) {
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

/**
 * REMOVED 2026-08-18: mockReply() and fieldQuestion().
 *
 * These held canned customer-facing sentences — "Thank you for your inquiry.",
 * "I will ask a team member to assist you.", "Where is your office or project
 * location?" — and were used as a SILENT FALLBACK whenever the AI provider
 * failed or returned unparseable JSON. So an outage did not look like an
 * outage: real customers received templated English, in a fixed register, that
 * no one had written for them. That is the canned-reply mistake
 * (docs/handoff-masterplan.md) firing at exactly the worst moment.
 *
 * Now a provider failure THROWS. messenger-webhook.js catches it, flags the
 * conversation for a human, and records the real error. A person answers
 * instead of a template pretending to be one.
 *
 * fieldQuestion() went with it — it was the §17.5 violation still living on
 * this path, and its questions ("office or project location", "company name")
 * were Marga's copier business asked of every tenant.
 */

async function generateSalesReply({ companyId, conversationId, message }) {
  const [company, settings, kb, customQuestions, conversation, bookingSetting, bookingServices] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId } }),
    prisma.companySetting.findUnique({ where: { company_id: companyId } }),
    prisma.knowledgeBase.findMany({
      // Was `orderBy: created_at desc, take: 20` — that dropped the OLDEST
      // entries first, so the first thing a client entered in the wizard was
      // the first to stop reaching the agent, with no visible cause.
      //
      // No row cap now. Size is governed by characters, not row count, in
      // knowledge-base.js selectWithinBudget() — which keeps house rules and
      // pricing and logs anything it has to drop.
      where: { company_id: companyId, active: true, confirmed: true },
      orderBy: [{ display_order: "asc" }, { created_at: "asc" }]
    }),
    prisma.qualificationQuestion.findMany({ where: { company_id: companyId, active: true }, orderBy: { display_order: "asc" } }),
    prisma.conversation.findUnique({
      where: { id: conversationId },
      include: {
        leads: { orderBy: { created_at: "desc" }, take: 1 },
        // Recent turns, so Closer knows what it just asked. Twelve is enough
        // for a Messenger exchange without bloating the prompt.
        messages: { orderBy: { created_at: "desc" }, take: 12, select: { sender_type: true, message_text: true, attachments: true, created_at: true } }
      }
    }),
    prisma.bookingSetting.findUnique({ where: { company_id: companyId } }),
    prisma.bookingService.findMany({
      where: { company_id: companyId, active: true },
      orderBy: [{ display_order: "asc" }, { created_at: "asc" }]
    })
  ]);

  // The lead is whatever we already knew. Nothing is extracted from this
  // message in code — the model reads it and returns lead_updates below.
  const currentLead = conversation?.leads?.[0] || {};
  const lead = { ...currentLead };
  const researchContext = extractResearchContext(lead.notes || "");

  const activeInstructions = await getActiveInstructions();

  // Everything already attached in this conversation. Used twice: told to the
  // model so it stops choosing repeats, and enforced in resolveSendMedia so it
  // cannot send one even if it tries.
  const alreadySentUrls = new Set();
  for (const message of conversation?.messages || []) {
    for (const item of Array.isArray(message.attachments) ? message.attachments : []) {
      if (item && item.url) alreadySentUrls.add(item.url);
    }
  }
  const prompt = buildGuardrailPrompt({
    company,
    kb,
    lead,
    message,
    customQuestions,
    instructions: activeInstructions.content,
    customInstructions: settings?.ai_custom_instructions || "",
    // Oldest first for reading. The newest row is the message we are answering
    // now, which is shown separately, so it is dropped here.
    history: (conversation?.messages || []).slice(1).reverse(),
    alreadySent: [...alreadySentUrls],
    researchContext,
    bookingContext: renderBookingContext(bookingSetting, bookingServices),
    // Only AIStaff sells AIStaff. A tenant's Closer offering our checkout
    // would charge THEIR customer for OUR subscription.
    checkoutEnabled: companyId === AISTAFF_COMPANY_ID
  });
  // Provider and model come from the registry (AI Studio), not .env — env had
  // already drifted to gemini-1.5-flash, a model nobody chose.
  const { provider, model } = await getModelFor("closer_reply");
  let aiResult;
  // No silent fallback. If the provider is missing, fails, or returns
  // something unparseable, THROW — messenger-webhook.js turns that into a
  // human handoff with the real error. Serving a template instead would hide
  // an outage behind words no one wrote.
  if (provider === "openai" && process.env.OPENAI_API_KEY) aiResult = await callOpenAI(prompt, model);
  else if (provider === "gemini" && process.env.GEMINI_API_KEY) aiResult = await callGemini(prompt, model);
  else throw new Error(`AI provider "${provider}" is not configured — no API key`);

  let parsed;
  try {
    parsed = JSON.parse(aiResult.content.replace(/^```json|```$/g, "").trim());
  } catch {
    throw new Error("AI returned unparseable JSON");
  }

  // Handoff is decided by the MODEL, which can read intent, not by keyword
  // matching on the raw message.
  //
  // FIXED 2026-08-18. The old rule also fired on any message containing
  // "human", "agent", "tao", "complaint" or "discount" — English-only words
  // that appear constantly in ordinary sales talk. "pwede nyo paggamitan ng
  // chat agent nyo" ("can we use your chat agent") contains "agent", so asking
  // what the product does was treated as demanding a human, and the customer
  // got silence. "May discount ba?" — the single most common sales question in
  // the Philippines — did the same thing.
  //
  // This was also a Rule 1 violation in spirit: a hardcoded English keyword
  // list deciding behaviour for Taglish speakers.
  const needsHuman = Boolean(parsed.handoff_reason);
  const reply = stripFakeAttachments(parsed.reply);

  // Only accept lead fields this tenant configured AND that exist as real Lead
  // columns. A qualification question's field_key is free text typed by the
  // owner, so "preferred_payment_method" was accepted, sent to prisma, and
  // crashed the whole reply with "Unknown argument". Filtering here keeps a
  // badly-named question from silencing the Page.
  const LEAD_COLUMNS = new Set([
    "customer_name", "company_name", "email", "mobile_number", "location",
    "service_needed", "budget", "urgency", "notes"
  ]);
  const allowedKeys = new Set(
    customQuestions.map((q) => q.field_key).filter((k) => k && LEAD_COLUMNS.has(k))
  );
  const patch = {};
  const rejected = [];
  for (const [key, value] of Object.entries(parsed.lead_updates || {})) {
    if (!allowedKeys.has(key)) { rejected.push(key); continue; }
    const clean = String(value == null ? "" : value).trim().slice(0, 300);
    if (clean) {
      if (key === "notes" && researchContext) {
        patch[key] = [
          stripResearchContext(clean),
          `${RESEARCH_START}\n${researchContext}\n${RESEARCH_END}`
        ].filter(Boolean).join("\n\n").slice(0, 6000);
      } else {
        patch[key] = clean;
      }
    }
  }
  if (rejected.length) {
    // Not silent: a question whose field_key is not a Lead column will never
    // capture anything, and the owner should be told rather than left guessing.
    console.warn("[ai-reply] company=%s dropped lead fields with no matching column: %s",
      companyId, rejected.join(", "));
  }

  const mergedLead = { ...lead, ...patch };
  const leadScore = normaliseLeadScore(parsed.lead_score);
  const isQuotationReady = quotationReady(mergedLead, customQuestions);

  await prisma.aiLog.create({
    data: {
      company_id: companyId,
      conversation_id: conversationId,
      model: aiResult.model || provider,
      prompt_tokens: aiResult.promptTokens || 0,
      completion_tokens: aiResult.completionTokens || 0
    }
  });

  if (typeof reply !== "string" || !reply.trim()) {
    console.log("[ai-reply] EMPTY reply | provider=%s model=%s parsed_keys=%s needsHuman=%s kb=%s q=%s",
      provider, aiResult.model, Object.keys(parsed || {}).join(","),
      needsHuman, kb.length, customQuestions.length);
    // Empty is a failure, not a reason to substitute words nobody wrote.
    console.log("[ai-reply] raw content: %s", String(aiResult.content).slice(0, 400));
    throw new Error("AI returned an empty reply");
  }

  return {
    reply,
    followUpMessages: normalizeFollowUpMessages(parsed.follow_up_messages),
    intent: parsed.intent || "qualifying",
    handoffReason: parsed.handoff_reason || "",
    leadPatch: patch,
    leadScore,
    quotationReady: isQuotationReady,
    needsHuman,
    // Passed to the webhook, which records it. Kept as raw model output here
    // so this function stays a pure "read the conversation, report what you
    // understood" step with no side effects.
    unanswered: parsed.unanswered && typeof parsed.unanswered === "object"
      ? {
          question: String(parsed.unanswered.question || "").trim().slice(0, 500),
          topic: String(parsed.unanswered.topic || "").trim().toLowerCase().slice(0, 60)
        }
      : null,
    // Resolve ids to real URLs HERE, from this company's own rows. The model
    // never supplies a URL — if it did, a prompt-injected knowledge entry could
    // make Closer attach anything from anywhere. It can only pick from files
    // this tenant uploaded.
    //
    // alreadySent is a HARD GUARANTEE, not a request. Closer sent the same
    // image twice in one conversation because every turn it saw an entry
    // saying "send this when asked about X" and had no memory of having done
    // so. Telling it not to repeat is a prompt rule; filtering here is a fact.
    sendMedia: resolveSendMedia(parsed.send_media, kb, alreadySentUrls),
    // Reported by the model, acted on by the webhook. A refusal nobody hears
    // about is a near-miss you never learn from.
    securityAlert: parsed.security_alert && typeof parsed.security_alert === "object"
      ? {
          type: String(parsed.security_alert.type || "unknown").slice(0, 40),
          summary: String(parsed.security_alert.summary || "").slice(0, 400)
        }
      : null,
    // Passed to the webhook, which creates the order and sends the link. Kept
    // as a request rather than an action so this function stays side-effect
    // free — it reads and reports, it never charges anyone.
    paymentRequest: companyId === AISTAFF_COMPANY_ID && parsed.create_payment_link
      && typeof parsed.create_payment_link === "object"
      ? parsed.create_payment_link
      : null,
    bookingRequest: bookingSetting?.enabled && parsed.create_booking
      && typeof parsed.create_booking === "object"
      ? parsed.create_booking
      : null,
    settings
  };
}

function normalizeFollowUpMessages(value) {
  if (!Array.isArray(value) || !value.length) return [];
  return value
    .map((item) => stripFakeAttachments(String(item || "").trim()))
    .filter(Boolean)
    .slice(0, 1)
    .map((item) => item.slice(0, 420));
}

/** Turn ["<entryId>:<index>"] into attachable {type, url, caption}. */
function resolveSendMedia(ids, kb, alreadySent = new Set()) {
  if (!Array.isArray(ids) || !ids.length) return [];
  const byId = new Map(kb.map((row) => [row.id, row]));
  const out = [];
  const seen = new Set();
  for (const raw of ids.slice(0, 2)) {
    const [entryId, indexRaw] = String(raw || "").split(":");
    const row = byId.get(entryId);
    if (!row || !Array.isArray(row.media)) continue;
    const item = row.media[Number(indexRaw) || 0];
    if (!item || !item.url) continue;
    if (alreadySent.has(item.url)) {
      console.log("[media] skipped repeat url=%s — already sent in this conversation", item.url);
      continue;
    }
    if (seen.has(item.url)) continue;
    seen.add(item.url);
    out.push({ type: item.type || "file", url: item.url, caption: item.caption || row.title || "" });
  }
  return out;
}

module.exports = {
  generateSalesReply,
  buildGuardrailPrompt,
  quotationReady,
  requiredFieldKeys,
  missingFields,
  normaliseLeadScore
};
