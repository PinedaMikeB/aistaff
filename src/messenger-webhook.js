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
const { notifyBookingCreated, notifyHandoff, notifySecurityAlert } = require("./notify");
const { createCheckoutLink } = require("./checkout-link");
const { maybeAddWebsiteResearchToLead } = require("./closer-web-research");
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
    // Callers pass either a promise (line ~75) or a thunk (line ~351). Awaiting a
    // function returns the function itself, which silently discarded the AI reply.
    return await (typeof taskPromise === "function" ? taskPromise() : taskPromise);
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

/**
 * `attachmentType` added 2026-08-18. It was hardcoded to "file", which works
 * for a PDF but makes Messenger show a video as a download link rather than an
 * inline player. Meta accepts image | video | audio | file.
 */
async function sendMessengerFile(page, psid, fileUrl, attachmentType = "file") {
  if (!fileUrl) return null;
  return sendMessengerPayload(page, psid, {
    attachment: {
      type: attachmentType,
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

/**
 * Resolve a Page to its OWNING company. Returns null for anything we do not
 * have a record of.
 *
 * FIXED 2026-08-17 (was HANDOFF-CLOSER.md §17.7 item 4). This previously fell
 * back to `findFirst({status:"active"}, orderBy: created_at asc)` — the OLDEST
 * active company — and answered with META_PAGE_ACCESS_TOKEN. That meant an
 * unknown Page could be answered using another tenant's knowledge base and
 * Mike's own Page token: a cross-tenant data leak plus a reply sent from the
 * wrong business. It never fired because there was only one Page; with real
 * customers connecting their own Pages it becomes reachable.
 *
 * A Page we do not know is now REJECTED and logged. Every reply is scoped to
 * page.company_id, so an unowned Page has no correct company to answer as.
 */
async function ensureFacebookPage(pageId) {
  const page = await prisma.facebookPage.findUnique({ where: { page_id: String(pageId) } });
  if (page) return page;

  console.warn("[webhook] REJECTED event for unknown page_id=%s — no company owns this Page", pageId);
  return null;
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

/**
 * Best-effort bookkeeping. Runs the work, and on failure logs and continues.
 *
 * RELIABILITY RULE (2026-08-18, after the quotation incident): between
 * receiving a customer message and sending the reply, the ONLY thing allowed
 * to abort is generating the reply itself. Everything else — lead scoring,
 * conversation state, handoff records, quotation drafts — is bookkeeping. A
 * failure there must degrade to "we did not record that", never to "the
 * customer got nothing".
 *
 * The quotation bug proved why: one duplicate key threw, the send never ran,
 * and the Page looked dead from outside with no error visible to anyone.
 */
async function bestEffort(label, context, fn) {
  try {
    return await fn();
  } catch (error) {
    console.error("[messenger] %s failed (%s) — continuing so the customer still gets a reply: %s",
      label, context, error.message);
    return null;
  }
}

function cleanText(value, max = 300) {
  return String(value == null ? "" : value).trim().slice(0, max);
}

function normaliseComparable(value) {
  return cleanText(value).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function bookingStartFromRequest(request = {}) {
  const values = request.field_values && typeof request.field_values === "object" ? request.field_values : {};
  let raw = cleanText(request.start_at || request.datetime || request.date_time || "");
  if (!raw && values.preferred_date && values.preferred_time) {
    raw = `${cleanText(values.preferred_date, 40)}T${cleanText(values.preferred_time, 20)}`;
  }
  if (!raw) return null;
  raw = raw.replace(" ", "T");
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  if (/^\d{4}-\d{2}-\d{2}T\d{1,2}:\d{2}(?::\d{2})?$/.test(raw)) {
    raw = `${raw}+08:00`;
  }
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

function bookingFieldValuesFromRequest(request = {}) {
  const out = {};
  const values = request.field_values && typeof request.field_values === "object" ? request.field_values : {};
  for (const [key, value] of Object.entries(values)) {
    const clean = cleanText(value, 500);
    if (clean) out[key] = clean;
  }
  for (const key of [
    "purpose", "preferred_date", "preferred_time", "preferred_meeting_channel",
    "onboarding_topic", "branch_location", "party_size", "guest_count",
    "check_in_date", "check_out_date", "room_type", "table_preference",
    "doctor_preference", "staff_preference", "therapist_preference",
    "vehicle_model", "property_unit", "address", "concern",
    "special_requests", "notes_remarks", "deposit_payment"
  ]) {
    const clean = cleanText(request[key], 500);
    if (clean) out[key] = clean;
  }
  return out;
}

function jitsiRoomUrl({ companyId, serviceName, start }) {
  const serviceSlug = normaliseComparable(serviceName).slice(0, 32) || "booking";
  const when = start.toISOString().replace(/[-:]/g, "").slice(0, 13);
  const suffix = crypto.randomBytes(3).toString("hex");
  return `https://meet.jit.si/aistaff-${companyId.slice(0, 8)}-${serviceSlug}-${when}-${suffix}`;
}

function shouldCreateJitsiLink(setting, request, fieldValues, serviceName) {
  const channel = cleanText(request.preferred_meeting_channel || fieldValues.preferred_meeting_channel, 120).toLowerCase();
  if (/in.?person|branch|store|onsite|on site|walk.?in/.test(channel)) return false;
  const haystack = [
    setting?.booking_type,
    serviceName,
    channel,
    fieldValues.purpose,
    fieldValues.onboarding_topic
  ].filter(Boolean).join(" ").toLowerCase();
  return setting?.booking_type === "ai_service_onboarding"
    || /online|video|jitsi|zoom|meet|consult|consultation|onboarding|demo|call/.test(haystack);
}

function bookingNeedsExclusiveTime(setting, serviceName, fieldValues = {}) {
  const haystack = [
    setting?.booking_type,
    serviceName,
    fieldValues.preferred_meeting_channel,
    fieldValues.purpose,
    fieldValues.onboarding_topic
  ].filter(Boolean).join(" ").toLowerCase();
  return setting?.booking_type === "ai_service_onboarding"
    || /online|video|jitsi|zoom|meet|meeting|consult|consultation|onboarding|demo|call/.test(haystack);
}

async function createMessengerBooking({ companyId, conversationId, lead, request }) {
  const setting = await prisma.bookingSetting.findUnique({ where: { company_id: companyId } });
  if (!setting?.enabled) return { ok: false, reason: "booking_disabled" };

  const customerName = cleanText(request.customer_name || request.name || lead?.customer_name, 160);
  const mobile = cleanText(request.mobile || request.mobile_number || request.phone || lead?.mobile_number, 60);
  const email = cleanText(request.email || lead?.email, 160);
  const fieldValues = bookingFieldValuesFromRequest(request);
  const start = bookingStartFromRequest(request);
  const serviceName = cleanText(
    request.service_name || request.service || request.service_package || fieldValues.service_package || fieldValues.purpose || lead?.service_needed || "Booking",
    160
  );

  if (!customerName) return { ok: false, reason: "missing_customer_name" };
  if (!mobile && !email) return { ok: false, reason: "missing_contact" };
  if (!start) return { ok: false, reason: "missing_exact_datetime" };

  const services = await prisma.bookingService.findMany({
    where: { company_id: companyId, active: true },
    orderBy: [{ display_order: "asc" }, { created_at: "asc" }]
  });
  const wanted = normaliseComparable(serviceName);
  const service = services.find((item) => normaliseComparable(item.name) === wanted)
    || services.find((item) => wanted && normaliseComparable(item.name).includes(wanted))
    || null;
  const duration = service?.duration_minutes || Number(request.duration_minutes) || 60;
  const end = new Date(start.getTime() + Math.max(5, Math.min(1440, duration)) * 60 * 1000);
  if (shouldCreateJitsiLink(setting, request, fieldValues, service?.name || serviceName) && !fieldValues.meeting_link) {
    fieldValues.meeting_link = jitsiRoomUrl({ companyId, serviceName: service?.name || serviceName, start });
  }

  const existing = await prisma.booking.findFirst({
    where: {
      company_id: companyId,
      conversation_id: conversationId,
      start_at: start,
      service_name: service?.name || serviceName,
      status: { in: ["requested", "pending_confirmation", "confirmed", "paid"] }
    },
    orderBy: { created_at: "desc" }
  });
  if (existing) return { ok: true, reused: true, booking: existing };

  if (bookingNeedsExclusiveTime(setting, service?.name || serviceName, fieldValues)) {
    const conflict = await prisma.booking.findFirst({
      where: {
        company_id: companyId,
        status: { in: ["requested", "pending_confirmation", "confirmed", "paid"] },
        start_at: { lt: end },
        end_at: { gt: start }
      },
      orderBy: { start_at: "asc" }
    });
    if (conflict) return { ok: false, reason: "time_conflict", conflict };
  }

  const booking = await prisma.booking.create({
    data: {
      company_id: companyId,
      service_id: service?.id || null,
      conversation_id: conversationId,
      lead_id: lead?.id || null,
      customer_name: customerName,
      mobile_number: mobile || null,
      email: email || null,
      service_name: service?.name || serviceName,
      start_at: start,
      end_at: end,
      status: "pending_confirmation",
      source: "messenger",
      field_values: fieldValues,
      notes: cleanText(request.notes || request.note || fieldValues.notes_remarks, 3000) || null
    }
  });
  return { ok: true, reused: false, booking };
}

/**
 * Fetch the customer's Facebook profile once.
 *
 * A PSID is a 17-digit number — useless to whoever opens the inquiry list.
 * Meta's User Profile API returns first_name, last_name and profile_pic for
 * anyone who has messaged the Page, which is what turns "27345257018440110"
 * into "Miguel Pineda" with a face next to it.
 *
 * Fetched ONCE and cached on the conversation: it costs a Graph call, the data
 * barely changes, and a customer sending ten messages should not cost ten
 * lookups. Best-effort throughout — a profile is a nicety, never a reason to
 * delay a reply.
 */
async function fetchMessengerProfile(page, psid) {
  const token = decryptSecret(page.page_access_token_encrypted) || process.env.META_PAGE_ACCESS_TOKEN;
  if (!token) return null;
  const url = `https://graph.facebook.com/v20.0/${encodeURIComponent(psid)}`
    + `?fields=first_name,last_name,profile_pic&access_token=${encodeURIComponent(token)}`;
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    console.warn("[profile] lookup failed psid=%s %s %s", psid, response.status, body.slice(0, 160));
    return null;
  }
  const json = await response.json();
  const name = [json.first_name, json.last_name].filter(Boolean).join(" ").trim();
  return { name: name || null, picture: json.profile_pic || null };
}

async function handleClientMessengerEvent({ page, psid, text, maybeCreateQuotationDraft }) {
  const [settings, company] = await Promise.all([
    prisma.companySetting.findUnique({ where: { company_id: page.company_id } }),
    prisma.company.findUnique({
      where: { id: page.company_id },
      select: { id: true, name: true, industry: true }
    })
  ]);
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

  await bestEffort("customer message persist", `company=${page.company_id}`, () =>
    prisma.message.create({
      data: {
        company_id: page.company_id,
        conversation_id: conversation.id,
        sender_type: "customer",
        sender_id: psid,
        message_text: text
      }
    }));

  // Real name and photo, once per conversation.
  if (!conversation.profile_fetched_at) {
    await bestEffort("profile lookup", `psid=${psid}`, async () => {
      const profile = await fetchMessengerProfile(page, psid);
      await prisma.conversation.update({
        where: { id: conversation.id },
        data: {
          // Mark the attempt either way, so a Page without the permission does
          // not retry on every single message forever.
          profile_fetched_at: new Date(),
          ...(profile?.name ? { customer_name: profile.name } : {}),
          ...(profile?.picture ? { profile_pic_url: profile.picture } : {})
        }
      });
      if (profile?.name) console.log("[profile] %s -> %s", psid, profile.name);
    });
  }

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

  await bestEffort("website research", `company=${page.company_id}`, async () => {
    const research = await maybeAddWebsiteResearchToLead({
      prisma,
      company,
      lead,
      message: text
    });
    if (research.ok && !research.skipped) {
      console.log("[research] website context saved conversation=%s url=%s title=%s",
        conversation.id, research.url, research.title || "");
    }
  });

  // Generating the reply is the one step that genuinely cannot be skipped. If
  // it fails we do NOT invent a canned apology (rule 2) — we flag the thread
  // for a human and log loudly, so a person answers instead of a robot
  // pretending nothing happened.
  let ai;
  try {
    ai = await keepTypingOn(page, psid, () => generateSalesReply({ companyId: page.company_id, conversationId: conversation.id, message: text }));
  } catch (error) {
    console.error("[messenger] REPLY GENERATION FAILED company=%s conversation=%s: %s",
      page.company_id, conversation.id, error.message);
    await bestEffort("failure handoff", `company=${page.company_id}`, () =>
      prisma.$transaction([
        prisma.conversation.update({
          where: { id: conversation.id },
          data: { needs_human: true, status: "handoff" }
        }),
        prisma.humanHandoff.create({
          data: {
            company_id: page.company_id,
            conversation_id: conversation.id,
            reason: `AI reply generation failed: ${error.message}`
          }
        })
      ]));
    return;
  }

  const updatedLead = await bestEffort("lead update", `lead=${lead.id}`, () =>
    prisma.lead.update({
      where: { id: lead.id },
      data: {
        ...ai.leadPatch,
        lead_score: ai.leadScore,
        quotation_ready: ai.quotationReady,
        lead_status: ai.quotationReady ? "quotation_ready" : "contacted"
      }
    })) || lead;

  await bestEffort("conversation update", `conversation=${conversation.id}`, () =>
    prisma.conversation.update({
      where: { id: conversation.id },
      data: {
        intent: ai.intent,
        lead_score: ai.leadScore,
        needs_human: ai.needsHuman,
        status: ai.needsHuman ? "handoff" : "open"
      }
    }));

  if (ai.needsHuman && settings?.human_handoff_enabled) {
    await bestEffort("handoff record", `company=${page.company_id}`, () =>
      prisma.humanHandoff.create({
        data: {
          company_id: page.company_id,
          conversation_id: conversation.id,
          reason: ai.handoffReason || "AI requested human handoff"
        }
      }));

    // Tell the owner. A handoff flag in a dashboard nobody has open is not a
    // handoff — they find out when the customer has already given up. This is
    // the first thing `notify_email` has ever been read for.
    await bestEffort("handoff email", `company=${page.company_id}`, async () => {
      if (!settings?.notify_email) return;
      const company = await prisma.company.findUnique({
        where: { id: page.company_id },
        select: { name: true }
      });
      await notifyHandoff({
        to: settings.notify_email,
        companyName: company?.name || "your business",
        lead: updatedLead,
        reason: ai.handoffReason,
        lastMessage: text,
        conversationId: conversation.id
      });
    });
  }

  await bestEffort("quotation draft", `company=${page.company_id}`, () =>
    maybeCreateQuotationDraft({
      companyId: page.company_id,
      lead: updatedLead,
      conversationId: conversation.id
    }));

  // Record what Closer could not answer. This is the evidence behind the
  // "we tune it with you" promise — a real question, from a real customer,
  // that cost a real answer. Grouped by topic so the count shows what is
  // actually costing sales, rather than a list of near-duplicates.
  if (ai.unanswered && ai.unanswered.topic) {
    await bestEffort("knowledge gap", `company=${page.company_id}`, async () => {
      const existing = await prisma.knowledgeGap.findFirst({
        where: { company_id: page.company_id, topic: ai.unanswered.topic, status: "open" }
      });
      if (existing) {
        await prisma.knowledgeGap.update({
          where: { id: existing.id },
          data: { times_asked: { increment: 1 }, last_asked_at: new Date() }
        });
      } else {
        await prisma.knowledgeGap.create({
          data: {
            company_id: page.company_id,
            question: ai.unanswered.question || ai.unanswered.topic,
            topic: ai.unanswered.topic,
            conversation_id: conversation.id
          }
        });
      }
      console.log("[gap] company=%s topic=%s", page.company_id, ai.unanswered.topic);
    });
  }

  if (!settings?.auto_reply_enabled) return;

  // HANDOFF MUST NOT MEAN SILENCE.
  //
  // This used to be `if (!auto_reply_enabled || ai.needsHuman) return;` — so
  // whenever the agent decided a human was needed, a reply it had already
  // written was thrown away and the customer got nothing at all. From their
  // side that is indistinguishable from being ignored, and it is worse than
  // the handoff itself: they leave before the human ever sees the thread.
  //
  // The reply is already handoff-aware (ai.js returns the model's own words
  // when needsHuman is set), so we send it AND alert a human. The only case we
  // stay quiet is when there is genuinely nothing to say.
  if (!ai.reply || !String(ai.reply).trim()) {
    console.warn("[messenger] empty reply, nothing sent company=%s conversation=%s needsHuman=%s",
      page.company_id, conversation.id, ai.needsHuman);
    return;
  }

  // SEND FIRST, RECORD SECOND. Persisting the outgoing message used to happen
  // before the send, so a database hiccup here would have swallowed a reply we
  // had already paid to generate — the same shape of failure as the quotation
  // bug. Getting the answer to the customer is the job; the transcript row is
  // bookkeeping.
  await sendMessengerReplyWithTyping(page, psid, async () => ai.reply);

  for (const followUp of ai.followUpMessages || []) {
    await wait(900);
    await sendMessengerText(page, psid, followUp);
  }

  // Attachments go AFTER the text, so the customer reads the sentence that
  // introduces them first. Each is best-effort and individually wrapped: a
  // file Facebook cannot fetch must not cost them the reply they already have.
  const delivered = [];
  for (const media of ai.sendMedia || []) {
    await bestEffort(`send ${media.type}`, `company=${page.company_id}`, async () => {
      if (media.type === "image") await sendMessengerImage(page, psid, media.url);
      else await sendMessengerFile(page, psid, media.url, media.type === "video" ? "video" : "file");
      // Only record what actually went out. Recording a failed send would make
      // the no-repeat rule block a file the customer never received.
      delivered.push(media);
      console.log("[media] sent %s to psid=%s url=%s", media.type, psid, media.url);
    });
  }

  await bestEffort("ai message persist", `conversation=${conversation.id}`, () =>
    prisma.message.create({
      data: {
        company_id: page.company_id,
        conversation_id: conversation.id,
        sender_type: "ai",
        sender_id: "ai_sales_assistant",
        message_text: ai.reply,
        // This is what stops the same image going out twice: the next turn
        // reads it back and both the prompt and resolveSendMedia exclude it.
        attachments: delivered.length ? delivered : undefined,
        ai_generated: true
      }
    }));

  for (const followUp of ai.followUpMessages || []) {
    await bestEffort("ai follow-up persist", `conversation=${conversation.id}`, () =>
      prisma.message.create({
        data: {
          company_id: page.company_id,
          conversation_id: conversation.id,
          sender_type: "ai",
          sender_id: "ai_sales_assistant",
          message_text: followUp,
          ai_generated: true
        }
      }));
  }

  if (ai.bookingRequest) {
    await bestEffort("booking request", `company=${page.company_id}`, async () => {
      const result = await createMessengerBooking({
        companyId: page.company_id,
        conversationId: conversation.id,
        lead: updatedLead,
        request: ai.bookingRequest
      });

      if (!result.ok) {
        console.warn("[booking] not created company=%s conversation=%s reason=%s",
          page.company_id, conversation.id, result.reason);
        const retryText = result.reason === "missing_exact_datetime"
          ? "I still need the exact date and time before I can create the booking request."
          : result.reason === "time_conflict"
            ? "That time already has a booking on our calendar. Please send another preferred date and time."
          : "I still need one more booking detail before I can create the request.";
        await wait(600);
        await sendMessengerText(page, psid, retryText);
        await prisma.message.create({
          data: {
            company_id: page.company_id,
            conversation_id: conversation.id,
            sender_type: "ai",
            sender_id: "ai_sales_assistant",
            message_text: retryText,
            ai_generated: true
          }
        });
        return;
      }

      const booking = result.booking;
      const ref = `BK-${String(booking.id).slice(0, 8).toUpperCase()}`;
      const details = booking.field_values && typeof booking.field_values === "object" ? booking.field_values : {};
      const when = new Date(booking.start_at).toLocaleString("en-PH", {
        dateStyle: "medium",
        timeStyle: "short",
        timeZone: "Asia/Manila"
      });
      const lines = [
        result.reused ? "Your booking request is already on our calendar." : "Booking request created.",
        `Reference: ${ref}`,
        `For: ${booking.service_name}`,
        `When: ${when}`,
        details.meeting_link ? `Meeting link: ${details.meeting_link}` : "",
        "Status: pending confirmation"
      ].filter(Boolean);
      await wait(600);
      await sendMessengerText(page, psid, lines.join("\n"));
      await prisma.message.create({
        data: {
          company_id: page.company_id,
          conversation_id: conversation.id,
          sender_type: "ai",
          sender_id: "ai_sales_assistant",
          message_text: lines.join("\n"),
          ai_generated: true
        }
      });
      await bestEffort("booking customer email", `booking=${booking.id}`, async () => {
        if (!booking.email) return;
        const company = await prisma.company.findUnique({ where: { id: page.company_id }, select: { name: true } });
        await notifyBookingCreated({
          to: booking.email,
          companyName: company?.name || "your booking",
          booking,
          audience: "customer"
        });
      });
      await bestEffort("booking staff email", `booking=${booking.id}`, async () => {
        if (!settings?.notify_email) return;
        const company = await prisma.company.findUnique({ where: { id: page.company_id }, select: { name: true } });
        await notifyBookingCreated({
          to: settings.notify_email,
          companyName: company?.name || "your business",
          booking,
          audience: "staff"
        });
      });
      console.log("[booking] %s booking=%s conversation=%s reused=%s", ref, booking.id, conversation.id, result.reused);
    });
  }

  // Someone tried to extract information. Closer already refused — this is
  // purely so a human finds out. Sent to the tenant AND to AIStaff, because a
  // technique used against one customer will be used against the others.
  if (ai.securityAlert) {
    await bestEffort("security alert", `company=${page.company_id}`, async () => {
      const company = await prisma.company.findUnique({
        where: { id: page.company_id },
        select: { name: true }
      });
      const recipients = [settings?.notify_email, process.env.ADMIN_ALERT_EMAIL || process.env.SEED_ADMIN_EMAIL]
        .filter(Boolean)
        .filter((email, i, all) => all.indexOf(email) === i);

      for (const to of recipients) {
        await notifySecurityAlert({
          to,
          companyName: company?.name || "your business",
          alert: ai.securityAlert,
          lastMessage: text,
          conversationId: conversation.id,
          customerName: conversation.customer_name || null
        });
      }
      console.warn("[security] %s on company=%s conversation=%s: %s",
        ai.securityAlert.type, page.company_id, conversation.id, ai.securityAlert.summary);
    });
  }

  /**
   * The payment link, sent as its own message right after the reply.
   *
   * Separate on purpose: a link buried mid-paragraph gets missed, and a short
   * message containing almost nothing but the link is what a person actually
   * taps. The AMOUNT is stated here in code rather than trusted to the model —
   * a wrong price in a payment message is the one mistake that cannot be
   * walked back.
   */
  if (ai.paymentRequest) {
    await bestEffort("payment link", `company=${page.company_id}`, async () => {
      const result = await createCheckoutLink({
        companyId: page.company_id,
        conversationId: conversation.id,
        email: ai.paymentRequest.email,
        name: ai.paymentRequest.name || updatedLead?.customer_name,
        mobile: ai.paymentRequest.mobile || updatedLead?.mobile_number,
        planSlug: ai.paymentRequest.plan,
        billingFrequency: ai.paymentRequest.billing
      });

      if (!result.ok) {
        console.warn("[checkout] not created for company=%s reason=%s", page.company_id, result.reason);
        return;
      }

      const peso = (n) => `₱${Number(n).toLocaleString("en-PH")}`;
      const lines = result.billingFrequency === "annual"
        ? [`${peso(result.amount)} for 12 months — that is ${peso(result.monthlyEquivalent)}/month, saving ${peso(result.saving)}.`]
        : [`${peso(result.amount)} per month.`];
      lines.push(result.url);
      lines.push(`Reference: ${result.orderNumber}`);
      const paymongoMethods = String(process.env.PAYMONGO_METHODS || "")
        .split(",")
        .map((m) => m.trim().toLowerCase())
        .filter(Boolean);
      if (paymongoMethods.includes("qrph")) {
        if (paymongoMethods.length === 1) {
          lines.push("Direct GCash and card payments are still being worked on. For now, payment is available through QRPh QR code.");
        }
        lines.push("QRPh: tap Continue, then screenshot or download the QR. Upload/scan it in GCash, Maya, or any banking app with QR payment. You can also open the link on another device and scan it from your payment app.");
      }

      await wait(600);
      await sendMessengerText(page, psid, lines.join("\n"));

      await prisma.message.create({
        data: {
          company_id: page.company_id,
          conversation_id: conversation.id,
          sender_type: "ai",
          sender_id: "ai_sales_assistant",
          message_text: lines.join("\n"),
          ai_generated: true
        }
      });
      console.log("[checkout] link sent psid=%s order=%s reused=%s", psid, result.orderNumber, result.reused);
    });
  }
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
      // Ad-click contact data (ads_context_data: name, email, phone) only ever
      // arrives on the referral, never in the message text — so ai.js's text
      // extraction cannot recover it. Capturing it here keeps click-to-Messenger
      // ad leads from being lost now that the demo path (its only previous
      // consumer) is gone. TODO: write this straight onto the Lead row instead
      // of in-memory session state.
      if (leadContact) recordLeadGenContact(psid, leadContact);

      // DEMO ROUTING REMOVED 2026-08-17.
      //
      // Every Page — including AIStaff's own — is now answered by Closer via
      // handleClientMessengerEvent, reading that company's knowledge base
      // through the same generateSalesReply path every tenant uses. One code
      // path, one knowledge base, no per-Page special cases: an improvement to
      // Closer is an improvement for every tenant, and AIStaff dogfoods its own
      // product.
      //
      // The old `?ref=demo` roleplay branch (aistaff-demo.js) is no longer
      // reachable from the webhook. That module still exports
      // isAistaffMarketingPage (token fallback) and the lead-capture helpers,
      // so it is NOT deleted — and it is where §13's ~207 isTagalog violations
      // live, which is a separate deferred cleanup.
      // Per-event isolation. Meta batches several messaging events into one
      // webhook POST, so without this a single bad event aborts the loop and
      // every other customer in the same batch is silently skipped too.
      if (text) {
        try {
          await handleClientMessengerEvent({ page, psid, text, maybeCreateQuotationDraft });
        } catch (error) {
          console.error("[messenger] event handling failed page=%s psid=%s: %s\n%s",
            pageId, psid, error.message, error.stack);
        }
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
