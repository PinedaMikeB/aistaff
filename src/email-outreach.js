/**
 * Email Engine — Outreach mode (added 2026-10-22).
 *
 * One-to-one prospecting done properly. Built-in rules (each one enforced in code, not left to the user):
 *  1. One-to-one, not blasts: the AI writes each email for that company from the tenant's brief and
 *     the notes for that contact; by default a person approves every draft before it is sent.
 *  2. Company contact addresses first: role addresses (info@, sales@, procurement@…) go ahead;
 *     personal (name@company) and free-mail (gmail…) addresses are HELD until the tenant confirms the
 *     company published them for business inquiries.
 *  3. Separate domain: outreach only sends from its own mailbox, and that mailbox's domain may not be
 *     the tenant's Email channel domain, website/contact domain, or a platform-protected domain.
 *  4. Who we are, how we found you, reply STOP: a footer (tenant-editable template) is added by the
 *     system to every email; replies are read — STOP / "no" / bounce adds the address to the
 *     do-not-email list at once; any real reply stops follow-ups and alerts the tenant.
 *  5. Record: source + reason per contact, an event log per contact, a privacy check (PIA) required
 *     before starting, and a CSV export of the whole record.
 *  6. Follow-ups: at most 2, only to people who did not reply, after N days, in the same email thread.
 * Pace (N emails every H hours, optional weekday/office-hours window) lives in email-engine.js and
 * applies to broadcast campaigns too.
 */
const crypto = require("crypto");
if (!globalThis.crypto) globalThis.crypto = crypto.webcrypto;
const MailComposer = require("nodemailer/lib/mail-composer");
const { ImapFlow } = require("imapflow");
const { simpleParser } = require("mailparser");
const { prisma } = require("./db");
const { decryptSecret } = require("./crypto");

const ROLE_LOCALS = new Set(["info", "sales", "procurement", "purchasing", "purchase", "admin", "contact", "contactus", "hello", "inquiry", "inquiries", "enquiry", "enquiries",
  "marketing", "office", "support", "service", "services", "bids", "bidding", "bac", "hr", "accounting", "accounts", "finance", "billing", "business", "partners", "partnerships",
  "general", "team", "mail", "customerservice", "cs", "care", "help", "operations", "ops", "media", "pr", "secretariat", "frontdesk", "reception", "it", "ict", "supply", "supplies"]);
const FREEMAIL = new Set(["gmail.com", "googlemail.com", "yahoo.com", "yahoo.com.ph", "ymail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "icloud.com", "me.com",
  "aol.com", "proton.me", "protonmail.com", "gmx.com", "mail.com", "zoho.com", "yandex.com"]);
const ACTIVE = ["draft_needed", "drafting", "review", "pending", "sending", "waiting"];
const DEFAULT_FOOTER = "--\n{{sender_name}}, {{sender_title}}\n{{company}}\n\nI found this address on {{source}}. If you would rather not hear from us, just reply STOP and we will not email you again.";
const DEFAULT_PIA = {
  purpose: "Introduce our services to businesses that may need them (business-to-business).",
  data_used: "Company name, the company's published business email address, contact name if published, where we found it, and why we think our service fits.",
  source_of_data: "Public company websites, business directories and procurement notices that list the address for business inquiries.",
  lawful_basis: "Legitimate interest in business-to-business communication, limited to published business contact addresses, with an easy opt-out in every email.",
  opt_out: "Every email says who we are and where we found the address, and invites a reply of STOP. Opt-outs, refusals and bounces are added to the do-not-email list immediately.",
  retention_days: 180,
  security: "Stored in AIStaff, visible only to our administrators. Not shared or sold."
};
const PIA_CONFIRMS = {
  business_only: "These are business contacts, not consumers.",
  no_bought_lists: "No contact comes from a bought, rented or shared list.",
  honour_stop: "We will honour every STOP or refusal immediately and never re-add those addresses."
};

function cleanEmail(v) { return String(v || "").trim().toLowerCase().replace(/^mailto:/, ""); }
function domainOf(email) { return cleanEmail(email).split("@")[1] || ""; }
function hostOf(url) { try { return new URL(/^https?:/i.test(url) ? url : `https://${url}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } }

function addressType(email) {
  const [local, domain] = cleanEmail(email).split("@");
  if (FREEMAIL.has(domain)) return "freemail";
  const l = String(local || "").split("+")[0];
  const first = l.split(/[._-]/)[0].replace(/[0-9]+$/g, "");
  const joined = l.replace(/[0-9._-]+$/g, "").replace(/[._-]/g, "");
  if (ROLE_LOCALS.has(l) || ROLE_LOCALS.has(first) || ROLE_LOCALS.has(joined)) return "role";
  return "personal";
}

/** Domains this tenant may never use for outreach. */
async function forbiddenDomains(companyId, platform) {
  const [company, channel] = await Promise.all([
    prisma.company.findUnique({ where: { id: companyId }, select: { website: true, contact_email: true } }),
    prisma.tenantChannel.findUnique({ where: { company_id_channel_key: { company_id: companyId, channel_key: "email" } } }).catch(() => null)
  ]);
  const list = new Set((platform?.protected_domains || []).map((d) => String(d).toLowerCase().trim()).filter(Boolean));
  const add = (d) => { if (d && !FREEMAIL.has(d)) list.add(d); };
  add(domainOf(channel?.config?.address));
  add(domainOf(company?.contact_email));
  add(hostOf(company?.website || ""));
  return [...list];
}

function outreachFingerprint(settings) {
  const c = settings?.outreach_config || {};
  return crypto.createHash("sha256").update(JSON.stringify([c.address, c.username, c.smtp_host, c.smtp_port, c.imap_host, c.imap_port, settings?.outreach_secret || ""])).digest("hex");
}

function outreachPass(settings) {
  try { return settings?.outreach_secret ? decryptSecret(settings.outreach_secret) : ""; } catch { return ""; }
}

/** The outreach mailbox, with every rule checked. */
async function resolveOutreachSender(companyId, settings, platform) {
  const c = settings.outreach_config || {};
  if (!c.address || !settings.outreach_secret) return { ok: false, problem: "Add an outreach mailbox first (Settings › Email Engine › Outreach mailbox). It must be on a separate domain, not your main company email." };
  const domain = domainOf(c.address);
  const forbidden = await forbiddenDomains(companyId, platform);
  if (forbidden.includes(domain)) return { ok: false, problem: `${c.address} is on ${domain}, which is your main email domain (or protected by AIStaff). Use a mailbox on a separate domain for outreach, so your main inbox is never put at risk.` };
  if (FREEMAIL.has(domain)) return { ok: false, problem: "Use a mailbox on your own separate business domain for outreach, not a free email address." };
  if (settings.outreach_tested_hash !== outreachFingerprint(settings)) return { ok: false, problem: "The outreach mailbox has not passed Test connection since it was last changed." };
  const pass = outreachPass(settings);
  if (!pass) return { ok: false, problem: "The outreach mailbox password could not be read. Type it again and Save." };
  return { ok: true, source: "outreach", address: c.address, senderName: c.sender_name || c.address, config: c, pass, signature: "", dailyLimit: Number(c.daily_limit) || 1000 };
}

function imapFor(sender) {
  const c = sender.config;
  return new ImapFlow({
    host: c.imap_host || "imap.hostinger.com", port: Number(c.imap_port) || 993, secure: Number(c.imap_port || 993) === 993,
    auth: { user: c.username || sender.address, pass: sender.pass }, logger: false,
    socketTimeout: 60000, greetingTimeout: 20000, connectionTimeout: 20000
  });
}

/** Test: SMTP login + IMAP login (replies are read from this inbox). Nothing is sent. */
async function testOutreachMailbox(companyId) {
  const ee = require("./email-engine");
  const [settings, platform] = await Promise.all([ee.getSettings(companyId), ee.getPlatform()]);
  const c = settings.outreach_config || {};
  if (!c.address || !settings.outreach_secret) return { ok: false, error: "Save the mailbox address and password first." };
  const forbidden = await forbiddenDomains(companyId, platform);
  if (forbidden.includes(domainOf(c.address)) || FREEMAIL.has(domainOf(c.address))) {
    return { ok: false, error: `${c.address} cannot be used for outreach: use a mailbox on a separate business domain (not ${[...forbidden].join(", ")}).` };
  }
  const sender = { address: c.address, config: c, pass: outreachPass(settings), source: "outreach" };
  const result = { smtp: false, imap: false };
  try { await ee.transportFor(sender).verify(); result.smtp = true; } catch (error) { result.smtp_error = String(error?.response || error?.message).slice(0, 200); }
  const client = imapFor(sender);
  try { await client.connect(); await client.status("INBOX", { messages: true }); result.imap = true; } catch (error) { result.imap_error = String(error?.message).slice(0, 200); } finally { await client.logout().catch(() => {}); }
  const ok = result.smtp && result.imap;
  await prisma.emailEngineSetting.update({ where: { company_id: companyId }, data: ok
    ? { outreach_tested_hash: outreachFingerprint(settings), outreach_tested_at: new Date(), outreach_last_error: null }
    : { outreach_tested_hash: null, outreach_last_error: [result.smtp_error && `Sending: ${result.smtp_error}`, result.imap_error && `Reading replies: ${result.imap_error}`].filter(Boolean).join(" · ") } });
  return ok ? { ok: true } : { ok: false, error: [result.smtp ? "" : `Sending (SMTP): ${result.smtp_error}`, result.imap ? "" : `Reading replies (IMAP): ${result.imap_error}`].filter(Boolean).join(" · "),
    steps: require("./email-engine").troubleshooting(/auth|login|535/i.test(`${result.smtp_error} ${result.imap_error}`) ? "login" : "connection", { ...sender, source: "mailbox" }) };
}

function piaComplete(pia) {
  const p = pia || {};
  const text = ["purpose", "data_used", "source_of_data", "lawful_basis", "opt_out", "security"].every((k) => String(p[k] || "").trim().length >= 10);
  const confirms = Object.keys(PIA_CONFIRMS).every((k) => p.confirms && p.confirms[k] === true);
  return text && confirms && Number(p.retention_days) > 0;
}

/* ------------------------------ composing ------------------------------ */

function footerFor(settings, campaign, companyName, recipient) {
  const person = campaign.sender_person || {};
  const fill = { sender_name: person.name || "", sender_title: person.title || "", company: companyName || "", source: recipient.source_note || "your company's public listing", organization: recipient.organization || "" };
  return String(settings.outreach_footer || DEFAULT_FOOTER)
    .replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (all, k) => (fill[k.toLowerCase()] !== undefined ? fill[k.toLowerCase()] : all))
    .replace(/,\s*\n/g, "\n").replace(/^\s*,\s*/gm, "").replace(/\n{3,}/g, "\n\n").trim();
}

function threadSubject(recipient) {
  const first = (recipient.events || []).find((e) => e.type === "sent" && e.step === 0);
  const base = first?.subject || recipient.draft_subject || "";
  return recipient.step > 0 && base && !/^re:/i.test(base) ? `Re: ${base}` : (recipient.draft_subject || base);
}

function buildOutreachMail({ campaign, recipient, sender, settings, companyName, companyId }) {
  const ee = require("./email-engine");
  const subject = threadSubject(recipient);
  const footer = footerFor(settings, campaign, companyName, recipient);
  const text = `${String(recipient.draft_body || "").trim()}\n\n${footer}`;
  const unsubUrl = `${String(process.env.APP_PUBLIC_URL || process.env.APP_BASE_URL || "https://aistaff.click").replace(/\/+$/, "")}/u/${ee.unsubscribeToken(companyId, recipient.email)}`;
  const messageId = `<${crypto.randomUUID()}@${domainOf(sender.address) || "aistaff.click"}>`;
  const refs = recipient.message_ids || [];
  return {
    messageId, subject, text,
    mail: {
      from: { name: sender.senderName, address: sender.address },
      to: recipient.name ? { name: recipient.name, address: recipient.email } : recipient.email,
      subject, text, messageId,
      inReplyTo: refs.length ? refs[refs.length - 1] : undefined,
      references: refs.length ? refs.slice(-10) : undefined,
      headers: { "List-Unsubscribe": `<${unsubUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click", "X-AIStaff-Channel": "email-outreach", "X-AIStaff-Campaign": campaign.id }
    }
  };
}

function eventsWith(recipient, event) {
  return [...(Array.isArray(recipient.events) ? recipient.events : []), { at: new Date().toISOString(), ...event }].slice(-40);
}

/* ------------------------------ drafting (AI writes; code gathers facts) ------------------------------ */

function draftPrompt({ campaign, recipient, companyName }) {
  const person = campaign.sender_person || {};
  const previous = (recipient.events || []).filter((e) => e.type === "sent").map((e) => ({ step: e.step, subject: e.subject, body: e.body }));
  const followUp = recipient.step > 0;
  return [
    "You write ONE short business email from one person to one company. It is not a newsletter or a mass email.",
    "Return JSON only: {\"subject\": string, \"body\": string}.",
    "",
    "FACTS YOU MAY USE (use nothing else, invent nothing — no numbers, clients, results or claims that are not written here):",
    JSON.stringify({
      our_company: companyName, sender_name: person.name || "", sender_title: person.title || "",
      what_we_offer_and_goal: campaign.brief || "",
      recipient: { company: recipient.organization || "", contact_name: recipient.name || "", address_kind: recipient.address_type, why_this_company_fits: recipient.reason_note || "" },
      this_is: followUp ? `follow-up number ${recipient.step} (they have not replied)` : "the first email",
      emails_already_sent_to_them: previous
    }, null, 2),
    "",
    "HOW TO WRITE:",
    "- Write it for THIS company: connect what we offer to the reason they fit. If the reason is empty, keep it general but honest.",
    "- Greet the contact by name if a name is given; otherwise greet the company's team naturally.",
    followUp ? "- Follow-up: 2-4 sentences, polite, add one new useful point, do not repeat the first email, no guilt or pressure." : "- First email: 80-140 words, plain and friendly, one clear reason to talk.",
    "- End with ONE simple question (for example whether a short call or more information would help).",
    "- Write in the same language as what_we_offer_and_goal.",
    "- Plain text only. No links unless they appear in what_we_offer_and_goal. No emojis, no ALL CAPS, no exaggerated promises.",
    "- Do NOT add a signature, sign-off name, contact details or an opt-out line: the system adds who we are, where we found them, and the STOP option below your text.",
    followUp ? "- subject: return an empty string (the system keeps the same thread subject)." : "- subject: short, specific to them, not salesy (under 60 characters)."
  ].join("\n");
}

let drafting = false;
async function draftTick() {
  if (drafting) return;
  drafting = true;
  try {
    const platform = await require("./email-engine").getPlatform();
    if (platform.paused_all || !platform.outreach_enabled) return;
    const campaigns = await prisma.emailCampaign.findMany({ where: { kind: "outreach", status: "sending" }, orderBy: { started_at: "asc" }, take: 20 });
    for (const campaign of campaigns) {
      const ready = await prisma.emailCampaignRecipient.count({ where: { campaign_id: campaign.id, status: { in: ["review", "pending"] } } });
      if (ready >= Math.max(5, (campaign.pace_count || 10) * 2)) continue;
      const recipient = await prisma.emailCampaignRecipient.findFirst({
        where: { campaign_id: campaign.id, status: "draft_needed", OR: [{ next_try_at: null }, { next_try_at: { lte: new Date() } }] },
        orderBy: [{ step: "desc" }, { created_at: "asc" }]
      });
      if (!recipient) continue;
      const claimed = await prisma.emailCampaignRecipient.updateMany({ where: { id: recipient.id, status: "draft_needed" }, data: { status: "drafting" } });
      if (!claimed.count) continue;
      const company = await prisma.company.findUnique({ where: { id: campaign.company_id }, select: { name: true } });
      try {
        const { callCloserModelJSON } = require("./ai");
        const out = await callCloserModelJSON(draftPrompt({ campaign, recipient, companyName: company?.name }));
        const body = String(out?.body || "").trim();
        const subject = String(out?.subject || "").trim().slice(0, 200);
        if (!body || (recipient.step === 0 && !subject)) throw new Error("The AI returned an empty subject or message.");
        await prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data: {
          draft_subject: recipient.step === 0 ? subject : recipient.draft_subject, draft_body: body.slice(0, 6000), draft_error: null, attempts: 0, next_try_at: null,
          status: campaign.require_review ? "review" : "pending", events: eventsWith(recipient, { type: "drafted", step: recipient.step })
        } });
        console.log("[email-outreach] drafted campaign=%s recipient=%s step=%d", campaign.id, recipient.email, recipient.step);
      } catch (error) {
        const tries = (recipient.attempts || 0) + 1;
        const msg = String(error?.message || error).slice(0, 240);
        console.warn("[email-outreach] draft failed campaign=%s recipient=%s try=%d: %s", campaign.id, recipient.email, tries, msg);
        // After 3 failed tries a person writes it: it goes to review with the error shown.
        await prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data: tries >= 3
          ? { status: "review", draft_error: `The AI could not write this email (${msg}). Write it yourself or press Write again.`, attempts: 0 }
          : { status: "draft_needed", draft_error: msg, attempts: tries, next_try_at: new Date(Date.now() + 10 * 60 * 1000) } });
      }
      break; // one draft per tick: the local model is shared with Closer
    }
  } catch (error) {
    console.error("[email-outreach] draft tick failed: %s", error.message);
  } finally {
    drafting = false;
  }
}

/* ------------------------------ sending ------------------------------ */

async function processOutreach(campaign, platform) {
  const ee = require("./email-engine");
  if (!platform.outreach_enabled) { ee.waitNote.set(campaign.id, "Outreach is switched off by AIStaff for now."); return; }

  // Follow-ups that are due become new drafts (only for people who have not replied).
  const due = await prisma.emailCampaignRecipient.findMany({ where: { campaign_id: campaign.id, status: "waiting", outcome: null, next_step_at: { lte: new Date() } }, take: 20 });
  for (const r of due) {
    if (r.step >= campaign.followups) { await prisma.emailCampaignRecipient.update({ where: { id: r.id }, data: { status: "sent", next_step_at: null } }); continue; }
    await prisma.emailCampaignRecipient.updateMany({ where: { id: r.id, status: "waiting", outcome: null }, data: { status: "draft_needed", step: r.step + 1, draft_body: null, draft_error: null, next_step_at: null } });
  }

  const settings = await ee.getSettings(campaign.company_id);
  const sender = await resolveOutreachSender(campaign.company_id, settings, platform);
  if (!sender.ok) return ee.pauseCampaign(campaign, "sender", sender.problem, [sender.problem, "Then press Resume in Settings › Email Engine."]);

  const address = cleanEmail(sender.address);
  if ((ee.nextSendAt.get(address) || 0) > Date.now()) return;

  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const tenantToday = await prisma.emailCampaignRecipient.count({ where: { company_id: campaign.company_id, sent_at: { gte: since }, campaign: { kind: "outreach" } } });
  if (tenantToday >= platform.outreach_max_per_day) { ee.waitNote.set(campaign.id, `AIStaff outreach limit reached (${platform.outreach_max_per_day} per day per company). Continues automatically.`); return; }
  const mailboxToday = await prisma.emailCampaignRecipient.count({ where: { from_address: address, sent_at: { gte: since } } });
  if (mailboxToday >= Math.min(sender.dailyLimit, platform.max_per_day)) { ee.waitNote.set(campaign.id, `Daily limit of ${sender.address} reached. Continues automatically.`); return; }

  const recipient = await prisma.emailCampaignRecipient.findFirst({ where: { campaign_id: campaign.id, status: "pending" }, orderBy: [{ step: "desc" }, { updated_at: "asc" }] });
  if (!recipient) {
    const waitingReview = await prisma.emailCampaignRecipient.count({ where: { campaign_id: campaign.id, status: "review" } });
    if (waitingReview) ee.waitNote.set(campaign.id, `${waitingReview} email${waitingReview > 1 ? "s are" : " is"} waiting for your approval.`);
    else ee.waitNote.delete(campaign.id);
    await ee.finishIfDone(campaign);
    return;
  }
  ee.waitNote.delete(campaign.id);

  const blocked = await prisma.emailSuppression.findUnique({ where: { company_id_email: { company_id: campaign.company_id, email: recipient.email } } });
  if (blocked || recipient.outcome) {
    await prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data: { status: "skipped", error: blocked ? `On the do-not-email list (${blocked.reason})` : `Stopped: ${recipient.outcome}` } });
    await ee.refreshCounts(campaign.id);
    return;
  }
  const claimed = await prisma.emailCampaignRecipient.updateMany({ where: { id: recipient.id, status: "pending" }, data: { status: "sending", from_address: address } });
  if (!claimed.count) return;
  ee.nextSendAt.set(address, Date.now() + Math.ceil(60000 / ee.ratePerMinute(settings, platform)));

  const company = await prisma.company.findUnique({ where: { id: campaign.company_id }, select: { name: true } });
  const built = buildOutreachMail({ campaign, recipient, sender, settings, companyName: company?.name, companyId: campaign.company_id });
  try {
    const raw = await new MailComposer(built.mail).compile().build();
    await ee.transportFor(sender).sendMail({ envelope: { from: sender.address, to: [recipient.email] }, raw });
    appendSent(sender, raw).catch(() => {});
    const more = recipient.step < campaign.followups;
    await prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data: {
      status: more ? "waiting" : "sent", sent_at: new Date(), message_id: built.messageId, message_ids: [...(recipient.message_ids || []), built.messageId].slice(-10),
      next_step_at: more ? new Date(Date.now() + campaign.followup_days * 86400000) : null, error: null,
      events: eventsWith(recipient, { type: "sent", step: recipient.step, subject: built.subject, body: recipient.draft_body, from: sender.address })
    } });
    await prisma.emailCampaign.update({ where: { id: campaign.id }, data: { last_sent_at: new Date(), from_address: sender.address } });
    console.log("[email-outreach] sent campaign=%s to=%s step=%d", campaign.id, recipient.email, recipient.step);
    await ee.refreshCounts(campaign.id);
  } catch (error) {
    const kind = ee.classify(error);
    const msg = String(error?.response || error?.message || error).slice(0, 300);
    if (kind.kind === "stop") {
      await prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data: { status: "pending", error: msg } });
      ee.nextSendAt.set(address, Date.now() + 5 * 60 * 1000);
      return ee.pauseCampaign(campaign, kind.why, `Sending from ${sender.address} failed: ${msg}`, ee.troubleshooting(kind.why, { ...sender, source: "mailbox" }));
    }
    const final = kind.kind === "recipient";
    await prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data: final
      ? { status: "failed", error: msg, outcome: kind.why === "bad_address" ? "bounced" : null, events: eventsWith(recipient, { type: "failed", step: recipient.step, error: msg }) }
      : { status: "pending", error: msg } });
    if (final && kind.why === "bad_address") await suppress(campaign.company_id, recipient.email, "bounced", msg);
    await ee.refreshCounts(campaign.id);
  }
}

async function appendSent(sender, raw) {
  const client = imapFor(sender);
  try {
    await client.connect();
    const boxes = await client.list();
    const sent = boxes.find((b) => b.specialUse === "\\Sent") || boxes.find((b) => /^(inbox\.)?sent( items| messages)?$/i.test(b.path));
    if (sent) await client.append(sent.path, raw, ["\\Seen"]);
  } finally { await client.logout().catch(() => {}); }
}

async function suppress(companyId, email, reason, note) {
  await prisma.emailSuppression.upsert({
    where: { company_id_email: { company_id: companyId, email: cleanEmail(email) } },
    update: reason === "unsubscribed" ? { reason, note: String(note || "").slice(0, 200) } : {},
    create: { company_id: companyId, email: cleanEmail(email), reason, note: String(note || "").slice(0, 200) }
  }).catch((error) => console.error("[email-outreach] suppress failed: %s", error.message));
}

/* ------------------------------ reading replies ------------------------------ */

function newText(parsed) {
  const text = String(parsed.text || "").replace(/\r/g, "");
  const cut = text.search(/\n(On .{5,200}wrote:|-{2,}\s*Original Message|From: .+\nSent: )/i);
  return (cut > 0 ? text.slice(0, cut) : text).split("\n").filter((l) => !/^\s*>/.test(l)).join("\n").trim();
}

function isBounce(parsed, raw) {
  const from = cleanEmail(parsed.from?.value?.[0]?.address);
  return /mailer-daemon|postmaster/i.test(from) || /multipart\/report/i.test(String(parsed.headers.get("content-type")?.value || "")) || /report-type=delivery-status/i.test(raw.slice(0, 4000));
}

async function classifyReply(text) {
  const firstLine = String(text || "").trim().split(/\n/)[0].trim().replace(/[.!]+$/, "");
  if (/^stop$/i.test(firstLine)) return { intent: "opt_out", summary: "Replied STOP" };
  try {
    const { callCloserModelJSON } = require("./ai");
    const out = await callCloserModelJSON([
      "Classify this reply to a one-to-one business email. Return JSON only: {\"intent\": one of \"opt_out\", \"not_interested\", \"interested\", \"question\", \"out_of_office\", \"other\", \"summary\": one short sentence}.",
      "opt_out = they ask not to be emailed / to be removed, in any language. not_interested = a clear no. out_of_office = an automatic away message.",
      "Reply:", String(text || "").slice(0, 3000)
    ].join("\n"));
    const intent = ["opt_out", "not_interested", "interested", "question", "out_of_office", "other"].includes(out?.intent) ? out.intent : "other";
    return { intent, summary: String(out?.summary || "").slice(0, 300) };
  } catch (error) {
    return { intent: "unknown", summary: `Could not classify automatically (${error.message}). Please read it.` };
  }
}

async function handleMessage(companyId, raw) {
  const parsed = await simpleParser(raw);
  const idsInMail = [...new Set((raw.toString("utf8").match(/<[^<>\s]+@[^<>\s]+>/g) || []))];
  let recipient = idsInMail.length ? await prisma.emailCampaignRecipient.findFirst({ where: { company_id: companyId, message_ids: { hasSome: idsInMail } }, include: { campaign: true } }) : null;
  const bounce = isBounce(parsed, raw.toString("utf8"));
  if (!recipient && !bounce) {
    const from = cleanEmail(parsed.from?.value?.[0]?.address);
    if (from) recipient = await prisma.emailCampaignRecipient.findFirst({ where: { company_id: companyId, email: from, campaign: { kind: "outreach" }, sent_at: { not: null } }, orderBy: { sent_at: "desc" }, include: { campaign: true } });
  }
  if (!recipient || recipient.campaign?.kind !== "outreach") return null;

  if (bounce) {
    await prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data: { outcome: "bounced", status: ["waiting", "pending", "draft_needed", "review"].includes(recipient.status) ? "failed" : recipient.status, next_step_at: null, error: "Bounced (address does not work)", events: eventsWith(recipient, { type: "bounced" }) } });
    await suppress(companyId, recipient.email, "bounced", "Bounce message received");
    await require("./email-engine").refreshCounts(recipient.campaign_id);
    return "bounced";
  }

  const text = newText(parsed);
  const verdict = await classifyReply(text);
  if (verdict.intent === "out_of_office") {
    await prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data: { events: eventsWith(recipient, { type: "auto_reply", summary: verdict.summary }) } });
    return "out_of_office";
  }
  const optedOut = verdict.intent === "opt_out" || verdict.intent === "not_interested";
  await prisma.emailCampaignRecipient.update({ where: { id: recipient.id }, data: {
    outcome: optedOut ? "opted_out" : "replied", replied_at: new Date(), reply_snippet: text.slice(0, 2000), next_step_at: null,
    status: ["waiting", "pending", "draft_needed", "review"].includes(recipient.status) ? "sent" : recipient.status,
    events: eventsWith(recipient, { type: optedOut ? "opted_out" : "replied", intent: verdict.intent, summary: verdict.summary })
  } });
  if (optedOut) await suppress(companyId, recipient.email, "unsubscribed", `Replied: ${verdict.summary || text.slice(0, 120)}`);
  else await alertReply(companyId, recipient, text, verdict);
  await require("./email-engine").refreshCounts(recipient.campaign_id);
  console.log("[email-outreach] reply campaign=%s from=%s intent=%s", recipient.campaign_id, recipient.email, verdict.intent);
  return verdict.intent;
}

async function alertReply(companyId, recipient, text, verdict) {
  try {
    const notify = require("./notify");
    const settings = await prisma.companySetting.findUnique({ where: { company_id: companyId } });
    const company = await prisma.company.findUnique({ where: { id: companyId }, select: { name: true } });
    const { tenant } = notify.alertAudiences(settings);
    const esc = (v) => String(v || "").replace(/&/g, "&amp;").replace(/</g, "&lt;");
    for (const t of tenant) {
      await notify.sendNotification({
        to: t.email, audience: "tenant", tenantName: company?.name,
        subject: `Outreach reply from ${recipient.organization || recipient.email}`,
        text: `${recipient.name || recipient.email} (${recipient.organization || ""}) replied to "${recipient.campaign?.name}".\nAI reading: ${verdict.intent} — ${verdict.summary}\n\n${text.slice(0, 2000)}\n\nFollow-ups to them are stopped. Answer them from the outreach mailbox.`,
        html: `<p><b>${esc(recipient.name || recipient.email)}</b> (${esc(recipient.organization)}) replied to <b>${esc(recipient.campaign?.name)}</b>.</p><p class="muted">AI reading: ${esc(verdict.intent)} — ${esc(verdict.summary)}</p><blockquote style="border-left:3px solid #ccc;padding-left:10px">${esc(text.slice(0, 2000)).replace(/\n/g, "<br>")}</blockquote><p>Follow-ups to them are stopped. Answer them from the outreach mailbox.</p>`
      });
    }
  } catch (error) {
    console.error("[email-outreach] reply alert failed: %s", error.message);
  }
}

let polling = false;
async function pollReplies() {
  if (polling) return;
  polling = true;
  try {
    const ee = require("./email-engine");
    const platform = await ee.getPlatform();
    const rows = await prisma.emailEngineSetting.findMany({ where: { outreach_tested_hash: { not: null } } });
    for (const settings of rows) {
      const recent = await prisma.emailCampaignRecipient.count({ where: { company_id: settings.company_id, sent_at: { gte: new Date(Date.now() - 90 * 86400000) }, campaign: { kind: "outreach" } } });
      if (!recent) continue;
      const sender = await resolveOutreachSender(settings.company_id, settings, platform);
      if (!sender.ok) continue;
      const client = imapFor(sender);
      const poll = settings.outreach_poll || {};
      try {
        await client.connect();
        const lock = await client.getMailboxLock("INBOX");
        try {
          const box = client.mailbox;
          let last = Number(poll.last_uid || 0);
          if (String(poll.uid_validity || "") !== String(box.uidValidity)) last = Math.max(0, Number(box.uidNext || 1) - 1 - 200); // first run / mailbox reset: look at recent mail only
          let maxUid = last, handled = 0;
          for await (const msg of client.fetch(`${last + 1}:*`, { uid: true, source: true }, { uid: true })) {
            if (msg.uid <= last) continue;
            maxUid = Math.max(maxUid, msg.uid);
            const r = await handleMessage(settings.company_id, msg.source).catch((error) => { console.error("[email-outreach] message %d failed: %s", msg.uid, error.message); return null; });
            if (r) handled++;
            if (handled > 50) break;
          }
          await prisma.emailEngineSetting.update({ where: { id: settings.id }, data: { outreach_poll: { uid_validity: String(box.uidValidity), last_uid: maxUid, checked_at: new Date().toISOString() }, outreach_last_error: null } });
        } finally { lock.release(); }
      } catch (error) {
        console.error("[email-outreach] reading replies failed company=%s: %s", settings.company_id, error.message);
        await prisma.emailEngineSetting.update({ where: { id: settings.id }, data: { outreach_last_error: `Reading replies failed: ${String(error.message).slice(0, 200)}` } }).catch(() => {});
      } finally {
        await client.logout().catch(() => {});
      }
    }
  } catch (error) {
    console.error("[email-outreach] poll failed: %s", error.message);
  } finally {
    polling = false;
  }
}

/* ------------------------------ prospects + record ------------------------------ */

/** Rows: email, company, contact name, where found, why they fit (comma, tab or semicolon). */
function parseProspects(text) {
  const rows = [], invalid = [], seen = new Set();
  for (const raw of String(text || "").split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    const cells = (line.includes("\t") ? line.split("\t") : line.split(/[,;](?=(?:[^"]*"[^"]*")*[^"]*$)/)).map((c) => c.trim().replace(/^"|"$/g, "").trim());
    const email = cleanEmail(cells[0]);
    if (!require("./email-engine").validEmail(email)) { if (!/email/i.test(cells[0])) invalid.push(line.slice(0, 80)); continue; }
    if (seen.has(email)) continue;
    seen.add(email);
    rows.push({ email, organization: cells[1] || null, name: cells[2] || null, source_note: cells[3] || null, reason_note: cells.slice(4).join(", ") || null, address_type: addressType(email) });
  }
  return { rows, invalid };
}

function csvCell(v) { const s = String(v == null ? "" : v); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; }

async function recordCsv(campaign) {
  const rows = await prisma.emailCampaignRecipient.findMany({ where: { campaign_id: campaign.id }, orderBy: { created_at: "asc" } });
  const pia = campaign.pia || {};
  const head = [
    `# Outreach record: ${campaign.name}`, `# Exported: ${new Date().toISOString()}`,
    `# Privacy check completed: ${campaign.pia_done_at ? campaign.pia_done_at.toISOString() : "no"} by ${campaign.pia_by || "-"}`,
    ...["purpose", "data_used", "source_of_data", "lawful_basis", "opt_out", "retention_days", "security"].map((k) => `# ${k}: ${String(pia[k] ?? "").replace(/\n/g, " ")}`),
    ...Object.keys(PIA_CONFIRMS).map((k) => `# confirmed - ${PIA_CONFIRMS[k]} ${pia.confirms?.[k] ? "YES" : "NO"}`)
  ];
  const cols = ["email", "company", "contact_name", "address_type", "where_found", "why_contacted", "status", "emails_sent", "first_sent", "last_sent", "outcome", "replied_at", "reply"];
  const lines = rows.map((r) => {
    const sent = (r.events || []).filter((e) => e.type === "sent");
    return [r.email, r.organization, r.name, r.address_type, r.source_note, r.reason_note, r.status, sent.length, sent[0]?.at || "", sent[sent.length - 1]?.at || "", r.outcome || "", r.replied_at ? r.replied_at.toISOString() : "", (r.reply_snippet || "").slice(0, 300)].map(csvCell).join(",");
  });
  return [...head, cols.join(","), ...lines].join("\n");
}

function startOutreachJobs() {
  setInterval(draftTick, 10 * 1000).unref();
  setInterval(pollReplies, 2 * 60 * 1000).unref();
  console.log("[email-outreach] drafting + reply reading started");
}

module.exports = {
  ACTIVE, DEFAULT_FOOTER, DEFAULT_PIA, PIA_CONFIRMS, addressType, forbiddenDomains, resolveOutreachSender, testOutreachMailbox, outreachFingerprint,
  piaComplete, footerFor, buildOutreachMail, draftPrompt, draftTick, processOutreach, pollReplies, handleMessage, classifyReply, parseProspects,
  recordCsv, suppress, eventsWith, startOutreachJobs
};
