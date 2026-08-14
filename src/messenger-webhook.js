const crypto = require("crypto");
const fetch = (...args) => import("node-fetch").then(({ default: f }) => f(...args));

const recentMessengerEvents = new Map();
const MESSENGER_DEDUP_TTL_MS = 10 * 60 * 1000;

function rememberMessengerEvent(key) {
  const now = Date.now();
  for (const [storedKey, seenAt] of recentMessengerEvents.entries()) {
    if (now - seenAt > MESSENGER_DEDUP_TTL_MS) recentMessengerEvents.delete(storedKey);
  }
  if (recentMessengerEvents.has(key)) return false;
  recentMessengerEvents.set(key, now);
  return true;
}

function messengerEventKey(event, psid) {
  const mid = event.message?.mid || event.postback?.mid || "";
  if (mid) return `mid:${mid}`;
  const text = event.message?.text || event.postback?.payload || "";
  const watermark = event.message?.timestamp || event.timestamp || "";
  return `fallback:${psid}:${watermark}:${text}`;
}
const { prisma } = require("./db");
const { decryptSecret, encryptSecret } = require("./crypto");
const { generateSalesReply } = require("./ai");
const {
  generateAistaffDemoReply,
  getAistaffSession,
  persistAistaffTurnToPostgres,
  isAistaffMarketingPage,
  recordLeadGenContact,
  consumeAistaffPendingCarousel,
  consumeAistaffPendingImages,
  consumeAistaffPendingPdf,
  consumeAistaffPendingFollowUpTexts,
  handleAistaffPagePickPostback
} = require("./aistaff-demo");

function replyTypingDelay(reply) {
  const textLength = String(reply || "").length;
  return Math.min(8000, Math.max(1800, textLength * 22));
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function keepTypingOn(page, psid, taskPromise) {
  await tryMessengerSenderAction(page, psid, "typing_on");
  const refreshEveryMs = 18000;
  const refresher = setInterval(() => {
    tryMessengerSenderAction(page, psid, "typing_on");
  }, refreshEveryMs);

  try {
    return await taskPromise;
  } finally {
    clearInterval(refresher);
  }
}

async function sendMessengerFollowUpTexts(page, psid, texts) {
  if (!texts?.length) return;
  for (const chunk of texts) {
    if (!String(chunk || "").trim()) continue;
    await wait(500);
    await sendMessengerText(page, psid, chunk);
  }
}

async function sendMessengerReplyWithTyping(page, psid, buildReply) {
  await tryMessengerSenderAction(page, psid, "mark_seen");

  const reply = await keepTypingOn(page, psid, buildReply());
  await wait(replyTypingDelay(reply));
  await tryMessengerSenderAction(page, psid, "typing_off");
  await sendMessengerText(page, psid, reply);
  await sendMessengerFollowUpTexts(page, psid, consumeAistaffPendingFollowUpTexts(psid));
  return reply;
}

function pageAccessToken(page) {
  const stored = decryptSecret(page.page_access_token_encrypted);
  if (stored) return stored;
  if (isAistaffMarketingPage(page.page_id)) return process.env.META_PAGE_ACCESS_TOKEN || "";
  return "";
}

async function sendMessengerPayload(page, psid, message) {
  const token = pageAccessToken(page);
  if (!token) throw new Error(`No Messenger access token configured for page ${page.page_id}`);

  const response = await fetch(`https://graph.facebook.com/v20.0/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: "RESPONSE",
      message
    })
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Messenger Send API failed: ${response.status} ${body}`);
  }
  return response.json();
}

async function sendMessengerText(page, psid, text) {
  const chunks = splitMessengerText(text);
  let last = null;
  for (const chunk of chunks) {
    last = await sendMessengerPayload(page, psid, { text: chunk });
    if (chunks.length > 1) await wait(400);
  }
  return last;
}

function splitMessengerText(text, maxLen = 1990) {
  const cleaned = String(text || "").trim();
  if (!cleaned || cleaned.length <= maxLen) return cleaned ? [cleaned] : [];

  const chunks = [];
  let remaining = cleaned;
  while (remaining.length > maxLen) {
    let cut = remaining.lastIndexOf("\n\n", maxLen);
    if (cut < maxLen * 0.4) cut = remaining.lastIndexOf("\n", maxLen);
    if (cut < maxLen * 0.4) cut = remaining.lastIndexOf(". ", maxLen);
    if (cut < maxLen * 0.4) cut = maxLen;
    chunks.push(remaining.slice(0, cut).trim());
    remaining = remaining.slice(cut).trim();
  }
  if (remaining) chunks.push(remaining);
  return chunks;
}

async function sendMessengerFile(page, psid, fileUrl) {
  if (!fileUrl) return null;
  return sendMessengerPayload(page, psid, {
    attachment: {
      type: "file",
      payload: { url: fileUrl, is_reusable: true }
    }
  });
}

async function sendMessengerGenericCarousel(page, psid, elements) {
  if (!elements?.length) return null;
  return sendMessengerPayload(page, psid, {
    attachment: {
      type: "template",
      payload: {
        template_type: "generic",
        image_aspect_ratio: "square",
        elements: elements.slice(0, 10)
      }
    }
  });
}

async function sendMessengerImage(page, psid, imageUrl, caption = "") {
  const message = {
    attachment: {
      type: "image",
      payload: { url: imageUrl, is_reusable: true }
    }
  };
  await sendMessengerPayload(page, psid, message);
  if (caption) {
    await wait(350);
    await sendMessengerText(page, psid, caption);
  }
}

async function sendMessengerPageCandidateCarousel(page, psid, elements) {
  if (!elements?.length) return null;
  try {
    return await sendMessengerGenericCarousel(page, psid, elements);
  } catch (error) {
    console.warn("Messenger carousel failed, falling back to image messages:", error.message);
    return null;
  }
}

async function sendMessengerPageCandidateImages(page, psid, images) {
  for (const image of images || []) {
    await wait(450);
    await sendMessengerImage(page, psid, image.imageUrl, image.caption);
  }
}

async function sendMessengerSenderAction(page, psid, senderAction) {
  const token = pageAccessToken(page);
  if (!token) throw new Error(`No Messenger access token configured for page ${page.page_id}`);

  const response = await fetch(`https://graph.facebook.com/v20.0/me/messages?access_token=${encodeURIComponent(token)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: psid },
      sender_action: senderAction
    })
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Messenger sender action failed: ${response.status} ${body}`);
  }
  return response.json();
}

async function tryMessengerSenderAction(page, psid, senderAction) {
  try {
    await sendMessengerSenderAction(page, psid, senderAction);
  } catch (error) {
    console.warn(`Messenger sender action ${senderAction} skipped:`, error.message);
  }
}

function verifyMessengerSignature(rawBody, signatureHeader) {
  const secret = process.env.META_APP_SECRET;
  if (!secret) {
    console.warn("META_APP_SECRET not set; webhook signature verification is disabled.");
    return true;
  }
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;

  const expected = `sha256=${crypto.createHmac("sha256", secret).update(rawBody).digest("hex")}`;
  const provided = Buffer.from(signatureHeader);
  const expectedBuf = Buffer.from(expected);
  if (provided.length !== expectedBuf.length) return false;
  return crypto.timingSafeEqual(provided, expectedBuf);
}

async function ensureFacebookPage(pageId) {
  let page = await prisma.facebookPage.findUnique({ where: { page_id: String(pageId) } });
  if (page) return page;

  if (!isAistaffMarketingPage(pageId)) return null;

  const company = await prisma.company.findFirst({ where: { status: "active" }, orderBy: { created_at: "asc" } });
  if (!company) return null;

  page = await prisma.facebookPage.create({
    data: {
      company_id: company.id,
      page_id: String(pageId),
      page_name: "AIStaff Facebook Page",
      page_access_token_encrypted: encryptSecret(process.env.META_PAGE_ACCESS_TOKEN || ""),
      status: "active"
    }
  });
  return page;
}

async function handleDemoMessengerEvent({ page, pageId, psid, text, leadContact, postbackPayload = "" }) {
  console.log(`Incoming AIStaff demo message from ${psid}: ${text || postbackPayload}`);
  if (leadContact) recordLeadGenContact(psid, leadContact);

  let reply;
  if (postbackPayload?.startsWith("PAGE_PICK:")) {
    const slug = postbackPayload.slice("PAGE_PICK:".length);
    await handleAistaffPagePickPostback(psid, slug);
    reply = await sendMessengerReplyWithTyping(page, psid, () => generateAistaffDemoReply("[Selected Page from carousel]", psid));
    const carousel = consumeAistaffPendingCarousel(psid);
    const images = consumeAistaffPendingImages(psid);
    if (carousel?.length) {
      await wait(600);
      const sent = await sendMessengerPageCandidateCarousel(page, psid, carousel);
      if (!sent && images?.length) {
        await sendMessengerPageCandidateImages(page, psid, images);
      }
    } else if (images?.length) {
      await wait(600);
      await sendMessengerPageCandidateImages(page, psid, images);
    }
    const pdf = consumeAistaffPendingPdf(psid);
    if (pdf?.url) {
      await wait(600);
      await sendMessengerFile(page, psid, pdf.url);
    }
  } else {
    reply = await sendMessengerReplyWithTyping(page, psid, () => generateAistaffDemoReply(text, psid));
    const carousel = consumeAistaffPendingCarousel(psid);
    const images = consumeAistaffPendingImages(psid);
    if (carousel?.length) {
      await wait(600);
      const sent = await sendMessengerPageCandidateCarousel(page, psid, carousel);
      if (!sent && images?.length) {
        await sendMessengerPageCandidateImages(page, psid, images);
      }
    } else if (images?.length) {
      await wait(600);
      await sendMessengerPageCandidateImages(page, psid, images);
    }
    const pdf = consumeAistaffPendingPdf(psid);
    if (pdf?.url) {
      await wait(600);
      await sendMessengerFile(page, psid, pdf.url);
    }
  }

  await persistAistaffTurnToPostgres({
    pageId,
    psid,
    customerText: text || postbackPayload,
    reply,
    session: getAistaffSession(psid)
  });
  console.log(`AIStaff reply sent to ${psid}`);
}

async function handleClientMessengerEvent({ page, psid, text, maybeCreateQuotationDraft }) {
  const settings = await prisma.companySetting.findUnique({ where: { company_id: page.company_id } });
  if (!settings?.ai_enabled) return;

  const conversation = await prisma.conversation.upsert({
    where: { company_id_psid: { company_id: page.company_id, psid } },
    create: {
      company_id: page.company_id,
      facebook_page_id: page.id,
      psid,
      channel: "facebook_messenger",
      last_message_at: new Date()
    },
    update: { facebook_page_id: page.id, last_message_at: new Date() }
  });

  await prisma.message.create({
    data: {
      company_id: page.company_id,
      conversation_id: conversation.id,
      sender_type: "customer",
      sender_id: psid,
      message_text: text
    }
  });

  let lead = await prisma.lead.findFirst({ where: { company_id: page.company_id, conversation_id: conversation.id } });
  if (!lead) {
    lead = await prisma.lead.create({
      data: {
        company_id: page.company_id,
        conversation_id: conversation.id,
        lead_status: "new"
      }
    });
  }

  const ai = await keepTypingOn(page, psid, () => generateSalesReply({ companyId: page.company_id, conversationId: conversation.id, message: text }));
  const updatedLead = await prisma.lead.update({
    where: { id: lead.id },
    data: {
      ...ai.leadPatch,
      lead_score: ai.leadScore,
      quotation_ready: ai.quotationReady,
      lead_status: ai.quotationReady ? "quotation_ready" : "contacted"
    }
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: {
      intent: ai.intent,
      lead_score: ai.leadScore,
      needs_human: ai.needsHuman,
      status: ai.needsHuman ? "handoff" : "open"
    }
  });

  if (ai.needsHuman && settings?.human_handoff_enabled) {
    await prisma.humanHandoff.create({
      data: {
        company_id: page.company_id,
        conversation_id: conversation.id,
        reason: ai.handoffReason || "AI requested human handoff"
      }
    });
  }

  await maybeCreateQuotationDraft({
    companyId: page.company_id,
    lead: updatedLead,
    conversationId: conversation.id
  });

  if (!settings?.auto_reply_enabled || ai.needsHuman) return;

  await prisma.message.create({
    data: {
      company_id: page.company_id,
      conversation_id: conversation.id,
      sender_type: "ai",
      sender_id: "ai_sales_assistant",
      message_text: ai.reply,
      ai_generated: true
    }
  });
  await sendMessengerReplyWithTyping(page, psid, async () => ai.reply);
}

async function handleMessengerWebhook(payload, { maybeCreateQuotationDraft }) {
  if (payload.object !== "page") return;

  for (const entry of payload.entry || []) {
    const pageId = String(entry.id);
    const page = await ensureFacebookPage(pageId);
    if (!page || page.status !== "active") {
      console.warn(`Ignoring webhook for unknown or inactive page ${pageId}`);
      continue;
    }

    const isMarketingPage = isAistaffMarketingPage(pageId);

    for (const event of entry.messaging || []) {
      const psid = event.sender?.id;
      const text = event.message?.text || "";
      const postbackPayload = event.postback?.payload || "";
      if (!psid || event.message?.is_echo) continue;
      if (!text && !postbackPayload) continue;
      if (!rememberMessengerEvent(messengerEventKey(event, psid))) {
        console.log(`Skipping duplicate Messenger event for ${psid}`);
        continue;
      }

      const leadContact = extractLeadContactFromMessengerEvent(event);

      // Default: real inquiries to the AIStaff Page are answered by Closer
      // AS AIStaff (handleClientMessengerEvent, AIStaff's own knowledge
      // base). The "preview Closer for MY OWN business" roleplay demo is
      // opt-in only — via an explicit m.me/<id>?ref=demo entry link, or a
      // demo postback — and once opted in, stays on for the rest of that
      // conversation (session-persisted) so a multi-message demo doesn't
      // flip back to the AIStaff identity mid-flow.
      let useDemoFlow = false;
      if (isMarketingPage) {
        const ref = event.referral?.ref || event.postback?.referral?.ref || "";
        const session = getAistaffSession(psid);
        if (ref === "demo" || postbackPayload.startsWith("PAGE_PICK:")) {
          session.explicitDemoMode = true;
        }
        useDemoFlow = session.explicitDemoMode;
      }

      if (useDemoFlow) {
        await handleDemoMessengerEvent({ page, pageId, psid, text, leadContact, postbackPayload });
      } else if (text) {
        await handleClientMessengerEvent({ page, psid, text, maybeCreateQuotationDraft });
      }
    }
  }
}

function extractLeadContactFromMessengerEvent(event) {
  const text = event.message?.text || "";
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const phone = text.match(/(?:\+?63|0)?9\d{9}/)?.[0];
  const referral = event.referral || event.message?.referral;
  const referralEmail = referral?.ads_context_data?.user_email || referral?.email;
  const referralPhone = referral?.ads_context_data?.user_phone || referral?.phone;
  const referralName = referral?.ads_context_data?.user_name || referral?.name;

  const contact = {
    email: referralEmail || email || "",
    phone: referralPhone || phone || "",
    name: referralName || ""
  };

  if (!contact.email && !contact.phone && !contact.name) return null;
  return contact;
}

module.exports = {
  verifyMessengerSignature,
  handleMessengerWebhook,
  sendMessengerText,
  sendMessengerSenderAction,
  tryMessengerSenderAction,
  sendMessengerReplyWithTyping
};
