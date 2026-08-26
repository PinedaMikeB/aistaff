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
async function sendNotification({ to, subject, text, html }) {
  if (!to) return { ok: false, reason: "no_recipient" };

  if (!notifyConfigured()) {
    // Visible, not silent. Without this the feature would look built and do
    // nothing — the exact failure `notify_email` already had for months.
    console.warn("[notify] NOT SENT (support@ mailbox not configured) to=%s subject=%s", to, subject);
    return { ok: false, reason: "not_configured" };
  }

  try {
    const info = await transport().sendMail({
      from: `${FROM_NAME} <${FROM_ADDRESS}>`,
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

module.exports = {
  sendNotification,
  notifyHandoff,
  notifySetupMilestone,
  notifyGapDigest,
  notifyNewSale,
  notifySecurityAlert,
  notifyBookingCreated,
  notifyConfigured,
  FROM_ADDRESS
};
