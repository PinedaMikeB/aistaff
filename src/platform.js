/**
 * The AIStaff platform view: every customer, and the ability to help them.
 *
 * WHY THIS IS SEPARATE FROM /admin: /admin is ONE workspace. AIStaff staff are
 * themselves tenants (mpineda@ lives in AIS-2026-0002), so /admin was doing two
 * jobs — "my workspace" and "run the platform" — with no line between them.
 * /platform sits above workspaces. It is also a pure addition, so nothing Meta
 * reviewed under /admin/* is disturbed (HANDOFF §12).
 *
 * ASSIST MODE IS DELIBERATE AND LOGGED. Staff reading a tenant's conversations
 * is a real intrusion — customers trust AIStaff with their customers' messages.
 * So entering a workspace is an explicit act, visible on screen throughout, and
 * recorded with who did it and when. Cheap now, near-impossible to retrofit.
 */

const { prisma } = require("./db");
const { stepsForPack } = require("./intake-steps");

/**
 * One row per customer, with the numbers that decide who needs attention:
 * setup progress, unanswered questions, whether a Page is connected.
 */
async function listCustomers() {
  const companies = await prisma.company.findMany({
    orderBy: { created_at: "desc" },
    select: {
      id: true, account_number: true, name: true, contact_person: true,
      contact_email: true, contact_number: true, industry: true,
      status: true, created_at: true
    }
  });

  return Promise.all(companies.map(async (company) => {
    const [settings, knowledge, questions, pages, gaps, lastMessage, conversations] = await Promise.all([
      prisma.companySetting.findUnique({ where: { company_id: company.id } }),
      prisma.knowledgeBase.findMany({
        where: { company_id: company.id, active: true, confirmed: true },
        select: { category: true }
      }),
      prisma.qualificationQuestion.count({ where: { company_id: company.id, active: true } }),
      prisma.facebookPage.findMany({
        where: { company_id: company.id, status: "active" },
        select: { page_name: true }
      }),
      prisma.knowledgeGap.count({ where: { company_id: company.id, status: "open" } }),
      prisma.message.findFirst({
        where: { company_id: company.id },
        orderBy: { created_at: "desc" },
        select: { created_at: true }
      }),
      prisma.conversation.count({ where: { company_id: company.id } })
    ]);

    // Same calculation the wizard shows the customer, so staff and customer
    // are never looking at different numbers.
    const progress = settings?.intake_progress || {};
    const steps = stepsForPack(progress.industryPack || "general");
    const skipped = new Set(progress.skipped || []);
    const byCategory = new Map();
    for (const row of knowledge) byCategory.set(row.category, (byCategory.get(row.category) || 0) + 1);
    const isDone = (s) => (s.qualification ? questions > 0 : Boolean(byCategory.get(s.category)));
    const addressed = steps.filter((s) => isDone(s) || skipped.has(s.id)).length;

    return {
      id: company.id,
      accountNumber: company.account_number,
      name: company.name,
      contactPerson: company.contact_person,
      contactEmail: company.contact_email,
      contactNumber: company.contact_number,
      industry: company.industry,
      status: company.status,
      createdAt: company.created_at,
      setupPercent: steps.length ? Math.round((addressed / steps.length) * 100) : 0,
      knowledgeCount: knowledge.length,
      questionCount: questions,
      pageConnected: pages.length > 0,
      pageName: pages[0]?.page_name || null,
      openGaps: gaps,
      conversations,
      lastMessageAt: lastMessage?.created_at || null,
      aiEnabled: Boolean(settings?.ai_enabled),
      autoReplyEnabled: Boolean(settings?.auto_reply_enabled)
    };
  }));
}

module.exports = { listCustomers };
