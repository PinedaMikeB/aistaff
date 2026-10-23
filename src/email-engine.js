/**
 * Email Engine (added 2026-10-22) — send one email to many recipients.
 *
 * First building block of the Marketing engine. Generic for every tenant: nothing
 * here knows a tenant name; every value comes from the tenant's EmailEngineSetting
 * row (Settings › Email Engine) or the platform row (Platform › Email Engine).
 *
 * How it sends
 *  - One message per recipient (never a long To/Bcc list), so each person gets
 *    their own copy and their own unsubscribe link.
 *  - From the tenant's Email channel inbox (Settings › Channels › Email, e.g.
 *    care@marga.biz) or from a separate sending mailbox the tenant adds here.
 *    Replies land in that inbox, so Closer answers them like any customer email.
 *  - Slowly: the tenant's per-minute rate, capped by the platform maximum.
 *  - Inside the mailbox's daily limit, keeping a reserve free every day for
 *    Closer replies and customer status emails from the same inbox.
 *  - Unsubscribed / bounced / blocked addresses are never sent to.
 *
 * Failures are never silent: a login/limit/server problem pauses the campaign and
 * alerts the tenant's alert contacts and the AIStaff platform admin with steps to fix.
 */
const crypto = require("crypto");
require("./mail-ipv4");
const nodemailer = require("nodemailer");
const MailComposer = require("nodemailer/lib/mail-composer");
const { prisma } = require("./db");
const { encryptSecret, decryptSecret } = require("./crypto");
const emailChannel = require("./email-channel");

const EMAIL_RE = /^[^\s@,;<>"]+@[^\s@,;<>"]+\.[^\s@,;<>"]{2,}$/;
const MAX_ATTEMPTS = 3;
const TICK_MS = 5000;

const ACTIVE_STATUSES = ["pending", "sending", "draft_needed", "drafting", "review", "waiting"];

/* ------------------------------ pace + sending hours ------------------------------ */

function manilaNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-US", { timeZone: "Asia/Manila", weekday: "short", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { weekday: parts.weekday, minutes: (Number(parts.hour) % 24) * 60 + Number(parts.minute) };
}
function toMinutes(hhmm, fallback) { const m = String(hhmm || "").match(/^(\d{1,2}):(\d{2})$/); return m ? Number(m[1]) * 60 + Number(m[2]) : fallback; }

/** Is this campaign allowed to send one more email right now? Sets a plain-words wait note when not. */
async function paceAllows(campaign) {
  const w = campaign.send_window || {};
  if (w.weekdays_only || w.from || w.to) {
    const now = manilaNow();
    const from = toMinutes(w.from, 0), to = toMinutes(w.to, 24 * 60);
    if ((w.weekdays_only && (now.weekday === "Sat" || now.weekday === "Sun")) || now.minutes < from || now.minutes >= to) {
      waitNote.set(campaign.id, `Outside sending hours (${w.weekdays_only ? "Mon-Fri " : ""}${w.from || "00:00"}-${w.to || "24:00"} Philippine time). Continues automatically.`);
      return false;
    }
  }
  if (campaign.pace_count && campaign.pace_hours) {
    const windowMs = campaign.pace_hours * 3600 * 1000;
    const spacing = Math.floor(windowMs / campaign.pace_count);
    const last = campaign.last_sent_at ? new Date(campaign.last_sent_at).getTime() : 0;
    if (last && Date.now() - last < spacing) {
      waitNote.set(campaign.id, `Pace ${campaign.pace_count} every ${campaign.pace_hours} hour${campaign.pace_hours > 1 ? "s" : ""}: next email about ${new Date(last + spacing).toLocaleTimeString("en-PH", { timeZone: "Asia/Manila", hour: "numeric", minute: "2-digit" })}.`);
      return false;
    }
    const sentInWindow = await prisma.emailCampaignRecipient.count({ where: { campaign_id: campaign.id, sent_at: { gte: new Date(Date.now() - windowMs) } } });
    if (sentInWindow >= campaign.pace_count) {
      waitNote.set(campaign.id, `Pace reached: ${campaign.pace_count} sent in the last ${campaign.pace_hours} hour${campaign.pace_hours > 1 ? "s" : ""}. Continues automatically.`);
      return false;
    }
  }
  return true;
}

const DEFAULT_SETTINGS = {
  sender_mode: "channel", per_minute: 10, mailbox_daily_limit: 1000, reserve_for_closer: 200,
  footer_text: "", unsubscribe_label: "Unsubscribe", test_address: "", reply_to: ""
};

function cleanEmail(value) { return String(value || "").trim().toLowerCase().replace(/^mailto:/, ""); }
function validEmail(value) { return EMAIL_RE.test(cleanEmail(value)); }
function clampInt(value, min, max, fallback) {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
}
function baseUrl() { return String(process.env.APP_PUBLIC_URL || process.env.APP_BASE_URL || "https://aistaff.click").replace(/\/+$/, ""); }
function escHtml(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

/* ------------------------------ settings ------------------------------ */

async function getPlatform() {
  return prisma.emailEnginePlatform.upsert({ where: { id: "global" }, update: {}, create: { id: "global" } });
}

async function getSettings(companyId) {
  return prisma.emailEngineSetting.upsert({ where: { company_id: companyId }, update: {}, create: { company_id: companyId } });
}

function mailboxFingerprint(settings) {
  const c = settings?.mailbox_config || {};
  return crypto.createHash("sha256").update(JSON.stringify([c.address, c.username, c.smtp_host, c.smtp_port, settings?.mailbox_secret || ""])).digest("hex");
}

/**
 * Which mailbox sends for this tenant right now.
 * Returns { ok, address, senderName, config, pass, signature, source } or { ok:false, problem }.
 */
async function resolveSender(companyId, settings = null) {
  const s = settings || await getSettings(companyId);
  if (s.sender_mode === "mailbox") {
    const c = s.mailbox_config || {};
    if (!c.address || !s.mailbox_secret) return { ok: false, problem: "The sending mailbox is not set up yet (Settings › Email Engine › Sending mailbox)." };
    if (s.mailbox_tested_hash !== mailboxFingerprint(s)) return { ok: false, problem: "The sending mailbox has not passed the connection test since it was last changed. Press Test connection." };
    let pass = "";
    try { pass = decryptSecret(s.mailbox_secret); } catch { pass = ""; }
    if (!pass) return { ok: false, problem: "The sending mailbox password could not be read. Type it again and Save." };
    return { ok: true, source: "mailbox", address: c.address, senderName: c.sender_name || c.address, config: c, pass, signature: "" };
  }
  const row = await emailChannel.getEmailChannel(companyId).catch(() => null);
  if (!row || !row.config?.address) return { ok: false, problem: "Your Email channel is not set up. Connect your customer-service inbox in Settings › Channels › Email, or choose a separate sending mailbox." };
  if (!row.enabled) return { ok: false, problem: `Your Email channel (${row.config.address}) is turned off in Settings › Channels. Turn it on, or choose a separate sending mailbox.` };
  if (!emailChannel.isTested(row)) return { ok: false, problem: `Your Email channel (${row.config.address}) has not passed its connection test since it was last changed. Open Settings › Channels › Email and press Test connection.` };
  const pass = emailChannel.password(row);
  if (!pass) return { ok: false, problem: "The Email channel password could not be read. Type it again in Settings › Channels › Email." };
  return { ok: true, source: "channel", address: row.config.address, senderName: row.config.sender_name || row.config.address, config: row.config, pass, signature: row.config.signature || "" };
}

/* ------------------------------ daily budget ------------------------------ */

/** How many more campaign emails this sender may send in the rolling 24 hours. */
async function budget(companyId, settings, sender, platform) {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const address = cleanEmail(sender.address);
  const [campaignSent, otherSent] = await Promise.all([
    prisma.emailCampaignRecipient.count({ where: { from_address: address, status: "sent", sent_at: { gte: since } } }),
    prisma.emailMessageLog.count({ where: { from_address: address, direction: "out", created_at: { gte: since } } })
  ]);
  const limit = Math.min(settings.mailbox_daily_limit, platform.max_per_day);
  // Closer/status emails use at least the reserve (more if they already sent more).
  const reserved = sender.source === "channel" ? Math.max(settings.reserve_for_closer, otherSent) : otherSent;
  const left = Math.max(0, limit - reserved - campaignSent);
  return { limit, reserve: sender.source === "channel" ? settings.reserve_for_closer : 0, campaign_sent_24h: campaignSent, other_sent_24h: otherSent, left };
}

function ratePerMinute(settings, platform) {
  return Math.max(1, Math.min(settings.per_minute, platform.max_per_minute));
}

/* ------------------------------ composing ------------------------------ */

function unsubscribeToken(companyId, email) {
  const payload = Buffer.from(JSON.stringify({ c: companyId, e: cleanEmail(email) })).toString("base64url");
  const sig = crypto.createHmac("sha256", process.env.ENCRYPTION_SECRET || "local-dev-encryption-secret").update(`unsub:${payload}`).digest("base64url").slice(0, 22);
  return `${payload}.${sig}`;
}

function readUnsubscribeToken(token) {
  const [payload, sig] = String(token || "").split(".");
  if (!payload || !sig) return null;
  const expected = crypto.createHmac("sha256", process.env.ENCRYPTION_SECRET || "local-dev-encryption-secret").update(`unsub:${payload}`).digest("base64url").slice(0, 22);
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
    return data && data.c && validEmail(data.e) ? { companyId: data.c, email: cleanEmail(data.e) } : null;
  } catch { return null; }
}

/** {{name}}, {{name|fallback}}, {{organization}}, {{email}} — filled per recipient. */
function personalize(text, recipient) {
  const values = { name: recipient.name || "", first_name: String(recipient.name || "").trim().split(/\s+/)[0] || "", organization: recipient.organization || "", email: recipient.email || "" };
  return String(text || "").replace(/\{\{\s*([a-z_]+)\s*(?:\|\s*([^}]*?))?\s*\}\}/gi, (all, key, fallback) => {
    const v = values[String(key).toLowerCase()];
    if (v === undefined) return all;
    return v || (fallback || "");
  });
}

function linkify(escapedText) {
  return escapedText.replace(/(https?:\/\/[^\s<]+[^\s<.,;:!?)\]])/g, '<a href="$1" style="color:#1d4ed8">$1</a>');
}

function buildMail({ campaign, recipient, sender, settings, companyId, test = false }) {
  const subject = personalize(campaign.subject, recipient);
  const body = personalize(campaign.body_text, recipient);
  const unsubUrl = `${baseUrl()}/u/${unsubscribeToken(companyId, recipient.email)}`;
  const label = settings.unsubscribe_label || DEFAULT_SETTINGS.unsubscribe_label;
  const footer = String(settings.footer_text || "").trim();
  const signature = sender.signature ? `\n\n-- \n${sender.signature}` : "";
  const text = `${body}${signature}\n\n---\n${footer ? `${footer}\n` : ""}${label}: ${unsubUrl}`;
  const para = (t) => linkify(escHtml(t)).replace(/\r?\n/g, "<br>");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;font-size:15px;line-height:1.55;color:#1a2233;max-width:640px">` +
    `<div>${para(body)}</div>` +
    (sender.signature ? `<div style="margin-top:18px;color:#475569">${para(sender.signature)}</div>` : "") +
    `<div style="margin-top:28px;padding-top:12px;border-top:1px solid #e2e8f0;font-size:12px;color:#64748b">` +
    (footer ? `<div style="margin-bottom:6px">${para(footer)}</div>` : "") +
    `<a href="${escHtml(unsubUrl)}" style="color:#64748b">${escHtml(label)}</a></div></div>`;
  const messageId = `<${crypto.randomUUID()}@${cleanEmail(sender.address).split("@")[1] || "aistaff.click"}>`;
  return {
    messageId,
    mail: {
      from: { name: sender.senderName, address: sender.address },
      to: recipient.name ? { name: recipient.name, address: recipient.email } : recipient.email,
      replyTo: settings.reply_to && validEmail(settings.reply_to) ? settings.reply_to : undefined,
      subject: test ? `[TEST] ${subject}` : subject,
      text, html, messageId,
      headers: {
        "List-Unsubscribe": `<${unsubUrl}>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
        "X-AIStaff-Channel": "email-engine",
        "X-AIStaff-Campaign": campaign.id || "test"
      }
    }
  };
}

const transports = new Map();
function transportFor(sender) {
  const prefix = `${cleanEmail(sender.address)}:`;
  const key = prefix + crypto.createHash("sha256").update(JSON.stringify([sender.config.smtp_host, sender.config.smtp_port, sender.config.username, sender.pass])).digest("hex");
  if (!transports.has(key)) {
    for (const [k, t] of transports) if (k.startsWith(prefix)) { t.close(); transports.delete(k); }
    transports.set(key, nodemailer.createTransport({
      pool: true, maxConnections: 1, maxMessages: 50,
      host: sender.config.smtp_host, port: Number(sender.config.smtp_port), secure: Number(sender.config.smtp_port) === 465,
      auth: { user: sender.config.username || sender.address, pass: sender.pass },
      connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 60000
    }));
  }
  return transports.get(key);
}

async function sendOne({ sender, mail, to }) {
  const raw = await new MailComposer(mail).compile().build();
  await transportFor(sender).sendMail({ envelope: { from: sender.address, to: [to] }, raw });
}

/**
 * What kind of SMTP failure this is.
 *  recipient — this one address is bad (do not retry, block it)
 *  temporary — try this address again later
 *  stop      — the mailbox itself has a problem (login, limit, server): pause the campaign
 */
function classify(error) {
  const code = Number(error?.responseCode || 0);
  const msg = String(error?.response || error?.message || error || "");
  if (/auth|login|credential|535|534|password/i.test(msg) || code === 535 || code === 534) return { kind: "stop", why: "login" };
  if (/limit|quota|too many|rate|exceeded|throttl/i.test(msg) || code === 421 || code === 451 || code === 452 || code === 454) return { kind: "stop", why: "limit" };
  if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED|ETIMEDOUT|ECONNRESET|ESOCKET|EDNS|timeout/i.test(msg)) return { kind: "stop", why: "connection" };
  if (code === 550 || code === 551 || code === 553 || code === 501 || /user unknown|does not exist|no such user|mailbox unavailable|invalid recipient|recipient rejected|address rejected/i.test(msg)) return { kind: "recipient", why: "bad_address" };
  if (code >= 400 && code < 500) return { kind: "temporary", why: "temporary" };
  if (code >= 500) return { kind: "recipient", why: "rejected" };
  return { kind: "temporary", why: "unknown" };
}

function troubleshooting(why, sender) {
  const where = sender?.source === "mailbox" ? "Settings › Email Engine › Sending mailbox" : "Settings › Channels › Email";
  if (why === "login") return [`The mailbox ${sender?.address || ""} refused the login. The password may have been changed.`, `Open ${where}, type the current password, Save, then press Test connection.`, "Then open Settings › Email Engine and press Resume on the campaign."];
  if (why === "limit") return [`The mail server says ${sender?.address || "the mailbox"} reached its sending limit.`, "Check the daily limit of your email plan (Hostinger: Business Starter 1,000/day, Business Premium 3,000/day, free/trial mailboxes 100/day) and set the same number in Settings › Email Engine › Sending speed.", "Lower the emails per minute if the server limits by hour.", "Press Resume after a few hours; already-sent people are never sent twice."];
  if (why === "connection") return ["AIStaff could not reach the mail server.", `Check the outgoing (SMTP) server name and port in ${where}.`, "If it is the provider's outage, press Resume later."];
  return ["Open the campaign in Settings › Email Engine to see the exact server message.", "Fix the cause, then press Resume."];
}

/* ------------------------------ alerts ------------------------------ */

async function alertProblem(campaign, problem, steps) {
  if (campaign.alerted_at) return;
  try {
    const notify = require("./notify");
    const [settings, company] = await Promise.all([
      prisma.companySetting.findUnique({ where: { company_id: campaign.company_id } }),
      prisma.company.findUnique({ where: { id: campaign.company_id }, select: { name: true } })
    ]);
    const tenantName = company?.name || "Tenant";
    const progress = `${campaign.sent_count} of ${campaign.total} sent`;
    const link = `${baseUrl()}/admin/settings/email-engine`;
    await notify.sendToTenantAndPlatform({
      settings, tenantName,
      build: () => ({
        subject: `Email campaign paused: ${campaign.name}`,
        text: `The email campaign "${campaign.name}" was paused (${progress}).\n\nProblem: ${problem}\n\nHow to fix:\n${steps.map((s, i) => `${i + 1}. ${s}`).join("\n")}\n\nOpen: ${link}`,
        html: `<p>The email campaign <b>${escHtml(campaign.name)}</b> was paused (${escHtml(progress)}).</p><p><b>Problem:</b> ${escHtml(problem)}</p><p><b>How to fix:</b></p><ol>${steps.map((s) => `<li>${escHtml(s)}</li>`).join("")}</ol><p><a href="${escHtml(link)}">Open Email Engine</a></p>`
      })
    });
    await prisma.emailCampaign.update({ where: { id: campaign.id }, data: { alerted_at: new Date() } });
  } catch (error) {
    console.error("[email-engine] alert failed campaign=%s: %s", campaign.id, error.message);
  }
}

async function pauseCampaign(campaign, reason, problem, steps) {
  await prisma.emailCampaign.update({ where: { id: campaign.id }, data: { status: "paused", pause_reason: reason, last_error: problem, last_error_at: new Date() } });
  console.error("[email-engine] PAUSED campaign=%s company=%s reason=%s: %s", campaign.id, campaign.company_id, reason, problem);
  await alertProblem({ ...campaign, status: "paused" }, problem, steps);
}

/* ------------------------------ worker ------------------------------ */

const nextSendAt = new Map(); // sender address -> time the next email may go
const waitNote = new Map();   // campaign id -> why it is waiting (shown in the panel)
let ticking = false;

async function refreshCounts(campaignId) {
  const groups = await prisma.emailCampaignRecipient.groupBy({ by: ["status"], where: { campaign_id: campaignId }, _count: { _all: true } });
  const n = Object.fromEntries(groups.map((g) => [g.status, g._count._all]));
  return prisma.emailCampaign.update({ where: { id: campaignId }, data: { sent_count: (n.sent || 0) + (n.waiting || 0), failed_count: n.failed || 0, skipped_count: n.skipped || 0 } });
}

async function finishIfDone(campaign) {
  const left = await prisma.emailCampaignRecipient.count({ where: { campaign_id: campaign.id, status: { in: ACTIVE_STATUSES } } });
  if (left) return false;
  if (campaign.kind === "outreach") await prisma.emailCampaignRecipient.updateMany({ where: { campaign_id: campaign.id, status: "sent", outcome: null }, data: { outcome: "no_reply" } });
  const updated = await refreshCounts(campaign.id);
  await prisma.emailCampaign.update({ where: { id: campaign.id }, data: { status: "done", finished_at: new Date() } });
  waitNote.delete(campaign.id);
  console.log("[email-engine] campaign done id=%s sent=%d failed=%d skipped=%d", campaign.id, updated.sent_count, updated.failed_count, updated.skipped_count);
  return true;
}

async function processCampaign(campaign, platform) {
  if (!(await paceAllows(campaign))) return;
  if (campaign.kind === "outreach") return require("./email-outreach").processOutreach(campaign, platform);
  const settings = await getSettings(campaign.company_id);
  const sender = await resolveSender(campaign.company_id, settings);
  if (!sender.ok) return pauseCampaign(campaign, "sender", sender.problem, [sender.problem, "Then press Resume in Settings › Email Engine."]);
  const address = cleanEmail(sender.address);
  if ((nextSendAt.get(address) || 0) > Date.now()) return;

  const left = await budget(campaign.company_id, settings, sender, platform);
  if (left.left <= 0) {
    waitNote.set(campaign.id, `Daily limit reached for ${sender.address} (${left.limit}/day, ${left.reserve} kept for Closer). Continues automatically.`);
    nextSendAt.set(address, Date.now() + 10 * 60 * 1000);
    return;
  }
  waitNote.delete(campaign.id);

  const recipient = await prisma.emailCampaignRecipient.findFirst({
    where: { campaign_id: campaign.id, status: "pending", OR: [{ next_try_at: null }, { next_try_at: { lte: new Date() } }] },
    orderBy: { created_at: "asc" }
  });
  if (!recipient) { await finishIfDone(campaign); return; }

  // Last check right before sending: unsubscribed or blocked since the campaign started.
  const blocked = await prisma.emailSuppression.findUnique({ where: { company_id_email: { company_id: campaign.company_id, email: recipient.email } } });
  if (blocked) {
    await prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data: { status: "skipped", error: `On the do-not-email list (${blocked.reason})` } });
    await refreshCounts(campaign.id);
    return;
  }

  // Claim it, so a second worker (or a restart) can never send it twice.
  const claimed = await prisma.emailCampaignRecipient.updateMany({ where: { id: recipient.id, status: "pending" }, data: { status: "sending", attempts: { increment: 1 }, from_address: address } });
  if (!claimed.count) return;
  nextSendAt.set(address, Date.now() + Math.ceil(60000 / ratePerMinute(settings, platform)));

  const contact = await prisma.emailContact.findUnique({ where: { company_id_email: { company_id: campaign.company_id, email: recipient.email } } }).catch(() => null);
  const { mail, messageId } = buildMail({ campaign, recipient: { email: recipient.email, name: recipient.name || contact?.name, organization: contact?.organization }, sender, settings, companyId: campaign.company_id });
  try {
    await sendOne({ sender, mail, to: recipient.email });
    await prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data: { status: "sent", sent_at: new Date(), message_id: messageId, error: null } });
    await prisma.emailCampaign.update({ where: { id: campaign.id }, data: { last_sent_at: new Date() } });
    await refreshCounts(campaign.id);
    await finishIfDone(campaign);
  } catch (error) {
    const kind = classify(error);
    const msg = String(error?.response || error?.message || error).slice(0, 300);
    if (kind.kind === "stop") {
      await prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data: { status: "pending", error: msg, attempts: { decrement: 1 } } });
      nextSendAt.set(address, Date.now() + 5 * 60 * 1000);
      return pauseCampaign(campaign, kind.why, `Sending from ${sender.address} failed: ${msg}`, troubleshooting(kind.why, sender));
    }
    if (kind.kind === "recipient" || recipient.attempts + 1 >= MAX_ATTEMPTS) {
      await prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data: { status: "failed", error: msg } });
      if (kind.why === "bad_address") {
        await prisma.emailSuppression.upsert({ where: { company_id_email: { company_id: campaign.company_id, email: recipient.email } }, update: {}, create: { company_id: campaign.company_id, email: recipient.email, reason: "bounced", note: msg.slice(0, 200) } }).catch(() => {});
      }
    } else {
      await prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data: { status: "pending", error: msg, next_try_at: new Date(Date.now() + 15 * 60 * 1000) } });
    }
    await prisma.emailCampaign.update({ where: { id: campaign.id }, data: { last_error: `${recipient.email}: ${msg}`, last_error_at: new Date() } });
    await refreshCounts(campaign.id);
    await finishIfDone(campaign);
  }
}

async function tick() {
  if (ticking) return;
  ticking = true;
  try {
    const platform = await getPlatform();
    if (platform.paused_all) return;
    const campaigns = await prisma.emailCampaign.findMany({ where: { status: "sending" }, orderBy: { started_at: "asc" }, take: 50 });
    for (const campaign of campaigns) {
      await processCampaign(campaign, platform).catch((error) => console.error("[email-engine] campaign=%s tick error: %s", campaign.id, error.message));
    }
  } catch (error) {
    console.error("[email-engine] tick failed: %s", error.message);
  } finally {
    ticking = false;
  }
}

/** After a restart: anything caught mid-send is marked failed (maybe sent) — never re-sent automatically. */
async function recoverInterrupted() {
  const stuck = await prisma.emailCampaignRecipient.updateMany({
    where: { status: "sending", updated_at: { lt: new Date(Date.now() - 2 * 60 * 1000) } },
    data: { status: "failed", error: "Interrupted while sending (server restart) — may or may not have been delivered. Use Retry failed to send again." }
  });
  if (stuck.count) console.warn("[email-engine] marked %d interrupted recipients as failed", stuck.count);
  await prisma.emailCampaignRecipient.updateMany({ where: { status: "drafting" }, data: { status: "draft_needed" } });
}

function startWorker() {
  recoverInterrupted().catch((error) => console.error("[email-engine] recover failed: %s", error.message));
  const timer = setInterval(tick, TICK_MS);
  timer.unref();
  console.log("[email-engine] worker started (tick %ds)", TICK_MS / 1000);
  require("./email-outreach").startOutreachJobs();
}

/* ------------------------------ helpers for routes ------------------------------ */

/** Parse pasted text or CSV: "email", "Name <email>", "email,name,organization". */
function parseRecipients(text) {
  const out = new Map();
  const invalid = [];
  const lines = String(text || "").split(/\r?\n/);
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) continue;
    const angle = line.match(/^"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
    if (angle) { addRecipient(out, invalid, angle[2], angle[1]); continue; }
    const cells = line.split(/[,\t;]/).map((c) => c.trim().replace(/^"|"$/g, ""));
    const emailCells = cells.filter((c) => c.includes("@"));
    if (emailCells.length > 1 && cells.length === emailCells.length) { emailCells.forEach((e) => addRecipient(out, invalid, e)); continue; }
    const emailCell = cells.find((c) => c.includes("@"));
    if (!emailCell) { if (!/email/i.test(line)) invalid.push(line.slice(0, 80)); continue; }
    const others = cells.filter((c) => c !== emailCell && c);
    addRecipient(out, invalid, emailCell, others[0], others[1]);
  }
  return { recipients: [...out.values()], invalid };
}

function addRecipient(map, invalid, email, name, organization) {
  const e = cleanEmail(email);
  if (!validEmail(e)) { invalid.push(String(email).slice(0, 80)); return; }
  if (!map.has(e)) map.set(e, { email: e, name: String(name || "").trim().slice(0, 120) || null, organization: String(organization || "").trim().slice(0, 160) || null });
}

module.exports = {
  DEFAULT_SETTINGS, EMAIL_RE, cleanEmail, validEmail, clampInt, getPlatform, getSettings, resolveSender, budget, ratePerMinute,
  mailboxFingerprint, buildMail, sendOne, classify, troubleshooting, personalize, parseRecipients, refreshCounts,
  unsubscribeToken, readUnsubscribeToken, startWorker, tick, waitNote, encryptSecret, transportFor,
  ACTIVE_STATUSES, paceAllows, pauseCampaign, finishIfDone, nextSendAt
};
