/**
 * Is Closer actually working for this company?
 *
 * Built 2026-08-18 after the quotation incident, where the Page was silent for
 * hours and the only evidence was a stack trace in a log nobody was watching.
 * §9 flags "no alerting anywhere" as an open risk; this is the first piece of
 * it, scoped to the thing customers notice first.
 *
 * The status is DERIVED from real signals, never a stored flag someone has to
 * remember to update — a stale "healthy" badge is worse than no badge at all.
 *
 * RULE 2: returns facts and a status code. The UI writes the words.
 */

const { prisma } = require("./db");

const FAILURE_WINDOW_MINUTES = 60;

/**
 * Statuses, worst first:
 *   down      — replies are failing, or no Page is connected. Customers are
 *               messaging into silence right now.
 *   attention — connected but cannot do the job well: no knowledge, AI off, or
 *               auto-reply off. Not an outage, still worth saying.
 *   working   — connected, has knowledge, replying.
 */
async function getCloserHealth(companyId) {
  const since = new Date(Date.now() - FAILURE_WINDOW_MINUTES * 60 * 1000);

  const [page, settings, knowledgeCount, lastAiMessage, recentFailures] = await Promise.all([
    prisma.facebookPage.findFirst({
      where: { company_id: companyId, status: "active" },
      select: { page_name: true, page_id: true }
    }),
    prisma.companySetting.findUnique({ where: { company_id: companyId } }),
    prisma.knowledgeBase.count({ where: { company_id: companyId, active: true, confirmed: true } }),
    prisma.message.findFirst({
      where: { company_id: companyId, sender_type: "ai" },
      orderBy: { created_at: "desc" },
      select: { created_at: true }
    }),
    // Reply-generation failures are written as handoffs with this exact reason
    // prefix by messenger-webhook.js, so an outage is visible without needing
    // a separate error table.
    prisma.humanHandoff.count({
      where: {
        company_id: companyId,
        created_at: { gte: since },
        reason: { startsWith: "AI reply generation failed" }
      }
    })
  ]);

  const reasons = [];
  let status = "working";

  if (recentFailures > 0) {
    status = "down";
    reasons.push({ code: "reply_failures", count: recentFailures, windowMinutes: FAILURE_WINDOW_MINUTES });
  }
  if (!page) {
    status = "down";
    reasons.push({ code: "no_page_connected" });
  }

  if (status !== "down") {
    if (!settings?.ai_enabled) {
      status = "attention";
      reasons.push({ code: "ai_disabled" });
    } else if (!settings?.auto_reply_enabled) {
      status = "attention";
      reasons.push({ code: "auto_reply_disabled" });
    }
    if (knowledgeCount === 0) {
      status = "attention";
      reasons.push({ code: "no_knowledge" });
    }
  }

  return {
    status,
    reasons,
    pageConnected: Boolean(page),
    pageName: page?.page_name || null,
    aiEnabled: Boolean(settings?.ai_enabled),
    autoReplyEnabled: Boolean(settings?.auto_reply_enabled),
    knowledgeCount,
    lastReplyAt: lastAiMessage?.created_at || null,
    checkedAt: new Date().toISOString()
  };
}

module.exports = { getCloserHealth, FAILURE_WINDOW_MINUTES };
