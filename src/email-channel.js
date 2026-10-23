/**
 * Email channel (Settings › Channels › Email). Added 2026-10-20.
 *
 * A tenant's customer-service inbox (e.g. care@marga.biz on Hostinger) becomes a
 * Closer channel: new mail is read over IMAP, handled by the same Closer/Director
 * as Messenger, and answered over SMTP FROM THAT INBOX in the same thread.
 * Customer status emails also go out from this inbox when the channel is on.
 *
 * Generic for every tenant: no tenant names, all behaviour comes from the
 * tenant_channels row. The password is stored encrypted (src/crypto.js) and is
 * never returned by the API.
 *
 * Loop protection: own/system mail, auto-replies, bounces, newsletters, bulk,
 * spam and noreply senders are logged and skipped; our replies carry
 * Auto-Submitted + X-AIStaff-Channel; max 6 replies per address per hour.
 */
const crypto = require("crypto");
// imapflow needs the Web Crypto global; Node 18 (/usr/bin/node used by the service) does not set it.
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
require("./mail-ipv4");
const nodemailer = require("nodemailer");
const MailComposer = require("nodemailer/lib/mail-composer");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { prisma } = require("./db");
const { encryptSecret, decryptSecret } = require("./crypto");

const CHANNEL_KEY = "email";
const PROVIDERS = {
  hostinger: { label: "Hostinger", imap_host: "imap.hostinger.com", imap_port: 993, smtp_host: "smtp.hostinger.com", smtp_port: 465 },
  other: { label: "Other (IMAP + SMTP)", imap_host: "", imap_port: 993, smtp_host: "", smtp_port: 465 }
};
const MAX_PER_POLL = 20;
const MAX_REPLIES_PER_HOUR = 6;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const inFlight = new Set();

function cleanEmail(value) { return String(value || "").trim().toLowerCase(); }
function domainOf(address) { return cleanEmail(address).split("@")[1] || "aistaff.click"; }

/** Merge user input into the stored config. Server fields are filled from the provider preset when blank. */
function normalizeConfig(input = {}, existing = {}, companyName = "") {
  const provider = PROVIDERS[input.provider] ? input.provider : (existing.provider || "hostinger");
  const preset = PROVIDERS[provider];
  const pick = (key, fallback) => (input[key] !== undefined ? input[key] : (existing[key] !== undefined ? existing[key] : fallback));
  const address = cleanEmail(pick("address", ""));
  const port = (value, fallback) => { const n = Number(value); return Number.isInteger(n) && n > 0 && n < 65536 ? n : fallback; };
  const config = {
    ...existing,
    provider,
    address,
    sender_name: String(pick("sender_name", companyName) || companyName).replace(/[<>"\r\n]/g, "").trim().slice(0, 80),
    username: cleanEmail(pick("username", "")) || address,
    imap_host: String(pick("imap_host", "") || preset.imap_host).trim().toLowerCase(),
    imap_port: port(pick("imap_port", preset.imap_port), preset.imap_port),
    smtp_host: String(pick("smtp_host", "") || preset.smtp_host).trim().toLowerCase(),
    smtp_port: port(pick("smtp_port", preset.smtp_port), preset.smtp_port),
    signature: String(pick("signature", "") || "").slice(0, 1000)
  };
  if (provider === "hostinger" && input.provider === "hostinger" && existing.provider !== "hostinger") {
    Object.assign(config, { imap_host: preset.imap_host, imap_port: preset.imap_port, smtp_host: preset.smtp_host, smtp_port: preset.smtp_port });
  }
  return config;
}

function validateConfig(config) {
  if (!EMAIL_RE.test(config.address)) return "Enter the inbox email address (for example care@yourcompany.com).";
  if (!config.imap_host || !config.smtp_host) return "Enter the incoming (IMAP) and outgoing (SMTP) server names.";
  if (!/^[a-z0-9.-]+$/.test(config.imap_host) || !/^[a-z0-9.-]+$/.test(config.smtp_host)) return "Server names may only contain letters, numbers, dots and dashes.";
  return null;
}

/** Changes whenever anything that affects the connection changes (incl. a new password). */
function fingerprint(row) {
  const c = row?.config || {};
  return crypto.createHash("sha256")
    .update(JSON.stringify([c.address, c.username, c.imap_host, c.imap_port, c.smtp_host, c.smtp_port, row?.secret_encrypted || ""]))
    .digest("hex");
}

function isTested(row) { return Boolean(row?.tested_fingerprint && row.tested_fingerprint === fingerprint(row)); }

function password(row) {
  if (!row?.secret_encrypted) return "";
  try { return decryptSecret(row.secret_encrypted); } catch { return ""; }
}

function imapClient(config, pass) {
  if (!globalThis.crypto || !globalThis.crypto.getRandomValues) globalThis.crypto = crypto.webcrypto;
  return new ImapFlow({
    host: config.imap_host, port: config.imap_port, secure: Number(config.imap_port) === 993,
    auth: { user: config.username || config.address, pass },
    logger: false, socketTimeout: 60000, greetingTimeout: 20000, connectionTimeout: 20000
  });
}

function smtpTransport(config, pass) {
  return nodemailer.createTransport({
    host: config.smtp_host, port: config.smtp_port, secure: Number(config.smtp_port) === 465,
    auth: { user: config.username || config.address, pass },
    connectionTimeout: 20000, greetingTimeout: 20000, socketTimeout: 60000
  });
}

function plainError(error) {
  const msg = String(error?.responseText || error?.response || error?.message || error || "unknown error");
  if (/auth|login|credential|535|invalid/i.test(msg)) return `The inbox rejected the login (wrong email/username or password). Server said: ${msg.slice(0, 160)}`;
  if (/ENOTFOUND|EAI_AGAIN|getaddrinfo/i.test(msg)) return `The server name could not be found. Check the server address. (${msg.slice(0, 120)})`;
  if (/ETIMEDOUT|timeout|ECONNREFUSED|ECONNRESET/i.test(msg)) return `Could not reach the mail server (port blocked or wrong port). (${msg.slice(0, 120)})`;
  return msg.slice(0, 240);
}

/** Test connection: log in to IMAP (open INBOX) and SMTP. Nothing is sent. */
async function testEmailChannel(row) {
  const config = row?.config || {};
  const pass = password(row);
  const result = { ok: false, imap: { ok: false }, smtp: { ok: false } };
  const problem = validateConfig(config) || (!pass ? "Type the inbox password, then Save." : null);
  if (problem) return { ...result, error: problem };
  const client = imapClient(config, pass);
  try {
    await client.connect();
    const status = await client.status("INBOX", { messages: true, unseen: true });
    result.imap = { ok: true, messages: status.messages, unseen: status.unseen };
  } catch (error) {
    result.imap = { ok: false, error: plainError(error) };
  } finally {
    await client.logout().catch(() => {});
  }
  try {
    await smtpTransport(config, pass).verify();
    result.smtp = { ok: true };
  } catch (error) {
    result.smtp = { ok: false, error: plainError(error) };
  }
  result.ok = result.imap.ok && result.smtp.ok;
  if (!result.ok) result.error = [result.imap.ok ? "" : `Reading mail (IMAP): ${result.imap.error}`, result.smtp.ok ? "" : `Sending mail (SMTP): ${result.smtp.error}`].filter(Boolean).join(" · ");
  return result;
}

async function getEmailChannel(companyId) {
  return prisma.tenantChannel.findUnique({ where: { company_id_channel_key: { company_id: companyId, channel_key: CHANNEL_KEY } } });
}

/** The tenant inbox may be used for sending when it is ON and the current settings passed the test. */
async function getSendingChannel(companyId) {
  const row = await getEmailChannel(companyId).catch(() => null);
  return row && row.enabled && isTested(row) && password(row) ? row : null;
}

function textToHtml(text) {
  const esc = String(text || "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<div style="font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#1a2233">${esc.replace(/\r?\n/g, "<br>")}</div>`;
}

async function appendToSent(config, pass, raw) {
  const client = imapClient(config, pass);
  try {
    await client.connect();
    const boxes = await client.list();
    const sent = boxes.find((b) => b.specialUse === "\\Sent") || boxes.find((b) => /^(inbox\.)?sent( items| messages)?$/i.test(b.path));
    if (sent) await client.append(sent.path, raw, ["\\Seen"]);
  } catch (error) {
    console.warn("[email-channel] could not copy to Sent: %s", error.message);
  } finally {
    await client.logout().catch(() => {});
  }
}

/**
 * Send an email FROM the tenant inbox. Returns { ok:false, reason:"not_connected" } when the
 * tenant has no working email channel, so callers can fall back to the AIStaff system sender.
 */
async function sendTenantEmail({ companyId, to, subject, text, html, conversationId = null, inReplyTo = null, references = [], autoSubmitted = "auto-generated", row = null }) {
  const channel = row || await getSendingChannel(companyId);
  if (!channel) return { ok: false, reason: "not_connected" };
  const config = channel.config || {};
  const pass = password(channel);
  const signature = config.signature ? `\n\n-- \n${config.signature}` : "";
  const body = `${text || ""}${signature}`;
  const messageId = `<${crypto.randomUUID()}@${domainOf(config.address)}>`;
  const refs = [...new Set((references || []).filter(Boolean))].slice(-10);
  const mail = {
    from: { name: config.sender_name || config.address, address: config.address },
    to, subject, text: body,
    html: html ? `${html}${config.signature ? textToHtml(`-- \n${config.signature}`) : ""}` : textToHtml(body),
    messageId,
    inReplyTo: inReplyTo || undefined,
    references: refs.length ? refs : undefined,
    headers: { "Auto-Submitted": autoSubmitted, "X-AIStaff-Channel": "email", "X-Auto-Response-Suppress": "OOF, AutoReply" }
  };
  try {
    const raw = await new MailComposer(mail).compile().build();
    await smtpTransport(config, pass).sendMail({ envelope: { from: config.address, to: [to] }, raw });
    await prisma.emailMessageLog.create({ data: {
      company_id: channel.company_id, conversation_id: conversationId, direction: "out", message_id: messageId,
      in_reply_to: inReplyTo, references_header: refs.join(" ") || null, from_address: config.address, to_address: cleanEmail(to), subject: String(subject || "").slice(0, 300)
    } }).catch((error) => console.warn("[email-channel] log failed: %s", error.message));
    appendToSent(config, pass, raw).catch(() => {});
    console.log("[email-channel] sent company=%s to=%s subject=%s", channel.company_id, to, subject);
    return { ok: true, via: config.address, messageId };
  } catch (error) {
    console.error("[email-channel] SEND FAILED company=%s to=%s: %s", channel.company_id, to, error.message);
    await recordProblem(channel, `Sending failed: ${plainError(error)}`);
    return { ok: false, reason: error.message };
  }
}

/* ------------------------------ reading ------------------------------ */

function rawHeader(parsed, key) {
  return (parsed.headerLines || []).filter((h) => h.key === key).map((h) => h.line.slice(h.line.indexOf(":") + 1).trim()).join(" ");
}

function systemSenders() {
  return [process.env.NOTIFY_SMTP_USER, process.env.SMTP_USER, process.env.SMTP_FROM].map(cleanEmail).filter((e) => e.includes("@"));
}

/** Why an incoming email must NOT get a reply, or null when it is a real customer message. */
function skipReason(parsed, config) {
  const from = cleanEmail(parsed.from?.value?.[0]?.address);
  if (!EMAIL_RE.test(from)) return "no_sender";
  if ([config.address, config.username].map(cleanEmail).includes(from)) return "own_message";
  if (systemSenders().includes(from)) return "aistaff_system_mail";
  if (rawHeader(parsed, "x-aistaff-channel")) return "own_message";
  const auto = rawHeader(parsed, "auto-submitted").toLowerCase();
  if (auto && auto !== "no") return "auto_reply";
  if (rawHeader(parsed, "x-autoreply") || rawHeader(parsed, "x-autorespond")) return "auto_reply";
  if (/\b(all|oof|autoreply)\b/i.test(rawHeader(parsed, "x-auto-response-suppress")) && /auto|out of office|ooo/i.test(parsed.subject || "")) return "auto_reply";
  if (/^(bulk|junk|list|auto_reply)$/i.test(rawHeader(parsed, "precedence"))) return "bulk_mail";
  if (rawHeader(parsed, "list-id") || rawHeader(parsed, "list-unsubscribe")) return "newsletter";
  if (/multipart\/report/i.test(rawHeader(parsed, "content-type")) || rawHeader(parsed, "return-path") === "<>") return "bounce";
  const local = from.split("@")[0];
  if (/^(mailer-daemon|postmaster|bounces?|bounce-.*)$/.test(local)) return "bounce";
  if (/^(no-?reply|do-?not-?reply|donotreply|noreply-.*|notifications?|alerts?)$/.test(local)) return "noreply_sender";
  if (/^(auto(matic)?[ -]?reply|out of (the )?office|ooo\b|autoreply|delivery status notification|undeliver|mail delivery (failed|subsystem)|returned mail|failure notice)/i.test(String(parsed.subject || "").trim())) return "auto_reply";
  if (/^yes/i.test(rawHeader(parsed, "x-spam-flag")) || /^yes/i.test(rawHeader(parsed, "x-spam-status"))) return "spam";
  return null;
}

/** Keep only what the customer wrote this time (drop quoted earlier mail). */
function newPartOfReply(text) {
  const lines = String(text || "").replace(/\r/g, "").split("\n");
  const out = [];
  for (const line of lines) {
    if (/^\s*>/.test(line)) break;
    if (/^\s*On .{3,200}wrote:\s*$/i.test(line) || /^\s*(Noong|Sa) .{3,200}(sumulat|wrote):?\s*$/i.test(line)) break;
    if (/^\s*-{2,}\s*(Original Message|Forwarded message)/i.test(line)) break;
    if (/^\s*From:\s.+/i.test(line) && out.length) break;
    if (/^\s*_{10,}\s*$/.test(line)) break;
    if (/^\s*--\s*$/.test(line)) break; // signature delimiter
    if (/^\s*(sent from (my )?(iphone|ipad|android|samsung|galaxy|huawei|xiaomi|oppo|vivo|mobile)|sent from yahoo mail|sent from (mail|outlook) for|get outlook for|sent via |ipinadala mula sa)/i.test(line)) break;
    out.push(line);
  }
  return out.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function htmlToText(html) {
  return String(html || "").replace(/<style[\s\S]*?<\/style>/gi, "").replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|tr|li)>/gi, "\n")
    .replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, "\"");
}

async function recordProblem(row, problem) {
  const now = new Date();
  const fresh = await prisma.tenantChannel.findUnique({ where: { id: row.id } }).catch(() => null);
  if (!fresh) return;
  await prisma.tenantChannel.update({ where: { id: row.id }, data: { last_error: problem.slice(0, 500), last_error_at: now } }).catch(() => {});
  // Alert once per 6 hours, and only when it has been failing for 15+ minutes (not one network blip).
  const config = fresh.config || {};
  const failingSince = fresh.last_ok_at ? new Date(fresh.last_ok_at).getTime() : new Date(fresh.updated_at).getTime();
  const lastAlert = config.problem_alerted_at ? new Date(config.problem_alerted_at).getTime() : 0;
  if (now - failingSince < 15 * 60 * 1000 || now - lastAlert < 6 * 3600 * 1000) return;
  try {
    const { sendToTenantAndPlatform } = require("./notify");
    const [settings, company] = await Promise.all([
      prisma.companySetting.findUnique({ where: { company_id: row.company_id } }),
      prisma.company.findUnique({ where: { id: row.company_id }, select: { name: true } })
    ]);
    const subject = `ACTION NEEDED: email channel ${config.address} is not working`;
    const text = [
      subject, "",
      "WHAT TO DO TO RESOLVE THIS",
      "1. Open AIStaff › Settings › Channels › Email.",
      "2. If the mailbox password was changed, type the new password, Save, then Test connection.",
      "3. If Test connection passes, customer emails are read again automatically.",
      "", `Problem: ${problem}`, `Last worked: ${fresh.last_ok_at ? new Date(fresh.last_ok_at).toISOString() : "never"}`,
      "Until this is fixed, customer emails to this inbox get no AI reply (they stay in the inbox)."
    ].join("\n");
    await sendToTenantAndPlatform({ settings, tenantName: company?.name || "Tenant", build: () => ({ subject, text, html: textToHtml(text) }) });
    await prisma.tenantChannel.update({ where: { id: row.id }, data: { config: { ...config, problem_alerted_at: now.toISOString() } } });
  } catch (error) {
    console.error("[email-channel] problem alert failed: %s", error.message);
  }
}

async function savePollState(rowId, poll) {
  const fresh = await prisma.tenantChannel.findUnique({ where: { id: rowId } });
  if (!fresh) return;
  await prisma.tenantChannel.update({ where: { id: rowId }, data: { config: { ...(fresh.config || {}), poll } } });
}

/** Read new mail for one tenant. Only mail that arrived after the channel was turned on is handled. */
async function pollEmailChannel(row) {
  if (inFlight.has(row.id)) return { busy: true };
  inFlight.add(row.id);
  const config = row.config || {};
  const pass = password(row);
  const items = [];
  let poll = { ...(config.poll || {}) };
  try {
    const client = imapClient(config, pass);
    try {
      await client.connect();
      const lock = await client.getMailboxLock("INBOX");
      try {
        const box = client.mailbox;
        const uidValidity = String(box.uidValidity);
        const top = Number(box.uidNext) - 1;
        if (poll.uidvalidity !== uidValidity || !Number.isInteger(poll.last_uid)) {
          poll = { uidvalidity: uidValidity, last_uid: top, started_at: new Date().toISOString() };
          await savePollState(row.id, poll);
          console.log("[email-channel] company=%s %s: starting from now (uid %d)", row.company_id, config.address, top);
        } else if (top > poll.last_uid) {
          const end = Math.min(top, poll.last_uid + MAX_PER_POLL);
          for await (const msg of client.fetch(`${poll.last_uid + 1}:${end}`, { uid: true, source: true }, { uid: true })) {
            if (msg.uid > poll.last_uid) items.push({ uid: msg.uid, source: msg.source });
          }
          items.sort((a, b) => a.uid - b.uid);
        }
      } finally {
        lock.release();
      }
    } finally {
      await client.logout().catch(() => {});
    }
    await prisma.tenantChannel.update({ where: { id: row.id }, data: { last_ok_at: new Date(), last_error: null } }).catch(() => {});
  } catch (error) {
    inFlight.delete(row.id);
    console.error("[email-channel] READ FAILED company=%s %s: %s", row.company_id, config.address, error.message);
    await recordProblem(row, `Reading the inbox failed: ${plainError(error)}`);
    return { ok: false, error: error.message };
  }

  let handled = 0;
  try {
    for (const item of items) {
      await handleIncoming(row, item).catch((error) => console.error("[email-channel] message uid=%d failed: %s", item.uid, error.stack || error.message));
      poll.last_uid = item.uid;
      await savePollState(row.id, poll);
      handled += 1;
    }
  } finally {
    inFlight.delete(row.id);
  }
  return { ok: true, handled };
}

async function handleIncoming(row, { uid, source }) {
  const companyId = row.company_id;
  const config = row.config || {};
  const parsed = await simpleParser(source);
  const messageId = String(parsed.messageId || `<uid-${uid}-${row.id}@local>`).slice(0, 500);
  const from = cleanEmail(parsed.from?.value?.[0]?.address);
  const fromName = String(parsed.from?.value?.[0]?.name || "").trim().slice(0, 120);
  const references = [].concat(parsed.references || []).map(String);
  const subject = String(parsed.subject || "").trim();
  const reason = skipReason(parsed, config);

  // Claim the message first (unique per tenant): a re-read never produces a second reply.
  try {
    await prisma.emailMessageLog.create({ data: {
      company_id: companyId, direction: "in", message_id: messageId, in_reply_to: parsed.inReplyTo ? String(parsed.inReplyTo) : null,
      references_header: references.join(" ") || null, from_address: from || null, to_address: cleanEmail(config.address),
      subject: subject.slice(0, 300), skip_reason: reason, imap_uid: uid
    } });
  } catch (error) {
    if (error.code === "P2002") return console.log("[email-channel] duplicate %s skipped", messageId);
    throw error;
  }
  if (reason) return console.log("[email-channel] company=%s skipped from=%s reason=%s subject=%s", companyId, from, reason, subject);

  const body = newPartOfReply(parsed.text || htmlToText(parsed.html)).slice(0, 4000);
  const files = (parsed.attachments || []).filter((a) => a.contentDisposition !== "inline").map((a) => a.filename).filter(Boolean);
  if (!body && !files.length) {
    await prisma.emailMessageLog.update({ where: { company_id_message_id: { company_id: companyId, message_id: messageId } }, data: { skip_reason: "empty" } }).catch(() => {});
    return;
  }
  const isNewThread = !/^(re|aw|sv|fw|fwd)\s*:/i.test(subject);
  const text = [
    isNewThread && subject ? `[Email subject: ${subject}]` : "",
    body,
    files.length ? `[Attached files: ${files.join(", ")}]` : ""
  ].filter(Boolean).join("\n");

  // One conversation per customer email address (like one per Messenger account).
  let conversation = await prisma.conversation.findUnique({ where: { company_id_channel_external_id: { company_id: companyId, channel: CHANNEL_KEY, external_id: from } } });
  if (!conversation) {
    conversation = await prisma.conversation.create({ data: {
      company_id: companyId, channel: CHANNEL_KEY, external_id: from, customer_name: fromName || null,
      profile_fetched_at: new Date(), last_message_at: new Date(),
      customer_profile: { known: { calleremail: from } }
    } });
  } else {
    const profile = conversation.customer_profile || {};
    conversation = await prisma.conversation.update({ where: { id: conversation.id }, data: {
      last_message_at: new Date(),
      ...(!conversation.customer_name && fromName ? { customer_name: fromName } : {}),
      ...(!profile?.known?.calleremail ? { customer_profile: { ...profile, known: { ...(profile.known || {}), calleremail: from } } } : {})
    } });
  }
  await prisma.emailMessageLog.update({ where: { company_id_message_id: { company_id: companyId, message_id: messageId } }, data: { conversation_id: conversation.id } }).catch(() => {});
  await prisma.message.create({ data: { company_id: companyId, conversation_id: conversation.id, sender_type: "customer", sender_id: from, message_text: text } });
  console.log("[email-channel] company=%s from=%s conversation=%s subject=%s", companyId, from, conversation.id, subject);

  const settings = await prisma.companySetting.findUnique({ where: { company_id: companyId } });
  if (!settings?.ai_enabled || !row.ai_replies) return console.log("[email-channel] AI replies off: stored for staff only");

  let lead = await prisma.lead.findFirst({ where: { company_id: companyId, conversation_id: conversation.id } });
  if (!lead) lead = await prisma.lead.create({ data: { company_id: companyId, conversation_id: conversation.id, lead_status: "new", email: from, customer_name: fromName || null } }).catch(() => null);

  // Loop/abuse guard: at most N replies per address per hour.
  const recentReplies = await prisma.emailMessageLog.count({ where: { company_id: companyId, direction: "out", to_address: from, created_at: { gte: new Date(Date.now() - 3600 * 1000) } } });
  if (recentReplies >= MAX_REPLIES_PER_HOUR) {
    console.warn("[email-channel] RATE LIMIT company=%s to=%s (%d replies in the last hour) — handed to staff", companyId, from, recentReplies);
    await handToStaff({ companyId, conversation, settings, lead, text, reason: `More than ${MAX_REPLIES_PER_HOUR} email replies to ${from} in one hour — AI paused for this sender to avoid an email loop.` });
    return;
  }

  const { generateSalesReply, leadUpdateDataForAi } = require("./ai");
  let ai;
  try {
    ai = await generateSalesReply({ companyId, conversationId: conversation.id, message: text });
  } catch (error) {
    console.error("[email-channel] REPLY GENERATION FAILED company=%s conversation=%s: %s", companyId, conversation.id, error.message);
    await handToStaff({ companyId, conversation, settings, lead, text, reason: `Closer could not reply to an email. ${error.message}` });
    return;
  }

  if (lead) {
    lead = await prisma.lead.update({ where: { id: lead.id }, data: { ...(ai.leadPatch || {}), ...leadUpdateDataForAi(lead.lead_status, ai) } }).catch(() => lead);
  }
  await prisma.conversation.update({ where: { id: conversation.id }, data: {
    intent: ai.intent, lead_score: ai.leadScore, needs_human: ai.needsHuman, status: ai.needsHuman ? "handoff" : "open"
  } }).catch(() => {});
  if (ai.needsHuman && settings?.human_handoff_enabled) {
    await handToStaff({ companyId, conversation, settings, lead, text, reason: ai.handoffReason || "AI requested human handoff", flagOnly: true });
  }
  if (ai.unanswered && ai.unanswered.topic) {
    const existing = await prisma.knowledgeGap.findFirst({ where: { company_id: companyId, topic: ai.unanswered.topic, status: "open" } }).catch(() => null);
    if (existing) await prisma.knowledgeGap.update({ where: { id: existing.id }, data: { times_asked: { increment: 1 }, last_asked_at: new Date() } }).catch(() => {});
    else await prisma.knowledgeGap.create({ data: { company_id: companyId, question: ai.unanswered.question || ai.unanswered.topic, topic: ai.unanswered.topic, conversation_id: conversation.id } }).catch(() => {});
  }

  if (!settings?.auto_reply_enabled) return;
  const parts = [ai.reply, ...(ai.followUpMessages || [])].map((t) => String(t || "").trim()).filter(Boolean);
  if (!parts.length) return console.warn("[email-channel] empty reply, nothing sent conversation=%s", conversation.id);
  const media = (ai.sendMedia || []).map((m) => m.url).filter(Boolean);
  const replyText = parts.join("\n\n") + (media.length ? `\n\n${media.join("\n")}` : "");
  const replySubject = /^re\s*:/i.test(subject) ? subject : `Re: ${subject || "your message"}`;
  // Formal style (default for email): rich HTML email; casual: plain text.
  const style = await require("./reply-style").styleFor(companyId, "email");
  const sent = await sendTenantEmail({
    companyId, row, to: from, subject: replySubject, text: replyText, html: style === "formal" ? require("./reply-style").emailHtml(replyText) : undefined, conversationId: conversation.id,
    inReplyTo: messageId, references: [...references, messageId], autoSubmitted: "auto-replied"
  });
  if (!sent.ok) {
    await handToStaff({ companyId, conversation, settings, lead, text, reason: `The email reply could not be sent: ${sent.reason}` });
    return;
  }
  for (const part of parts) {
    await prisma.message.create({ data: { company_id: companyId, conversation_id: conversation.id, sender_type: "ai", sender_id: "ai_sales_assistant", message_text: part, ai_generated: true } }).catch(() => {});
  }
}

async function handToStaff({ companyId, conversation, settings, lead, text, reason, flagOnly = false }) {
  await prisma.$transaction([
    prisma.conversation.update({ where: { id: conversation.id }, data: { needs_human: true, status: "handoff" } }),
    prisma.humanHandoff.create({ data: { company_id: companyId, conversation_id: conversation.id, reason: String(reason).slice(0, 1000) } })
  ]).catch((error) => console.error("[email-channel] handoff record failed: %s", error.message));
  const { notifyHandoff } = require("./notify");
  const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
  const recipients = [...String(settings?.notify_email || "").split(/[,;\s]+/), ...(flagOnly ? [] : [process.env.ADMIN_ALERT_EMAIL || process.env.SEED_ADMIN_EMAIL])]
    .map((v) => String(v || "").trim()).filter((v) => v.includes("@")).filter((v, i, all) => all.indexOf(v) === i);
  for (const to of recipients) {
    await notifyHandoff({ to, companyName: company?.name || "your business", lead, reason: `[Email channel] ${reason}`, lastMessage: text, conversationId: conversation.id }).catch(() => {});
  }
}

/** Called every minute by server.js. */
async function pollAllEmailChannels() {
  const rows = await prisma.tenantChannel.findMany({ where: { channel_key: CHANNEL_KEY, enabled: true } });
  let handled = 0;
  for (const row of rows) {
    if (!isTested(row) || !password(row)) continue;
    const result = await pollEmailChannel(row).catch((error) => ({ ok: false, error: error.message }));
    handled += result.handled || 0;
  }
  return { channels: rows.length, handled };
}

module.exports = {
  CHANNEL_KEY, PROVIDERS, normalizeConfig, validateConfig, fingerprint, isTested, password, encryptSecret,
  testEmailChannel, getEmailChannel, getSendingChannel, sendTenantEmail, pollEmailChannel, pollAllEmailChannels,
  skipReason, newPartOfReply
};
