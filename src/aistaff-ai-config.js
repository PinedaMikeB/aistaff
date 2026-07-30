const { prisma } = require("./db");

const DEFAULT_AI_GOAL = [
  "PRIMARY GOAL: You orchestrate the full Messenger conversation — read chat history, call tools to capture state and execute actions, then reply naturally.",
  "Show that AIStaff studied their organization through PUBLIC previews only.",
  "Connect findings to concrete AIStaff benefits (faster replies, qualification, lead capture, quotation drafts).",
  "Never confuse the customer's personal Facebook profile with their business Page.",
  "Never use company or contact name as the Facebook Page lookup — only what the customer explicitly provides via set_page_name."
].join(" ");

let cachedConfig = null;
let cacheExpiresAt = 0;

async function getDefaultCompanyId() {
  const company = await prisma.company.findFirst({
    where: { status: "active" },
    orderBy: { created_at: "asc" }
  });
  if (!company) throw new Error("No active company found.");
  return company.id;
}

async function loadAistaffAiConfig(companyId = null) {
  const now = Date.now();
  if (cachedConfig && cacheExpiresAt > now && (!companyId || cachedConfig.companyId === companyId)) {
    return cachedConfig;
  }

  const resolvedCompanyId = companyId || await getDefaultCompanyId();
  const [settings, knowledgeBase, company] = await Promise.all([
    prisma.companySetting.findUnique({ where: { company_id: resolvedCompanyId } }),
    prisma.knowledgeBase.findMany({
      where: { company_id: resolvedCompanyId, active: true },
      orderBy: { updated_at: "desc" },
      take: 30
    }),
    prisma.company.findUnique({
      where: { id: resolvedCompanyId },
      select: { id: true, name: true, industry: true, website: true }
    })
  ]);

  cachedConfig = {
    companyId: resolvedCompanyId,
    company,
    aiGoal: DEFAULT_AI_GOAL,
    customInstructions: settings?.ai_custom_instructions || "",
    tone: settings?.tone || "polite_professional",
    defaultLanguage: settings?.default_language || "en",
    knowledgeBase
  };
  cacheExpiresAt = now + 60_000;
  return cachedConfig;
}

function clearAistaffAiConfigCache() {
  cachedConfig = null;
  cacheExpiresAt = 0;
}

function formatKnowledgeBaseForPrompt(entries = []) {
  if (!entries.length) return "";
  const lines = entries.map((entry) => (
    `[${entry.category}] Q: ${entry.question}\nA: ${entry.answer}`
  ));
  return [
    "Approved knowledge base (use when relevant — do not invent pricing or policies beyond this):",
    ...lines
  ].join("\n");
}

function buildAdminPromptPreview(session, backend = {}, messageText = "", config = {}) {
  const { buildAistaffSystemPrompt } = require("./aistaff-demo");
  return buildAistaffSystemPrompt(session, backend, messageText, config);
}

function parseLeadMemoryNotes(notes) {
  if (!notes) return null;
  const marker = "AIStaff Messenger memory:";
  const index = notes.indexOf(marker);
  if (index < 0) return null;
  const jsonText = notes.slice(index + marker.length).trim();
  try {
    return JSON.parse(jsonText);
  } catch {
    return null;
  }
}

async function getMessengerMemoryForPsid(psid, companyId = null) {
  const resolvedCompanyId = companyId || await getDefaultCompanyId();
  const conversation = await prisma.conversation.findUnique({
    where: { company_id_psid: { company_id: resolvedCompanyId, psid: String(psid) } },
    include: {
      messages: { orderBy: { created_at: "desc" }, take: 20 },
      leads: { orderBy: { updated_at: "desc" }, take: 1 }
    }
  });
  if (!conversation) return null;

  const lead = conversation.leads[0] || null;
  const memory = parseLeadMemoryNotes(lead?.notes);
  return {
    conversation: {
      id: conversation.id,
      psid: conversation.psid,
      customer_name: conversation.customer_name,
      status: conversation.status,
      intent: conversation.intent,
      last_message_at: conversation.last_message_at
    },
    lead: lead ? {
      id: lead.id,
      customer_name: lead.customer_name,
      company_name: lead.company_name,
      email: lead.email,
      mobile_number: lead.mobile_number,
      location: lead.location,
      lead_status: lead.lead_status,
      service_needed: lead.service_needed
    } : null,
    memory,
    recentMessages: conversation.messages
      .slice()
      .reverse()
      .map((message) => ({
        sender_type: message.sender_type,
        message_text: message.message_text,
        ai_generated: message.ai_generated,
        created_at: message.created_at
      }))
  };
}

module.exports = {
  DEFAULT_AI_GOAL,
  loadAistaffAiConfig,
  clearAistaffAiConfigCache,
  formatKnowledgeBaseForPrompt,
  buildAdminPromptPreview,
  parseLeadMemoryNotes,
  getMessengerMemoryForPsid
};
