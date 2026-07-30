require("dotenv").config();

const { PrismaClient } = require("@prisma/client");
const { hashPassword } = require("../src/auth");
const { encryptSecret } = require("../src/crypto");

const prisma = new PrismaClient();

async function main() {
  const company = await prisma.company.upsert({
    where: { id: "00000000-0000-0000-0000-000000000001" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000001",
      name: "AIStaff.click Demo Company",
      industry: "B2B services",
      website: "https://aistaff.click",
      contact_email: "hello@aistaff.click",
      contact_number: "+63 900 000 0000",
      status: "active"
    }
  });

  await prisma.companySetting.upsert({
    where: { company_id: company.id },
    update: {},
    create: {
      company_id: company.id,
      ai_enabled: true,
      auto_reply_enabled: true,
      business_hours_only: false,
      human_handoff_enabled: true,
      default_language: "en",
      tone: "polite_professional",
      quotation_mode: "approval_required",
      allow_ai_quotation_drafts: true,
      allow_auto_send_quotation: false,
      quotation_requires_admin_approval: true,
      notify_email: "owner@aistaff.click"
    }
  });

  const email = process.env.SEED_ADMIN_EMAIL || "admin@aistaff.click";
  await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      company_id: company.id,
      name: "Admin Owner",
      email,
      password_hash: await hashPassword(process.env.SEED_ADMIN_PASSWORD || "ChangeMe123!"),
      role: "admin",
      status: "active"
    }
  });

  await prisma.facebookPage.upsert({
    where: { page_id: "demo_page" },
    update: {},
    create: {
      company_id: company.id,
      page_id: "demo_page",
      page_name: "AIStaff.click Demo Page",
      page_access_token_encrypted: encryptSecret("demo-page-token"),
      status: "active"
    }
  });

  const kbItems = [
    {
      category: "Services",
      question: "What does AIStaff.click provide?",
      answer: "AIStaff.click provides an AI Inbox Sales Assistant for Facebook Page Messenger that replies instantly, qualifies inquiries with your business questions, captures lead details in your admin dashboard, and prepares quotation drafts for admin approval before sending.",
      tags: ["service", "facebook", "quotation"]
    },
    {
      category: "Quotation",
      question: "Can the AI send quotations automatically?",
      answer: "By default, quotation sending requires admin approval. Auto-send can only be enabled for fixed-price offers with approved quotation templates.",
      tags: ["quotation", "approval"]
    },
    {
      category: "Pricing",
      question: "What are the managed setup packages?",
      answer: "Starter: PHP 15,000 setup + PHP 3,000/month — instant AI replies, lead capture, qualification questions, quotation drafts with admin approval. Growth: PHP 25,000 setup + PHP 6,000/month — everything in Starter plus higher inquiry volume capacity, more customized qualification questions, and managed onboarding support. Pro: PHP 50,000 setup + PHP 12,000/month — everything in Growth plus highest inquiry volume capacity, full managed onboarding and tuning, and priority onboarding support.",
      tags: ["pricing"]
    },
    {
      category: "Services",
      question: "What is the free inbox audit?",
      answer: "The free inbox audit shows where Messenger leads may be delayed, where customer details are missing, and how AI can qualify inquiries faster and prepare quotation-ready leads. Our team reviews your Page setup and inquiry flow from the details you provide — we do not log into your inbox.",
      tags: ["audit", "service"]
    },
    {
      category: "Pricing",
      question: "What should we NOT promise about packages?",
      answer: "Do not promise multi-agent setup, detailed sales reports, faster response times as a plan feature, or advanced AI workflows unless explicitly added to the official package list.",
      tags: ["pricing", "policy"]
    }
  ];

  for (const item of kbItems) {
    const existing = await prisma.knowledgeBase.findFirst({ where: { company_id: company.id, question: item.question } });
    if (!existing) await prisma.knowledgeBase.create({ data: { ...item, company_id: company.id, active: true } });
  }

  const questions = [
    ["What service or product do you need quoted?", "service_needed"],
    ["Where is your office or project location?", "location"],
    ["How urgent is this request?", "urgency"],
    ["May I get your company name?", "company_name"],
    ["May I get the contact person's name?", "customer_name"],
    ["What mobile number and email should our team use?", "mobile_number"]
  ];

  for (const [index, [question, field_key]] of questions.entries()) {
    const existing = await prisma.qualificationQuestion.findFirst({ where: { company_id: company.id, field_key } });
    if (!existing) {
      await prisma.qualificationQuestion.create({
        data: { company_id: company.id, question, field_key, required: true, display_order: index + 1, active: true }
      });
    }
  }

  const conversation = await prisma.conversation.upsert({
    where: { company_id_psid: { company_id: company.id, psid: "demo_customer" } },
    update: {},
    create: {
      company_id: company.id,
      psid: "demo_customer",
      customer_name: "Maria Santos",
      channel: "facebook_messenger",
      status: "open",
      intent: "quotation_request",
      lead_score: "hot",
      last_message_at: new Date()
    }
  });

  const messages = await prisma.message.count({ where: { conversation_id: conversation.id } });
  if (!messages) {
    await prisma.message.createMany({
      data: [
        { company_id: company.id, conversation_id: conversation.id, sender_type: "customer", sender_id: "demo_customer", message_text: "Magkano po copier rental?" },
        { company_id: company.id, conversation_id: conversation.id, sender_type: "ai", sender_id: "ai_sales_assistant", message_text: "Salamat po sa inquiry. Black and white copier po ba or colored ang kailangan ninyo? Saan din po ang office location ninyo?", ai_generated: true },
        { company_id: company.id, conversation_id: conversation.id, sender_type: "customer", sender_id: "demo_customer", message_text: "Colored po. Sa Cainta. Around 15 users, 8,000 pages per month." }
      ]
    });
  }

  const lead = await prisma.lead.upsert({
    where: { id: "00000000-0000-0000-0000-000000000101" },
    update: {},
    create: {
      id: "00000000-0000-0000-0000-000000000101",
      company_id: company.id,
      conversation_id: conversation.id,
      customer_name: "Maria Santos",
      mobile_number: "09171234567",
      email: "maria@example.com",
      company_name: "Santos Trading",
      location: "Cainta",
      service_needed: "Colored copier rental for 15 users, around 8,000 pages per month",
      urgency: "This week",
      notes: "Facebook Messenger inquiry. Needs official quotation.",
      lead_status: "quotation_ready",
      lead_score: "hot",
      quotation_ready: true,
      follow_up_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000)
    }
  });

  const quote = await prisma.quotation.findFirst({ where: { company_id: company.id, lead_id: lead.id } });
  if (!quote) {
    await prisma.quotation.create({
      data: {
        company_id: company.id,
        lead_id: lead.id,
        conversation_id: conversation.id,
        quotation_number: "Q-2026-00001",
        customer_name: lead.customer_name,
        customer_company: lead.company_name,
        service_needed: lead.service_needed,
        quotation_details: "Draft quotation for colored copier rental. Admin must review pricing, availability, terms, and final scope before sending.",
        terms: "Subject to admin approval and availability confirmation.",
        status: "pending_approval",
        mode: "approval_required"
      }
    });
  }

  const followUp = await prisma.followUp.findFirst({ where: { company_id: company.id, lead_id: lead.id } });
  if (!followUp) {
    await prisma.followUp.create({
      data: {
        company_id: company.id,
        lead_id: lead.id,
        conversation_id: conversation.id,
        due_date: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000),
        status: "pending",
        note: "Check if customer submitted company details and approve quotation draft."
      }
    });
  }

  console.log(`Seeded demo company and admin: ${email}`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
