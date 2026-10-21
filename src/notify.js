/**
 * Notifications to the business owner: handoffs, setup milestones, gap digests.
 *
 * WHY THIS EXISTS: `CompanySetting.notify_email` has been stored and editable
 * since the beginning and was read by NOTHING. A handoff flag in a dashboard
 * nobody has open is not a handoff — the owner finds out when the customer has
 * already given up.
 *
 * SENDER: support@aistaff.click. Hostinger enforces sender ownership —
 * authenticating as sales@ and sending as support@ is rejected with
 * "553 Sender address rejected: not owned by user". So NOTIFY_SMTP_USER /
 * NOTIFY_SMTP_PASS must hold that mailbox's own credentials. Until they are
 * set, this module logs what it would have sent and returns cleanly rather
 * than throwing — a missing mailbox must never break a customer reply.
 */

require("./mail-ipv4");
const nodemailer = require("nodemailer");

const FROM_NAME = "AIStaff";
const FROM_ADDRESS = process.env.NOTIFY_SMTP_USER || "support@aistaff.click";

function notifyConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.NOTIFY_SMTP_USER && process.env.NOTIFY_SMTP_PASS);
}

function transport() {
  const port = Number(process.env.SMTP_PORT || 465);
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    auth: { user: process.env.NOTIFY_SMTP_USER, pass: process.env.NOTIFY_SMTP_PASS }
  });
}

/**
 * Send one notification. Never throws — a mail failure must not affect a
 * customer conversation, so every caller gets a result object instead.
 */
/**
 * Every alert has two audiences, told apart at a glance:
 *  - tenant   -> subject "[Marga Enterprises] ...", sender "Marga Enterprises alerts"
 *  - platform -> subject "[AIStaff platform] Marga Enterprises · ...", sender
 *                "AIStaff Platform", with a banner saying who the tenant copy went to.
 */
async function sendNotification({ to, subject, text, html, audience, tenantName, tenantRecipients }) {
  if (!to) return { ok: false, reason: "no_recipient" };
  let fromName = FROM_NAME;
  if (audience === "tenant" && tenantName) {
    subject = `[${tenantName}] ${subject}`;
    fromName = `AIStaff for ${tenantName}`;
  } else if (audience === "platform") {
    const who = (tenantRecipients || []).join(", ") || "nobody (the tenant has no alert contacts!)";
    subject = `[AIStaff platform] ${tenantName ? `${tenantName} · ` : ""}${subject}`;
    fromName = "AIStaff Platform";
    const note = `PLATFORM COPY for AIStaff support — tenant: ${tenantName || "?"}. The tenant's alert contacts got their own copy: ${who}.`;
    text = `${note}\n\n${text || ""}`;
    if (html) html = `<div style="background:#eef2ff;border:1px solid #c7d2fe;color:#3730a3;border-radius:8px;padding:8px 12px;margin:0 0 12px;font-family:system-ui,sans-serif;font-size:13px"><b>Platform copy</b> for AIStaff support — tenant: <b>${escapeHtmlText(tenantName || "?")}</b>. Tenant copy sent to: ${escapeHtmlText(who)}.</div>${html}`;
  }

  if (!notifyConfigured()) {
    // Visible, not silent. Without this the feature would look built and do
    // nothing — the exact failure `notify_email` already had for months.
    console.warn("[notify] NOT SENT (support@ mailbox not configured) to=%s subject=%s", to, subject);
    return { ok: false, reason: "not_configured" };
  }

  try {
    const info = await transport().sendMail({
      from: `${String(fromName).replace(/[<>"]/g, "")} <${FROM_ADDRESS}>`,
      to,
      subject,
      text,
      html: html || undefined
    });
    console.log("[notify] sent to=%s subject=%s id=%s", to, subject, info.messageId);
    return { ok: true };
  } catch (error) {
    console.error("[notify] FAILED to=%s subject=%s: %s", to, subject, error.message);
    return { ok: false, reason: error.message };
  }
}

/** Shared shell so every notification looks like it came from the same place. */
function wrap(title, bodyHtml) {
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#1a2233">
    <h2 style="margin:0 0 4px;font-size:18px">${title}</h2>
    ${bodyHtml}
    <hr style="border:0;border-top:1px solid #e3e8f0;margin:24px 0 12px" />
    <p style="font-size:12px;color:#6a7382;margin:0">AIStaff · <a href="https://aistaff.click/admin/dashboard" style="color:#4b3ecf">Open your dashboard</a></p>
  </div>`;
}

/**
 * A customer needs a person. This is the one that costs money when it is late,
 * so it leads with the contact details and what they asked — everything needed
 * to pick up the phone without opening the dashboard first.
 */
async function notifyHandoff({ to, companyName, lead, reason, lastMessage, conversationId }) {
  const name = lead?.customer_name || "A customer";
  const contact = [lead?.mobile_number, lead?.email].filter(Boolean).join(" · ");

  const lines = [
    `${name} needs a person on your Facebook Page.`,
    "",
    contact ? `Contact: ${contact}` : "Contact: not captured yet — reply in Messenger to reach them",
    lead?.service_needed ? `Asking about: ${lead.service_needed}` : "",
    reason ? `Why Closer stopped: ${reason}` : "",
    "",
    lastMessage ? `Their last message:\n"${lastMessage}"` : "",
    "",
    `Open the conversation: https://aistaff.click/admin/conversations/${conversationId || ""}`
  ].filter(Boolean).join("\n");

  const html = wrap(`${name} needs a person`, `
    <p style="margin:0 0 16px;color:#6a7382;font-size:13px">on ${companyName}'s Facebook Page</p>
    <table style="width:100%;font-size:14px;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#6a7382;width:120px">Contact</td><td style="padding:6px 0"><b>${contact || "not captured yet"}</b></td></tr>
      ${lead?.service_needed ? `<tr><td style="padding:6px 0;color:#6a7382">Asking about</td><td style="padding:6px 0">${lead.service_needed}</td></tr>` : ""}
      ${reason ? `<tr><td style="padding:6px 0;color:#6a7382">Why</td><td style="padding:6px 0">${reason}</td></tr>` : ""}
    </table>
    ${lastMessage ? `<blockquote style="margin:16px 0;padding:12px 14px;background:#f7f8fb;border-left:3px solid #6b4dff;border-radius:0 8px 8px 0;font-size:14px">${lastMessage}</blockquote>` : ""}
    <p style="margin:20px 0 0"><a href="https://aistaff.click/admin/conversations/${conversationId || ""}" style="display:inline-block;padding:10px 18px;background:#1a2233;color:#fff;text-decoration:none;border-radius:8px;font-size:14px">Open the conversation</a></p>
  `);

  return sendNotification({ to, subject: `${name} needs a person — ${companyName}`, text: lines, html });
}

/**
 * Setup milestone. Fires at 50% and 100% only — a message on every step would
 * be nagging, and people ignore what arrives too often.
 */
async function notifySetupMilestone({ to, companyName, percent, done, total, missing = [] }) {
  const complete = percent >= 100;
  const subject = complete
    ? `${companyName}: your Closer setup is complete`
    : `${companyName}: your Closer setup is ${percent}% done`;

  const text = complete
    ? [`Your Closer setup is complete — ${done} of ${total} steps.`, "",
       "It is answering your customers from everything you entered. When your prices or promos change, update them in the Knowledge Base and Closer uses the new version on the next message.",
       "", "https://aistaff.click/admin/knowledge-base"].join("\n")
    : [`You are ${percent}% through setting up Closer — ${done} of ${total} steps.`, "",
       missing.length ? `Still to do:\n${missing.map((m) => `  • ${m}`).join("\n")}` : "",
       "", "Customers asking about anything not yet entered will be told someone will follow up.",
       "", "https://aistaff.click/admin/knowledge-base"].filter(Boolean).join("\n");

  const html = wrap(complete ? "Your setup is complete" : `Setup is ${percent}% done`, `
    <div style="height:8px;border-radius:99px;background:#e2ddf5;overflow:hidden;margin:12px 0 16px">
      <div style="height:100%;width:${percent}%;background:${complete ? "#2f9e63" : "#6b4dff"}"></div>
    </div>
    <p style="font-size:14px;margin:0 0 16px">${done} of ${total} steps.</p>
    ${!complete && missing.length ? `<p style="font-size:14px;margin:0 0 8px"><b>Still to do</b></p>
      <ul style="font-size:14px;line-height:1.9;margin:0 0 16px;padding-left:20px;color:#8a5a00">${missing.map((m) => `<li>${m}</li>`).join("")}</ul>
      <p style="font-size:13px;color:#6a7382">Customers asking about these will be told someone will follow up.</p>` : ""}
    ${complete ? `<p style="font-size:14px">Closer is answering from everything you entered. Update your prices or promos any time — it uses the new version on the very next message.</p>` : ""}
    <p style="margin:20px 0 0"><a href="https://aistaff.click/admin/knowledge-base" style="display:inline-block;padding:10px 18px;background:#1a2233;color:#fff;text-decoration:none;border-radius:8px;font-size:14px">${complete ? "Review your knowledge base" : "Continue setup"}</a></p>
  `);

  return sendNotification({ to, subject, text, html });
}

/**
 * The gap digest — ongoing improvement support, triggered by real unanswered
 * customer questions.
 *
 * TRIGGERED BY EVIDENCE, NEVER BY THE CLOCK. A daily email on one conversation
 * is noise, and noise teaches people to ignore the sender. This only goes out
 * when there are real unanswered questions worth acting on.
 */
async function notifyGapDigest({ to, companyName, gaps = [], periodLabel = "this week" }) {
  if (!gaps.length) return { ok: false, reason: "nothing_to_report" };

  const text = [
    `${gaps.length} question${gaps.length === 1 ? "" : "s"} your customers asked ${periodLabel} that Closer could not answer:`,
    "",
    ...gaps.map((g) => `  • ${g.question}${g.times_asked > 1 ? `  (asked ${g.times_asked}×)` : ""}`),
    "",
    "Answer them once and Closer handles them from then on.",
    "",
    "https://aistaff.click/admin/knowledge-base"
  ].join("\n");

  const html = wrap(`${gaps.length} question${gaps.length === 1 ? "" : "s"} Closer could not answer`, `
    <p style="margin:0 0 16px;color:#6a7382;font-size:13px">Asked by real customers on ${companyName}'s Page ${periodLabel}. Most asked first.</p>
    <ul style="font-size:14px;line-height:1.9;padding-left:20px;margin:0 0 16px">
      ${gaps.map((g) => `<li>${g.question}${g.times_asked > 1 ? ` <span style="background:#fff3d6;color:#8a5a00;border-radius:99px;padding:2px 8px;font-size:12px;font-weight:700">asked ${g.times_asked}×</span>` : ""}</li>`).join("")}
    </ul>
    <p style="font-size:14px">Answer them once and Closer handles them from then on.</p>
    <p style="margin:20px 0 0"><a href="https://aistaff.click/admin/knowledge-base" style="display:inline-block;padding:10px 18px;background:#1a2233;color:#fff;text-decoration:none;border-radius:8px;font-size:14px">Answer these</a></p>
  `);

  return sendNotification({
    to,
    subject: `${gaps.length} thing${gaps.length === 1 ? "" : "s"} your customers asked that Closer could not answer`,
    text,
    html
  });
}



/**
 * A sale closed — tell the AIStaff team.
 *
 * Sent the moment provisioning succeeds, because the first hours after payment
 * are when a new customer is most likely to need help and most likely to give
 * up quietly. Everything needed to act is in the message: who they are, what
 * they paid, and a direct link to their workspace.
 */
async function notifyNewSale({ to, customer, order, company, setupPercent = 0 }) {
  const amount = `PHP ${Number(order.total || 0).toLocaleString("en-PH", { minimumFractionDigits: 2 })}`;
  const dashboard = "https://aistaff.click/admin/dashboard";

  const text = [
    `New customer: ${customer.company_name || customer.full_name}`,
    "",
    `Paid       : ${amount} (${order.billing_frequency})`,
    `Order      : ${order.order_number}`,
    `Account    : ${company.account_number} — ${company.name}`,
    "",
    `Contact    : ${customer.full_name}`,
    `Email      : ${customer.email}`,
    `Mobile     : ${customer.mobile_number || "not given"}`,
    customer.business_website ? `Website    : ${customer.business_website}` : "",
    customer.facebook_page_url ? `Page       : ${customer.facebook_page_url}` : "",
    customer.main_products_or_services ? `Sells      : ${customer.main_products_or_services}` : "",
    "",
    "They still need to connect their Facebook Page and fill in their knowledge base.",
    `Setup progress: ${setupPercent}%`,
    "",
    dashboard
  ].filter(Boolean).join("\n");

  const html = wrap(`New customer — ${amount}`, `
    <p style="margin:0 0 16px;font-size:15px"><b>${customer.company_name || customer.full_name}</b> just paid.</p>
    <table style="width:100%;font-size:14px;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#6a7382;width:110px">Paid</td><td style="padding:6px 0"><b>${amount}</b> · ${order.billing_frequency}</td></tr>
      <tr><td style="padding:6px 0;color:#6a7382">Order</td><td style="padding:6px 0">${order.order_number}</td></tr>
      <tr><td style="padding:6px 0;color:#6a7382">Account</td><td style="padding:6px 0">${company.account_number} — ${company.name}</td></tr>
      <tr><td style="padding:6px 0;color:#6a7382">Contact</td><td style="padding:6px 0">${customer.full_name}</td></tr>
      <tr><td style="padding:6px 0;color:#6a7382">Email</td><td style="padding:6px 0">${customer.email}</td></tr>
      <tr><td style="padding:6px 0;color:#6a7382">Mobile</td><td style="padding:6px 0">${customer.mobile_number || "not given"}</td></tr>
      ${customer.main_products_or_services ? `<tr><td style="padding:6px 0;color:#6a7382">Sells</td><td style="padding:6px 0">${customer.main_products_or_services}</td></tr>` : ""}
    </table>
    <p style="margin:16px 0 0;font-size:13px;color:#6a7382">They still need to connect their Page and fill in their knowledge base — setup is ${setupPercent}%.</p>
    <p style="margin:20px 0 0"><a href="${dashboard}" style="display:inline-block;padding:10px 18px;background:#1a2233;color:#fff;text-decoration:none;border-radius:8px;font-size:14px">Open the dashboard</a></p>
  `);

  return sendNotification({ to, subject: `New customer: ${customer.company_name || customer.full_name} — ${amount}`, text, html });
}



/**
 * Someone tried to extract information from a customer's Closer.
 *
 * Sent to BOTH the tenant and AIStaff: the tenant because it is their Page and
 * their customers, AIStaff because a technique used against one tenant will be
 * used against the others. Closer refuses these correctly — the point of the
 * alert is that a refusal nobody hears about teaches nobody anything.
 */
async function notifySecurityAlert({ to, companyName, alert, lastMessage, conversationId, customerName }) {
  const TYPE_LABEL = {
    impersonation: "Someone claimed to be you or your staff",
    credential_request: "Someone asked for passwords or login details",
    prompt_injection: "Someone tried to change how your agent behaves",
    data_request: "Someone asked for customer or business data"
  };
  const headline = TYPE_LABEL[alert.type] || "Someone tried to extract information";

  const text = [
    `${headline} on ${companyName}'s Facebook Page.`,
    "",
    `What they asked for: ${alert.summary || "not recorded"}`,
    customerName ? `Who: ${customerName}` : "",
    lastMessage ? `\nTheir message:\n"${lastMessage}"` : "",
    "",
    "Closer refused and gave nothing away. No action is needed unless you recognise this person.",
    "",
    `https://aistaff.click/admin/conversations/${conversationId || ""}`
  ].filter(Boolean).join("\n");

  const html = wrap(headline, `
    <p style="margin:0 0 16px;color:#6a7382;font-size:13px">on ${companyName}'s Facebook Page</p>
    <table style="width:100%;font-size:14px;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#6a7382;width:130px">They asked for</td><td style="padding:6px 0"><b>${alert.summary || "not recorded"}</b></td></tr>
      ${customerName ? `<tr><td style="padding:6px 0;color:#6a7382">Who</td><td style="padding:6px 0">${customerName}</td></tr>` : ""}
    </table>
    ${lastMessage ? `<blockquote style="margin:16px 0;padding:12px 14px;background:#fff5f5;border-left:3px solid #cf4b4b;border-radius:0 8px 8px 0;font-size:14px">${lastMessage}</blockquote>` : ""}
    <p style="font-size:14px;margin:16px 0 0">Closer refused and gave nothing away. No action is needed unless you recognise this person.</p>
    <p style="margin:20px 0 0"><a href="https://aistaff.click/admin/conversations/${conversationId || ""}" style="display:inline-block;padding:10px 18px;background:#1a2233;color:#fff;text-decoration:none;border-radius:8px;font-size:14px">Read the conversation</a></p>
  `);

  return sendNotification({ to, subject: `Security: ${headline.toLowerCase()} — ${companyName}`, text, html });
}

async function notifyBookingCreated({ to, companyName, booking, audience = "customer" }) {
  if (!booking) return { ok: false, reason: "missing_booking" };
  const ref = `BK-${String(booking.id).slice(0, 8).toUpperCase()}`;
  const when = new Date(booking.start_at).toLocaleString("en-PH", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Manila"
  });
  const details = booking.field_values && typeof booking.field_values === "object" ? booking.field_values : {};
  const meetingLink = details.meeting_link || "";
  const contact = [booking.mobile_number, booking.email].filter(Boolean).join(" · ");
  const confirmed = ["confirmed", "paid", "completed"].includes(String(booking.status || ""));
  const statusLabel = String(booking.status || "").replace(/_/g, " ") || "requested";
  const subject = audience === "staff"
    ? `${confirmed ? "New confirmed booking" : "New booking request"}: ${booking.service_name} — ${when}`
    : `${confirmed ? "Your booking is confirmed" : "Your booking request"}: ${booking.service_name} — ${when}`;

  const text = audience === "staff"
    ? [
        `${confirmed ? "New confirmed booking" : "New booking request"} for ${companyName}.`,
        "",
        `Reference : ${ref}`,
        `Customer  : ${booking.customer_name}`,
        contact ? `Contact   : ${contact}` : "",
        `Service   : ${booking.service_name}`,
        `When      : ${when}`,
        `Status    : ${statusLabel}`,
        meetingLink ? `Meeting   : ${meetingLink}` : "",
        booking.notes ? `Notes     : ${booking.notes}` : "",
        "",
        "Open bookings: https://aistaff.click/admin/bookings"
      ].filter(Boolean).join("\n")
    : [
        `Hi ${booking.customer_name},`,
        "",
        confirmed
          ? `Your booking for ${booking.service_name} is confirmed.`
          : `Your booking request for ${booking.service_name} has been received.`,
        `Reference: ${ref}`,
        `Schedule : ${when}`,
        meetingLink ? `Meeting link: ${meetingLink}` : "",
        "",
        confirmed
          ? "We will send reminders before the meeting."
          : "Status: pending confirmation. We will contact you if anything needs to be adjusted.",
        "",
        companyName
      ].filter(Boolean).join("\n");

  const html = wrap(
    audience === "staff"
      ? (confirmed ? "New confirmed booking" : "New booking request")
      : (confirmed ? "Booking confirmed" : "Booking request received"),
    `
    <p style="margin:0 0 16px;color:#6a7382;font-size:13px">${companyName}</p>
    <table style="width:100%;font-size:14px;border-collapse:collapse">
      <tr><td style="padding:6px 0;color:#6a7382;width:120px">Reference</td><td style="padding:6px 0"><b>${ref}</b></td></tr>
      <tr><td style="padding:6px 0;color:#6a7382">Customer</td><td style="padding:6px 0">${booking.customer_name}</td></tr>
      <tr><td style="padding:6px 0;color:#6a7382">Service</td><td style="padding:6px 0">${booking.service_name}</td></tr>
      <tr><td style="padding:6px 0;color:#6a7382">When</td><td style="padding:6px 0">${when}</td></tr>
      <tr><td style="padding:6px 0;color:#6a7382">Status</td><td style="padding:6px 0">${statusLabel}</td></tr>
      ${contact ? `<tr><td style="padding:6px 0;color:#6a7382">Contact</td><td style="padding:6px 0">${contact}</td></tr>` : ""}
      ${meetingLink ? `<tr><td style="padding:6px 0;color:#6a7382">Meeting</td><td style="padding:6px 0"><a href="${meetingLink}" style="color:#4b3ecf">${meetingLink}</a></td></tr>` : ""}
    </table>
    ${booking.notes ? `<blockquote style="margin:16px 0;padding:12px 14px;background:#f7f8fb;border-left:3px solid #6b4dff;border-radius:0 8px 8px 0;font-size:14px">${booking.notes}</blockquote>` : ""}
    ${audience === "staff" ? `<p style="margin:20px 0 0"><a href="https://aistaff.click/admin/bookings" style="display:inline-block;padding:10px 18px;background:#1a2233;color:#fff;text-decoration:none;border-radius:8px;font-size:14px">Open bookings</a></p>` : `<p style="font-size:13px;color:#6a7382">${confirmed ? "We will send reminders before the meeting." : "Status: pending confirmation."}</p>`}
  `);

  return sendNotification({ to, subject, text, html });
}

/**
 * The Page's Messenger credential was rejected by Facebook (usually 190/460:
 * the rep who connected it had their Facebook session reset). Until someone
 * reconnects, Closer cannot answer ANY customer. Silent failure here meant
 * customers were ignored for hours before anyone noticed.
 */
async function notifyFacebookDisconnected({ to, companyName, pageName, reason }) {
  const link = "https://aistaff.click/admin/settings";
  const text = [
    `Closer stopped replying on ${pageName || "your Facebook Page"} (${companyName}).`,
    "",
    `Facebook rejected the saved connection: ${reason || "access token invalidated"}.`,
    "This usually happens when the Facebook account that connected the Page changes its password, logs out of all devices, or is checked by Facebook security.",
    "",
    "A Page admin needs to reconnect the Page in AIStaff Settings > Facebook Page Connection:",
    link
  ].join("\n");
  const html = wrap("Closer stopped replying on Facebook", `
    <p style="font-size:14px;margin:0 0 12px"><b>${pageName || "Your Facebook Page"}</b> (${companyName}) is disconnected. Customers messaging the Page are not getting replies.</p>
    <p style="font-size:14px;margin:0 0 12px;color:#6a7382">Facebook said: ${reason || "access token invalidated"}</p>
    <p style="font-size:14px;margin:0 0 12px">This usually happens when the Facebook account that connected the Page changes its password, logs out of all devices, or is checked by Facebook security.</p>
    <p style="margin:20px 0 0"><a href="${link}" style="display:inline-block;padding:10px 18px;background:#1a2233;color:#fff;text-decoration:none;border-radius:8px;font-size:14px">Reconnect the Page</a></p>
  `);
  return sendNotification({ to, subject: `Action needed: Closer disconnected from ${pageName || "Facebook"} - ${companyName}`, text, html });
}

function escapeNotifyHtml(value) {
  return String(value ?? "").replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[ch]));
}

/**
 * A Business Engine request was saved in (or queued for) the tenant's own
 * system by Closer. Staff must not have to discover it by searching: the
 * tenant notify list and the platform admin get the reference and the facts.
 */
/** Staff resolve loop buttons + reply instructions (src/resolve-loop.js). */
function resolveBlock(requestId, recipient) {
  if (!requestId || !recipient) return { html: "", text: "", code: "" };
  const links = require("./resolve-loop").resolveLinks(requestId, recipient);
  const button = (href, label, bg) => `<a href="${href}" style="display:inline-block;margin:0 8px 8px 0;padding:10px 14px;border-radius:8px;background:${bg};color:#fff;text-decoration:none;font-weight:700;font-size:14px">${label}</a>`;
  return {
    code: links.code,
    html: `<div style="border:1px solid #c7d2fe;background:#eef2ff;border-radius:10px;padding:14px 16px;margin:0 0 16px">
      <p style="margin:0 0 10px;font-weight:700;color:#3730a3">Step 2 — only after you fixed it:</p>
      ${button(links.retry, "I fixed it — try again", "#15803d")}
      <p style="margin:6px 0 0;font-size:13px;color:#4b5563">Closer saves the request, sends the customer the reference on Messenger and by email, and emails you when done. If it still fails, you get a new email saying what is still wrong. (Replying <i>“fixed”</i> to this email works too.)</p>
    </div>`,
    text: ["STEP 2 — ONLY AFTER YOU FIXED IT:", `I fixed it — try again: ${links.retry}`, "Closer saves the request and sends the customer the reference. (Replying \"fixed\" to this email works too.)", ""].join("\n")
  };
}

async function notifyEngineRequest({ to, companyName, operationName, outcome, reference, details, customerName, reason, audience, tenantRecipients, systemName, contact, requestId = null }) {
  const resolution = outcome === "failed" ? resolutionSteps({ reason, systemName, contact }) : null;
  const queued = outcome === "staff_approval";
  const failed = outcome === "failed";
  const title = failed ? `ACTION NEEDED: ${operationName} could not be completed` : queued ? `${operationName} waiting for staff approval` : `${operationName} created by Closer`;
  const footer = failed
    ? "Closer did NOT save this request yet. Fix the problem above (step 1), then click \"I fixed it — try again\" (step 2). Please do not create it manually — Closer saves it and informs the customer."
    : queued ? "Approve or reject it in AIStaff > Settings > Business Engines." : "Please check it in your system and coordinate with the customer.";
  // Show coded values as their label ("Running / Print OK (1)"), not JSON.
  const rows = Object.entries(details || {})
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => [key, value && typeof value === "object" && "label" in value ? `${value.label} (${value.value})` : value]);
  const resolve = failed ? resolveBlock(requestId, to) : { html: "", text: "", code: "" };
  const text = [
    `${title} — ${companyName}`,
    "",
    resolutionText(resolution),
    resolve.text,
    reference ? `Reference: ${reference}` : "",
    failed && reason ? `Problem: ${reason}` : "",
    customerName ? `Messenger customer: ${customerName}` : "",
    "",
    ...rows.map(([key, value]) => `${key}: ${typeof value === "object" ? JSON.stringify(value) : value}`),
    "",
    footer
  ].filter((line, index, all) => line !== "" || all[index - 1] !== "").join("\n");
  const html = wrap(title, `
    ${resolutionHtml(resolution)}
    ${resolve.html}
    ${reference ? `<p style="font-size:16px;margin:0 0 12px"><b>Reference: ${escapeNotifyHtml(reference)}</b></p>` : ""}
    ${failed && reason ? `<p style="font-size:15px;margin:0 0 12px;color:#9a3412"><b>Problem:</b> ${escapeNotifyHtml(reason)}</p>` : ""}
    <p style="font-size:14px;margin:0 0 12px">${escapeNotifyHtml(companyName)}${customerName ? ` · Messenger customer: ${escapeNotifyHtml(customerName)}` : ""}</p>
    <table style="font-size:13px;border-collapse:collapse">${rows.map(([key, value]) => `<tr><td style="padding:3px 12px 3px 0;color:#6a7382;vertical-align:top">${escapeNotifyHtml(key)}</td><td style="padding:3px 0">${escapeNotifyHtml(typeof value === "object" ? JSON.stringify(value) : value)}</td></tr>`).join("")}</table>
    <p style="font-size:13px;margin:16px 0 0;color:#6a7382">${escapeNotifyHtml(footer)}</p>
  `);
  return sendNotification({ to, subject: `${reference ? `[${reference}] ` : ""}${title}${resolve.code ? ` [${resolve.code}]` : ""}`, text, html, audience, tenantName: companyName, tenantRecipients });
}

function escapeHtmlText(value) {
  return String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
}

function rowsTable(rows) {
  return `<table style="border-collapse:collapse;width:100%;font-size:14px">${rows
    .filter(([, value]) => value !== null && value !== undefined && value !== "")
    .map(([key, value]) => `<tr><td style="padding:4px 8px;color:#6a7382;vertical-align:top">${escapeHtmlText(key)}</td><td style="padding:4px 8px">${escapeHtmlText(value)}</td></tr>`)
    .join("")}</table>`;
}

/**
 * "What to do to resolve this" for any tenant, built from the problem the
 * tenant's own system (or AIStaff) reported. Works for every tenant: the
 * system's own message is quoted, the steps depend only on the kind of error.
 */
function resolutionSteps({ reason, systemName, contact }) {
  const system = systemName ? `your ${systemName} system` : "your company system";
  const text = String(reason || "").trim();
  const status = Number((text.match(/HTTP (\d{3})/) || [])[1] || 0);
  const message = text.replace(/^.*?\(HTTP \d{3}\):\s*/, "").trim() || text;
  const reach = [contact?.phone, contact?.email].filter(Boolean).join(" / ");
  // One way out (Mike 2026-10-20): fix it, then click "I fixed it — try again".
  // No manual creation / "I'll handle it": Closer saves it and informs the customer.
  void reach;
  const finish = ["Come back to this email and click \"I fixed it — try again\" below."];
  let headline;
  let fix;
  if (!text) {
    headline = "The request could not be completed automatically.";
    fix = [`Open the conversation in AIStaff › Inquiries to see what the customer needs.`];
  } else if (status === 409 || status === 422) {
    headline = `${systemName || "Your system"} refused the request because of a setting or rule.`;
    fix = [`Fix this in ${system}: ${message}`];
  } else if (status === 400) {
    headline = `${systemName || "Your system"} rejected one of the values sent.`;
    fix = [`Check this in the details below: ${message}`, "If the value is right, check the field rules in AIStaff › Settings › Business Engines › Workflows."];
  } else if (status === 401 || status === 403) {
    headline = `AIStaff's access to ${system} was refused.`;
    fix = [`Check the API key and its permissions in AIStaff › Settings › Connections & Actions${systemName ? ` (${systemName})` : ""}. Message: ${message}`];
  } else if (status === 404) {
    headline = `${systemName || "Your system"} could not find a record.`;
    fix = [`Check that the customer / item exists and is active in ${system}: ${message}`];
  } else if (status >= 500 || /timeout|timed out|ECONN|fetch failed|unreachable|network/i.test(text)) {
    headline = `${systemName || "Your system"} was down or did not answer.`;
    fix = [`Check that ${system} is running and reachable. Message: ${message}`];
  } else if (/disabled|not connected|turned off/i.test(text)) {
    headline = "The connection or job is switched off.";
    fix = [`Turn it on in AIStaff › Settings › Business Engines or Connections & Actions. Message: ${message}`];
  } else {
    headline = "The request could not be completed automatically.";
    fix = [`Reason given: ${message}`];
  }
  return { headline, steps: [...fix, ...finish] };
}

function resolutionHtml(resolution) {
  if (!resolution) return "";
  return `<div style="background:#fff7ed;border:1px solid #fdba74;border-radius:10px;padding:12px 16px;margin:0 0 16px">
    <p style="margin:0 0 6px;font-size:15px;color:#9a3412"><b>Step 1 — fix this first</b></p>
    <p style="margin:0 0 8px;font-size:14px">${escapeHtmlText(resolution.headline)}</p>
    <ol style="margin:0;padding-left:20px;font-size:14px">${resolution.steps.map((step) => `<li style="margin:4px 0">${escapeHtmlText(step)}</li>`).join("")}</ol>
  </div>`;
}

function resolutionText(resolution) {
  if (!resolution) return "";
  return ["WHAT TO DO TO RESOLVE THIS", resolution.headline, ...resolution.steps.map((step, index) => `${index + 1}. ${step}`), ""].join("\n");
}

/** Tenant alert contacts (alert_contacts, else notify_email) and the platform admin. */
function alertAudiences(settings) {
  const contacts = Array.isArray(settings?.alert_contacts) && settings.alert_contacts.length
    ? settings.alert_contacts
    : String(settings?.notify_email || "").split(/[,;\s]+/).filter((e) => e.includes("@")).map((email) => ({ name: "", email }));
  const tenant = contacts.filter((c) => c.email).map((c) => ({ email: c.email, label: c.name ? `${c.name} <${c.email}>` : c.email }));
  const platform = String(process.env.ADMIN_ALERT_EMAIL || process.env.SEED_ADMIN_EMAIL || "").split(/[,;\s]+/).filter((e) => e.includes("@"));
  return { tenant, platform, sms: contacts.filter((c) => c.phone).map((c) => ({ name: c.name, phone: c.phone })) };
}

async function sendToTenantAndPlatform({ settings, tenantName, build }) {
  const { tenant, platform } = alertAudiences(settings);
  const tenantLabels = tenant.map((t) => t.label);
  const results = [];
  for (const t of tenant) results.push(await sendNotification({ ...build({ email: t.email, audience: "tenant" }), to: t.email, audience: "tenant", tenantName }));
  for (const email of platform) {
    if (tenant.some((t) => t.email.toLowerCase() === email.toLowerCase())) continue;
    results.push(await sendNotification({ ...build({ email, audience: "platform" }), to: email, audience: "platform", tenantName, tenantRecipients: tenantLabels }));
  }
  return { ok: results.some((r) => r.ok), results };
}

/** Status update to the business's CUSTOMER (plain words, no internal states). */
async function notifyCustomerStatus({ to, companyName, customerName, statusText, nextStep, reference, details, companyId = null, conversationId = null }) {
  const title = reference ? `Your request ${reference} — ${companyName}` : `Update on your request — ${companyName}`;
  const rows = [["Status", statusText], ["Reference number", reference || "Not issued yet"], ...Object.entries(details || {})];
  const text = [
    `Hi${customerName ? ` ${customerName}` : ""},`,
    "",
    statusText,
    nextStep || "",
    "",
    ...rows.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k}: ${v}`),
    "",
    `— ${companyName}`
  ].join("\n");
  const html = wrap(escapeHtmlText(title), `<p>Hi${customerName ? ` ${escapeHtmlText(customerName)}` : ""},</p><p>${escapeHtmlText(statusText)}</p>${nextStep ? `<p>${escapeHtmlText(nextStep)}</p>` : ""}${rowsTable(rows)}<p style="color:#6a7382;font-size:13px">— ${escapeHtmlText(companyName)}</p>`);
  // Customer status emails go out FROM the tenant's own inbox (Settings > Channels > Email)
  // when it is connected; otherwise from the AIStaff system sender as before.
  if (companyId) {
    const { prisma } = require("./db");
    const emailChannel = require("./email-channel");
    const conversation = conversationId
      ? await prisma.conversation.findUnique({ where: { id: conversationId }, select: { channel: true, external_id: true } }).catch(() => null)
      : null;
    // The customer is already talking to us by email in this thread: Closer's reply IS the update.
    if (conversation?.channel === "email" && String(conversation.external_id || "").toLowerCase() === String(to || "").toLowerCase()) {
      return { ok: false, reason: "same_email_thread" };
    }
    const viaTenant = await emailChannel.sendTenantEmail({ companyId, to, subject: title, text, html, conversationId }).catch((error) => ({ ok: false, reason: error.message }));
    if (viaTenant.ok) return viaTenant;
    if (viaTenant.reason !== "not_connected") console.warn("[notify] tenant inbox send failed (%s), using AIStaff sender", viaTenant.reason);
  }
  return sendNotification({ to, subject: title, text, html });
}

/** Customer followed up and the request is still not resolved: tell staff again, urgently. */
async function notifyUnresolvedFollowup({ settings, companyName, minutesWaiting, customerMessage, problem, details, contact, alertCount, systemName, requestId = null, claimedBy = null, history = [], complaint = false }) {
  const resolution = resolutionSteps({ reason: problem, systemName, contact });
  const hours = minutesWaiting >= 120 ? `${Math.round(minutesWaiting / 6) / 10} h` : `${minutesWaiting} min`;
  const subject = `${complaint ? "COMPLAINT · " : ""}URGENT (${alertCount || 1} follow-up${alertCount === 1 ? "" : "s"}): customer still waiting ${hours}`;
  const rows = [
    ["Customer just said", customerMessage],
    ["Waiting since request", `${minutesWaiting} minutes`],
    ["Why it is not done", problem || "Not completed automatically"],
    ["Caller", contact?.name],
    ["Phone", contact?.phone],
    ["Email", contact?.email || "not given yet (Closer is asking)"],
    ["Being handled by", claimedBy?.name ? `${claimedBy.name} (since ${claimedBy.at})` : ""],
    ...Object.entries(details || {})
  ];
  const historyText = history.length ? ["FOLLOW-UP HISTORY (one open case, no duplicate tickets):", ...history.map((line) => `- ${line}`), ""] : [];
  const historyHtml = history.length ? `<p style="margin:14px 0 4px;font-weight:700">Follow-up history <span style="font-weight:400;color:#6a7382">(one open case, no duplicate tickets)</span></p><ul style="margin:0 0 12px;padding-left:18px;font-size:13px">${history.map((line) => `<li>${escapeHtmlText(line)}</li>`).join("")}</ul>` : "";
  const text = [subject, "", resolutionText(resolution), "The customer followed up and their request still has no reference number. Fix the problem (step 1), then click \"I fixed it — try again\" (step 2). Closer saves it and informs the customer.", "", ...historyText, ...rows.filter(([, v]) => v !== null && v !== undefined && v !== "").map(([k, v]) => `${k}: ${v}`)].join("\n");
  const html = wrap(escapeHtmlText(subject), `${resolutionHtml(resolution)}<p><b>The customer followed up and their request still has no reference number.</b> Fix the problem (step 1), then click \"I fixed it — try again\" (step 2). Closer saves it and informs the customer.</p>${historyHtml}${rowsTable(rows)}`);
  return sendToTenantAndPlatform({ settings, tenantName: companyName, build: (recipient = {}) => {
    const resolve = resolveBlock(requestId, recipient.email);
    return {
      subject: `${subject}${resolve.code ? ` [${resolve.code}]` : ""}`,
      text: resolve.text ? text.replace("\n\n", `\n\n${resolve.text}\n`) : text,
      html: resolve.html ? html.replace(resolutionHtml(resolution), `${resolutionHtml(resolution)}${resolve.html}`) : html
    };
  } });
}

/** The customer is complaining about an open, scheduled request (3+ follow-ups or upset words). */
async function notifyComplaint({ settings, companyName, customerMessage, followups, reference, reason, ticket, details, history = [], contact, ticked = true }) {
  const subject = `COMPLAINT: ${contact?.name || "customer"} — ${reference || "open request"} (${followups} follow-up${followups === 1 ? "" : "s"})`;
  const rows = [
    ["Why this is a complaint", reason],
    ["Customer just said", customerMessage],
    ["Reference", reference],
    ["Scheduled", ticket?.scheduledFor || ""],
    ["Assigned to", ticket?.assignedTo || ""],
    ["Caller", contact?.name], ["Phone", contact?.phone], ["Email", contact?.email],
    ...Object.entries(details || {})
  ];
  const todo = `Call the customer today, tell them what is happening with their request, and make sure it is done.${ticked ? ' "With Complain" is now ticked on the ticket.' : ""}`;
  const historyHtml = history.length ? `<p style="margin:14px 0 4px;font-weight:700">Follow-up history</p><ul style="margin:0 0 12px;padding-left:18px;font-size:13px">${history.map((line) => `<li>${escapeHtmlText(line)}</li>`).join("")}</ul>` : "";
  const text = [subject, "", todo, "", ...(history.length ? ["FOLLOW-UP HISTORY:", ...history.map((l) => `- ${l}`), ""] : []), ...rows.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`)].join("\n");
  const html = wrap(escapeHtmlText(subject), `<p style="background:#fef2f2;border:1px solid #fecaca;color:#991b1b;border-radius:8px;padding:10px 12px"><b>${escapeHtmlText(todo)}</b></p>${historyHtml}${rowsTable(rows)}`);
  return sendToTenantAndPlatform({ settings, tenantName: companyName, build: () => ({ subject, text, html }) });
}

module.exports = {
  notifyComplaint,
  resolutionSteps,
  alertAudiences,
  sendToTenantAndPlatform,
  notifyCustomerStatus,
  notifyUnresolvedFollowup,
  sendNotification,
  notifyEngineRequest,
  notifyFacebookDisconnected,
  notifyHandoff,
  notifySetupMilestone,
  notifyGapDigest,
  notifyNewSale,
  notifySecurityAlert,
  notifyBookingCreated,
  notifyConfigured,
  FROM_ADDRESS
};
