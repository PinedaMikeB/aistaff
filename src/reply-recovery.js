/**
 * Missed-reply recovery (added 2026-10-20). A customer message can be stored but never answered when
 * AIStaff restarts mid-reply (deploys), or the internet / Facebook was unreachable. Every minute this
 * finds website-chat and Messenger conversations whose LAST message is the customer's and answers it:
 *   - messages from before this process started: their reply was certainly lost -> answer now;
 *   - newer ones: only after 6 minutes and only when this process is not already working on them.
 * Never for conversations handed to staff, AI switched off, or older than 45 minutes.
 */
const { prisma } = require("./db");

const BOOT = Date.now();
const inFlight = new Set();
let running = false;

function markStart(conversationId) { if (conversationId) inFlight.add(conversationId); }
function markEnd(conversationId) { if (conversationId) inFlight.delete(conversationId); }

async function answer(conversation, last) {
  const { generateSalesReply } = require("./ai");
  const settings = await prisma.companySetting.findUnique({ where: { company_id: conversation.company_id } });
  if (!settings?.ai_enabled || !settings?.auto_reply_enabled) return "ai_off";
  const channelKey = conversation.channel;
  const channel = await prisma.tenantChannel.findUnique({ where: { company_id_channel_key: { company_id: conversation.company_id, channel_key: channelKey } } }).catch(() => null);
  if (channel && (channel.enabled === false || channel.ai_replies === false)) return "channel_off";
  let page = null;
  if (channelKey === "facebook_messenger") {
    page = await prisma.facebookPage.findFirst({ where: { page_id: conversation.facebook_page_id, status: "active" } })
      || await prisma.facebookPage.findFirst({ where: { company_id: conversation.company_id, status: "active" } });
    if (!page || !conversation.psid) return "no_page";
  }
  markStart(conversation.id);
  try {
    const ai = await generateSalesReply({ companyId: conversation.company_id, conversationId: conversation.id, message: last.message_text });
    // Someone (or the normal path) may have answered meanwhile: do not reply twice.
    const newest = await prisma.message.findFirst({ where: { conversation_id: conversation.id, NOT: { sender_id: "ai_wait_notice" } }, orderBy: { created_at: "desc" }, select: { id: true } });
    if (newest?.id !== last.id) return "already_answered";
    const parts = [ai.reply, ...(ai.followUpMessages || [])].map((t) => String(t || "").trim()).filter(Boolean);
    for (const part of parts) {
      if (page) await require("./messenger-webhook").sendMessengerText(page, conversation.psid, part);
      await prisma.message.create({ data: { company_id: conversation.company_id, conversation_id: conversation.id, sender_type: "ai", sender_id: "ai_sales_assistant", message_text: part, ai_generated: true } });
    }
    await prisma.conversation.update({ where: { id: conversation.id }, data: { needs_human: Boolean(ai.needsHuman), status: ai.needsHuman ? "handoff" : "open", last_message_at: new Date() } }).catch(() => {});
    if (ai.needsHuman) await prisma.humanHandoff.create({ data: { company_id: conversation.company_id, conversation_id: conversation.id, reason: String(ai.handoffReason || "Requested a person").slice(0, 1000) } }).catch(() => {});
    return `answered:${parts.length}`;
  } finally {
    markEnd(conversation.id);
  }
}

async function sweep() {
  if (running) return;
  running = true;
  try {
    const now = Date.now();
    const candidates = await prisma.conversation.findMany({
      where: { channel: { in: ["website_chat", "facebook_messenger"] }, needs_human: false, last_message_at: { gte: new Date(now - 45 * 60 * 1000) } },
      select: { id: true, company_id: true, channel: true, psid: true, facebook_page_id: true },
      take: 50
    });
    let handled = 0;
    for (const conversation of candidates) {
      if (handled >= 3 || inFlight.has(conversation.id)) continue;
      const last = await prisma.message.findFirst({ where: { conversation_id: conversation.id, NOT: { sender_id: "ai_wait_notice" } }, orderBy: { created_at: "desc" }, select: { id: true, sender_type: true, message_text: true, created_at: true } });
      if (!last || last.sender_type !== "customer") continue;
      const at = new Date(last.created_at).getTime();
      const orphaned = at < BOOT - 5000;                 // its reply died with the previous process
      const stale = now - at > 6 * 60 * 1000;            // nobody answered for 6 minutes
      if (!orphaned && !stale) continue;
      handled += 1;
      const result = await answer(conversation, last).catch((error) => `failed: ${error.message}`);
      console.log("[reply-recovery] conversation=%s channel=%s %s -> %s", conversation.id, conversation.channel, orphaned ? "orphaned" : "stale", result);
    }
  } catch (error) {
    console.error("[reply-recovery] sweep failed: %s", error.message);
  } finally {
    running = false;
  }
}

module.exports = { sweep, markStart, markEnd };
