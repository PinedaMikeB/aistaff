/**
 * Email Engine API (added 2026-10-22).
 *   Tenant (Settings › Email Engine), tenant admins or platform assist:
 *     GET    /api/email-engine                      overview: sender, today's limit, campaigns, contacts
 *     PUT    /api/email-engine/settings             sender choice, speed, limits, footer
 *     POST   /api/email-engine/mailbox/test         test the separate sending mailbox (nothing is sent)
 *     GET    /api/email-engine/contacts             ?q=&list=&page=
 *     POST   /api/email-engine/contacts/import      { text, list }
 *     POST   /api/email-engine/contacts/import-closer   emails Closer already collected
 *     DELETE /api/email-engine/contacts/:id
 *     GET/POST/DELETE /api/email-engine/blocked     do-not-email list
 *     POST   /api/email-engine/campaigns            { name, subject, body_text }
 *     GET    /api/email-engine/campaigns/:id
 *     PUT    /api/email-engine/campaigns/:id        draft only
 *     DELETE /api/email-engine/campaigns/:id        draft only
 *     POST   /api/email-engine/campaigns/:id/recipients   { source: all|list|paste, list, text }
 *     POST   /api/email-engine/campaigns/:id/test   { to }
 *     POST   /api/email-engine/campaigns/:id/(send|pause|resume|cancel|retry-failed)
 *   Platform (Platform › Email Engine), permission emailengine.manage:
 *     GET/PUT /api/platform/email-engine,  POST /api/platform/email-engine/campaigns/:id/pause
 *   Public: GET/POST /u/:token  unsubscribe (GET shows a button so link scanners cannot unsubscribe people)
 */
const express = require("express");
const { prisma } = require("../db");
const ee = require("../email-engine");
const { requirePermission } = require("../platform-roles");
const outreach = require("../email-outreach");

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
const MAX_RECIPIENTS = 20000;

function requireTenantAdmin(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();
  if (!["admin", "account_admin", "owner"].includes(role) && !(req.user?.platform_role && req.assistSessionId)) {
    return res.status(403).json({ error: "Only a tenant administrator can use the Email Engine." });
  }
  next();
}

function audit(req, action, metadata) {
  return prisma.tenantAuditLog.create({ data: {
    company_id: req.companyId, actor_id: req.user?.id || null, actor_email: req.user?.email || null,
    action, target_type: "email_engine", target_id: metadata?.campaign_id || null, metadata
  } }).catch(() => {});
}

function cleanText(value, max) { return String(value == null ? "" : value).replace(/\r\n/g, "\n").slice(0, max); }
function cleanList(value) { return String(value || "").trim().replace(/\s+/g, " ").slice(0, 60); }

function settingsView(s) {
  const c = s.mailbox_config || {};
  return {
    sender_mode: s.sender_mode, per_minute: s.per_minute, mailbox_daily_limit: s.mailbox_daily_limit, reserve_for_closer: s.reserve_for_closer,
    footer_text: s.footer_text || "", unsubscribe_label: s.unsubscribe_label || ee.DEFAULT_SETTINGS.unsubscribe_label,
    test_address: s.test_address || "", reply_to: s.reply_to || "",
    mailbox: {
      address: c.address || "", sender_name: c.sender_name || "", username: c.username || "",
      smtp_host: c.smtp_host || "smtp.hostinger.com", smtp_port: c.smtp_port || 465,
      has_password: Boolean(s.mailbox_secret), tested: Boolean(s.mailbox_tested_hash && s.mailbox_tested_hash === ee.mailboxFingerprint(s)),
      tested_at: s.mailbox_tested_at
    },
    outreach: (() => {
      const o = s.outreach_config || {};
      return {
        address: o.address || "", sender_name: o.sender_name || "", username: o.username || "",
        smtp_host: o.smtp_host || "smtp.hostinger.com", smtp_port: o.smtp_port || 465, imap_host: o.imap_host || "imap.hostinger.com", imap_port: o.imap_port || 993,
        daily_limit: o.daily_limit || 1000, has_password: Boolean(s.outreach_secret),
        tested: Boolean(s.outreach_tested_hash && s.outreach_tested_hash === outreach.outreachFingerprint(s)), tested_at: s.outreach_tested_at,
        last_error: s.outreach_last_error, replies_checked_at: (s.outreach_poll || {}).checked_at || null
      };
    })(),
    outreach_footer: s.outreach_footer || outreach.DEFAULT_FOOTER
  };
}

function campaignView(c) {
  return {
    id: c.id, name: c.name, subject: c.subject, body_text: c.body_text, status: c.status, pause_reason: c.pause_reason,
    from_address: c.from_address, total: c.total, sent: c.sent_count, failed: c.failed_count, skipped: c.skipped_count,
    pending: Math.max(0, c.total - c.sent_count - c.failed_count - c.skipped_count),
    started_at: c.started_at, finished_at: c.finished_at, created_at: c.created_at, last_error: c.last_error, last_error_at: c.last_error_at,
    waiting: ee.waitNote.get(c.id) || null,
    kind: c.kind || "broadcast", pace_count: c.pace_count, pace_hours: c.pace_hours, send_window: c.send_window || {},
    followups: c.followups, followup_days: c.followup_days, require_review: c.require_review, brief: c.brief || "", sender_person: c.sender_person || {},
    pia: c.pia || {}, pia_done: Boolean(c.pia_done_at), pia_done_at: c.pia_done_at, pia_by: c.pia_by
  };
}

async function outreachStats(campaignId) {
  const [byStatus, byOutcome] = await Promise.all([
    prisma.emailCampaignRecipient.groupBy({ by: ["status"], where: { campaign_id: campaignId }, _count: { _all: true } }),
    prisma.emailCampaignRecipient.groupBy({ by: ["outcome"], where: { campaign_id: campaignId }, _count: { _all: true } })
  ]);
  const st = Object.fromEntries(byStatus.map((g) => [g.status, g._count._all]));
  const oc = Object.fromEntries(byOutcome.map((g) => [g.outcome || "none", g._count._all]));
  return { review: st.review || 0, held: st.held || 0, drafting: (st.draft_needed || 0) + (st.drafting || 0), ready: st.pending || 0, waiting_followup: st.waiting || 0,
    replied: oc.replied || 0, opted_out: oc.opted_out || 0, bounced: oc.bounced || 0, no_reply: oc.no_reply || 0 };
}

function paceFields(b) {
  const out = {};
  if (b.pace_count !== undefined || b.pace_hours !== undefined) {
    const count = Number(b.pace_count), hours = Number(b.pace_hours);
    if (count > 0 && hours > 0) { out.pace_count = ee.clampInt(count, 1, 10000, 10); out.pace_hours = ee.clampInt(hours, 1, 168, 24); }
    else { out.pace_count = null; out.pace_hours = null; }
  }
  if (b.send_window !== undefined) {
    const w = b.send_window || {};
    const hhmm = (v) => (/^\d{1,2}:\d{2}$/.test(String(v || "")) ? String(v) : "");
    out.send_window = w.enabled === false ? {} : { weekdays_only: Boolean(w.weekdays_only), from: hhmm(w.from), to: hhmm(w.to) };
  }
  return out;
}

function outreachFields(b) {
  const out = { ...paceFields(b) };
  if (b.brief !== undefined) out.brief = cleanText(b.brief, 4000);
  if (b.sender_person !== undefined) out.sender_person = { name: cleanText(b.sender_person?.name, 80).trim(), title: cleanText(b.sender_person?.title, 80).trim() };
  if (b.followups !== undefined) out.followups = ee.clampInt(b.followups, 0, 2, 1);
  if (b.followup_days !== undefined) out.followup_days = ee.clampInt(b.followup_days, 2, 30, 4);
  if (b.require_review !== undefined) out.require_review = Boolean(b.require_review);
  return out;
}

async function loadCampaign(req, res) {
  const c = await prisma.emailCampaign.findFirst({ where: { id: req.params.id, company_id: req.companyId } });
  if (!c) { res.status(404).json({ error: "Campaign not found." }); return null; }
  return c;
}

async function overview(companyId) {
  const [settings, platform, campaigns, contactCount, blockedCount, listRows] = await Promise.all([
    ee.getSettings(companyId), ee.getPlatform(),
    prisma.emailCampaign.findMany({ where: { company_id: companyId }, orderBy: { created_at: "desc" }, take: 30 }),
    prisma.emailContact.count({ where: { company_id: companyId } }),
    prisma.emailSuppression.count({ where: { company_id: companyId } }),
    prisma.$queryRaw`SELECT l AS name, COUNT(*)::int AS count FROM email_contacts, unnest(lists) AS l WHERE company_id = ${companyId} GROUP BY l ORDER BY l`
  ]);
  const sender = await ee.resolveSender(companyId, settings);
  const today = sender.ok ? await ee.budget(companyId, settings, sender, platform) : null;
  const oSender = await outreach.resolveOutreachSender(companyId, settings, platform);
  const views = [];
  for (const c of campaigns) views.push({ ...campaignView(c), ...(c.kind === "outreach" ? { stats: await outreachStats(c.id) } : {}) });
  return {
    outreach_sender: oSender.ok ? { ok: true, address: oSender.address } : { ok: false, problem: oSender.problem },
    forbidden_domains: await outreach.forbiddenDomains(companyId, platform),
    pia_defaults: outreach.DEFAULT_PIA, pia_confirms: outreach.PIA_CONFIRMS,
    settings: settingsView(settings),
    sender: sender.ok ? { ok: true, address: sender.address, sender_name: sender.senderName, source: sender.source } : { ok: false, problem: sender.problem },
    today, rate_per_minute: ee.ratePerMinute(settings, platform),
    platform: { paused_all: platform.paused_all, pause_note: platform.pause_note, max_per_minute: platform.max_per_minute, max_per_day: platform.max_per_day, outreach_enabled: platform.outreach_enabled, outreach_max_per_day: platform.outreach_max_per_day },
    campaigns: views, contacts: contactCount, blocked: blockedCount, lists: listRows
  };
}

async function upsertContacts(companyId, rows, list, source) {
  let added = 0, updated = 0;
  for (const r of rows) {
    const existing = await prisma.emailContact.findUnique({ where: { company_id_email: { company_id: companyId, email: r.email } } });
    if (existing) {
      const lists = list && !existing.lists.includes(list) ? [...existing.lists, list] : existing.lists;
      await prisma.emailContact.update({ where: { id: existing.id }, data: { lists, name: existing.name || r.name || null, organization: existing.organization || r.organization || null } });
      updated++;
    } else {
      await prisma.emailContact.create({ data: { company_id: companyId, email: r.email, name: r.name || null, organization: r.organization || null, lists: list ? [list] : [], source } });
      added++;
    }
  }
  return { added, updated };
}

function buildRouter({ requireAuth }) {
  const r = express.Router();
  r.use(express.json({ limit: "4mb" }));
  r.use(requireAuth, requireTenantAdmin);

  r.get("/", asyncRoute(async (req, res) => res.json(await overview(req.companyId))));

  r.put("/settings", asyncRoute(async (req, res) => {
    const b = req.body || {};
    const s = await ee.getSettings(req.companyId);
    const data = {};
    if (b.sender_mode !== undefined) data.sender_mode = b.sender_mode === "mailbox" ? "mailbox" : "channel";
    if (b.per_minute !== undefined) data.per_minute = ee.clampInt(b.per_minute, 1, 120, s.per_minute);
    if (b.mailbox_daily_limit !== undefined) data.mailbox_daily_limit = ee.clampInt(b.mailbox_daily_limit, 10, 100000, s.mailbox_daily_limit);
    if (b.reserve_for_closer !== undefined) data.reserve_for_closer = ee.clampInt(b.reserve_for_closer, 0, 100000, s.reserve_for_closer);
    if (b.footer_text !== undefined) data.footer_text = cleanText(b.footer_text, 1500);
    if (b.unsubscribe_label !== undefined) data.unsubscribe_label = cleanText(b.unsubscribe_label, 60).trim() || null;
    if (b.test_address !== undefined) {
      const t = ee.cleanEmail(b.test_address);
      if (t && !ee.validEmail(t)) return res.status(400).json({ error: "The test address is not a valid email." });
      data.test_address = t || null;
    }
    if (b.reply_to !== undefined) {
      const t = ee.cleanEmail(b.reply_to);
      if (t && !ee.validEmail(t)) return res.status(400).json({ error: "The reply-to address is not a valid email." });
      data.reply_to = t || null;
    }
    if (b.mailbox) {
      const m = b.mailbox, c = s.mailbox_config || {};
      const address = ee.cleanEmail(m.address !== undefined ? m.address : c.address);
      if (address && !ee.validEmail(address)) return res.status(400).json({ error: "The sending mailbox address is not a valid email." });
      const host = String(m.smtp_host !== undefined ? m.smtp_host : c.smtp_host || "smtp.hostinger.com").trim().toLowerCase();
      if (host && !/^[a-z0-9.-]+$/.test(host)) return res.status(400).json({ error: "The server name may only contain letters, numbers, dots and dashes." });
      data.mailbox_config = {
        address, sender_name: cleanText(m.sender_name !== undefined ? m.sender_name : c.sender_name, 80).replace(/[<>"\r\n]/g, "").trim(),
        username: ee.cleanEmail(m.username !== undefined ? m.username : c.username) || address,
        smtp_host: host, smtp_port: ee.clampInt(m.smtp_port !== undefined ? m.smtp_port : c.smtp_port, 1, 65535, 465)
      };
      if (m.password) data.mailbox_secret = ee.encryptSecret(String(m.password));
    }
    if (b.outreach) {
      const m = b.outreach, c = s.outreach_config || {};
      const pick = (k, d) => (m[k] !== undefined ? m[k] : (c[k] !== undefined ? c[k] : d));
      const address = ee.cleanEmail(pick("address", ""));
      if (address && !ee.validEmail(address)) return res.status(400).json({ error: "The outreach mailbox address is not a valid email." });
      const platform = await ee.getPlatform();
      const forbidden = await outreach.forbiddenDomains(req.companyId, platform);
      const domain = address.split("@")[1] || "";
      if (address && forbidden.includes(domain)) return res.status(400).json({ error: `${domain} is your main email domain (or protected by AIStaff). Outreach must use a mailbox on a separate domain so your main inbox is never at risk.` });
      const host = (v) => String(v || "").trim().toLowerCase();
      for (const h of [pick("smtp_host", "smtp.hostinger.com"), pick("imap_host", "imap.hostinger.com")]) if (h && !/^[a-z0-9.-]+$/.test(host(h))) return res.status(400).json({ error: "Server names may only contain letters, numbers, dots and dashes." });
      data.outreach_config = {
        address, sender_name: cleanText(pick("sender_name", ""), 80).replace(/[<>"\r\n]/g, "").trim(), username: ee.cleanEmail(pick("username", "")) || address,
        smtp_host: host(pick("smtp_host", "smtp.hostinger.com")), smtp_port: ee.clampInt(pick("smtp_port", 465), 1, 65535, 465),
        imap_host: host(pick("imap_host", "imap.hostinger.com")), imap_port: ee.clampInt(pick("imap_port", 993), 1, 65535, 993),
        daily_limit: ee.clampInt(pick("daily_limit", 1000), 10, 100000, 1000)
      };
      if (m.password) data.outreach_secret = ee.encryptSecret(String(m.password));
    }
    if (b.outreach_footer !== undefined) {
      const f = cleanText(b.outreach_footer, 1500).trim();
      if (f && !/stop/i.test(f)) return res.status(400).json({ error: "The outreach footer must tell people how to opt out (for example: reply STOP)." });
      if (f && !/\{\{\s*source\s*\}\}/i.test(f)) return res.status(400).json({ error: "The outreach footer must say where you found the address: keep {{source}} in it." });
      data.outreach_footer = f || null;
    }
    await prisma.emailEngineSetting.update({ where: { company_id: req.companyId }, data });
    await audit(req, "email_engine.settings", { fields: Object.keys(data) });
    res.json(await overview(req.companyId));
  }));

  r.post("/mailbox/test", asyncRoute(async (req, res) => {
    const s = await ee.getSettings(req.companyId);
    const c = s.mailbox_config || {};
    if (!c.address || !s.mailbox_secret) return res.status(400).json({ error: "Save the mailbox address and password first." });
    let pass = "";
    try { pass = require("../crypto").decryptSecret(s.mailbox_secret); } catch { pass = ""; }
    const sender = { address: c.address, config: c, pass };
    try {
      await ee.transportFor(sender).verify();
      await prisma.emailEngineSetting.update({ where: { company_id: req.companyId }, data: { mailbox_tested_hash: ee.mailboxFingerprint(s), mailbox_tested_at: new Date() } });
      res.json({ ok: true });
    } catch (error) {
      await prisma.emailEngineSetting.update({ where: { company_id: req.companyId }, data: { mailbox_tested_hash: null } });
      const why = ee.classify(error).why;
      res.json({ ok: false, error: String(error?.response || error?.message || error).slice(0, 240), steps: ee.troubleshooting(why, { ...sender, source: "mailbox" }) });
    }
  }));

  /* ---------- contacts ---------- */
  r.get("/contacts", asyncRoute(async (req, res) => {
    const q = String(req.query.q || "").trim().toLowerCase();
    const list = cleanList(req.query.list);
    const page = Math.max(0, Number(req.query.page) || 0);
    const where = { company_id: req.companyId, ...(list ? { lists: { has: list } } : {}),
      ...(q ? { OR: [{ email: { contains: q } }, { name: { contains: q, mode: "insensitive" } }, { organization: { contains: q, mode: "insensitive" } }] } : {}) };
    const [rows, total] = await Promise.all([
      prisma.emailContact.findMany({ where, orderBy: { created_at: "desc" }, skip: page * 50, take: 50 }),
      prisma.emailContact.count({ where })
    ]);
    res.json({ contacts: rows.map((c) => ({ id: c.id, email: c.email, name: c.name, organization: c.organization, lists: c.lists, source: c.source })), total, page });
  }));

  r.post("/contacts/import", asyncRoute(async (req, res) => {
    const { recipients, invalid } = ee.parseRecipients(req.body?.text);
    if (!recipients.length) return res.status(400).json({ error: "No email addresses found. Paste one per line, or rows like: email, name, company." });
    if (recipients.length > MAX_RECIPIENTS) return res.status(400).json({ error: `Up to ${MAX_RECIPIENTS} addresses at a time.` });
    const result = await upsertContacts(req.companyId, recipients, cleanList(req.body?.list), "import");
    await audit(req, "email_engine.contacts_import", { ...result, invalid: invalid.length });
    res.json({ ...result, invalid: invalid.slice(0, 20), invalid_count: invalid.length });
  }));

  r.post("/contacts/import-closer", asyncRoute(async (req, res) => {
    const [profiles, leads] = await Promise.all([
      prisma.contactProfile.findMany({ where: { company_id: req.companyId, email: { not: null } }, select: { email: true, name: true, organization: true } }),
      prisma.lead.findMany({ where: { company_id: req.companyId, email: { not: null } }, select: { email: true, customer_name: true, company_name: true } })
    ]);
    const map = new Map();
    for (const p of profiles) for (const e of String(p.email || "").split(/[,;\s]+/)) if (ee.validEmail(e) && !map.has(ee.cleanEmail(e))) map.set(ee.cleanEmail(e), { email: ee.cleanEmail(e), name: p.name, organization: p.organization });
    for (const l of leads) { const e = ee.cleanEmail(l.email); if (ee.validEmail(e) && !map.has(e)) map.set(e, { email: e, name: l.customer_name, organization: l.company_name }); }
    const result = await upsertContacts(req.companyId, [...map.values()], cleanList(req.body?.list) || "Closer customers", "closer");
    await audit(req, "email_engine.contacts_import_closer", result);
    res.json({ ...result, found: map.size });
  }));

  r.delete("/contacts/:id", asyncRoute(async (req, res) => {
    await prisma.emailContact.deleteMany({ where: { id: req.params.id, company_id: req.companyId } });
    res.json({ ok: true });
  }));

  /* ---------- do-not-email list ---------- */
  r.get("/blocked", asyncRoute(async (req, res) => {
    const rows = await prisma.emailSuppression.findMany({ where: { company_id: req.companyId }, orderBy: { created_at: "desc" }, take: 500 });
    res.json({ blocked: rows.map((b) => ({ id: b.id, email: b.email, reason: b.reason, note: b.note, created_at: b.created_at })) });
  }));
  r.post("/blocked", asyncRoute(async (req, res) => {
    const { recipients } = ee.parseRecipients(req.body?.text || req.body?.email);
    for (const x of recipients) await prisma.emailSuppression.upsert({ where: { company_id_email: { company_id: req.companyId, email: x.email } }, update: {}, create: { company_id: req.companyId, email: x.email, reason: "manual" } });
    await audit(req, "email_engine.block", { count: recipients.length });
    res.json({ ok: true, added: recipients.length });
  }));
  r.delete("/blocked/:id", asyncRoute(async (req, res) => {
    const row = await prisma.emailSuppression.findFirst({ where: { id: req.params.id, company_id: req.companyId } });
    if (row?.reason === "unsubscribed" && !req.body?.confirm) return res.status(400).json({ error: "This person unsubscribed themselves. Only remove them if they asked to receive emails again." });
    await prisma.emailSuppression.deleteMany({ where: { id: req.params.id, company_id: req.companyId } });
    await audit(req, "email_engine.unblock", { email: row?.email });
    res.json({ ok: true });
  }));

  /* ---------- campaigns ---------- */
  r.post("/campaigns", asyncRoute(async (req, res) => {
    const b = req.body || {};
    if (b.kind === "outreach") {
      const name = cleanText(b.name, 120).trim();
      if (!name) return res.status(400).json({ error: "Give the outreach a name." });
      const c = await prisma.emailCampaign.create({ data: { company_id: req.companyId, kind: "outreach", name, subject: "", body_text: "", created_by: req.user?.email || null, pace_count: 10, pace_hours: 24, followups: 1, followup_days: 4, require_review: true, send_window: { weekdays_only: true, from: "08:00", to: "18:00" }, ...outreachFields(b) } });
      await audit(req, "email_engine.outreach_create", { campaign_id: c.id });
      return res.json({ campaign: campaignView(c) });
    }
    const subject = cleanText(b.subject, 250).trim();
    const body = cleanText(b.body_text, 50000);
    if (!subject || !body.trim()) return res.status(400).json({ error: "Write a subject and a message." });
    const c = await prisma.emailCampaign.create({ data: { company_id: req.companyId, name: cleanText(b.name, 120).trim() || subject.slice(0, 120), subject, body_text: body, created_by: req.user?.email || null, ...paceFields(b) } });
    await audit(req, "email_engine.campaign_create", { campaign_id: c.id });
    res.json({ campaign: campaignView(c) });
  }));

  r.get("/campaigns/:id", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    const [problems, sample] = await Promise.all([
      prisma.emailCampaignRecipient.findMany({ where: { campaign_id: c.id, status: { in: ["failed", "skipped"] } }, orderBy: { updated_at: "desc" }, take: 200, select: { email: true, status: true, error: true } }),
      prisma.emailCampaignRecipient.findMany({ where: { campaign_id: c.id }, orderBy: { created_at: "asc" }, take: 20, select: { email: true, name: true, status: true, sent_at: true } })
    ]);
    res.json({ campaign: campaignView(c), problems, sample });
  }));

  r.put("/campaigns/:id", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    const b = req.body || {};
    if (c.status !== "draft") {
      // Pace, sending hours and review can be changed while sending; content cannot.
      const data = { ...paceFields(b) };
      if (c.kind === "outreach" && b.require_review !== undefined) data.require_review = Boolean(b.require_review);
      if (c.kind === "outreach" && b.followups !== undefined) data.followups = ee.clampInt(b.followups, 0, 2, c.followups);
      if (!Object.keys(data).length) return res.status(400).json({ error: "Only a draft can be edited. Pause and stop it, then copy it." });
      const updated = await prisma.emailCampaign.update({ where: { id: c.id }, data });
      await audit(req, "email_engine.campaign_pace", { campaign_id: c.id, ...data });
      return res.json({ campaign: campaignView(updated) });
    }
    if (c.kind === "outreach") {
      const updated = await prisma.emailCampaign.update({ where: { id: c.id }, data: { ...outreachFields(b), ...(b.name !== undefined ? { name: cleanText(b.name, 120).trim() || c.name } : {}) } });
      return res.json({ campaign: campaignView(updated) });
    }
    const data = { ...paceFields(b) };
    if (b.name !== undefined) data.name = cleanText(b.name, 120).trim() || c.name;
    if (b.subject !== undefined) data.subject = cleanText(b.subject, 250).trim() || c.subject;
    if (b.body_text !== undefined && String(b.body_text).trim()) data.body_text = cleanText(b.body_text, 50000);
    const updated = await prisma.emailCampaign.update({ where: { id: c.id }, data });
    res.json({ campaign: campaignView(updated) });
  }));

  r.delete("/campaigns/:id", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    if (c.status !== "draft") return res.status(400).json({ error: "Only drafts can be deleted. Sent campaigns are kept as a record." });
    await prisma.emailCampaign.delete({ where: { id: c.id } });
    await audit(req, "email_engine.campaign_delete", { campaign_id: c.id });
    res.json({ ok: true });
  }));

  r.post("/campaigns/:id/recipients", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    if (c.kind === "outreach") return res.status(400).json({ error: "Outreach uses Add prospects." });
    if (c.status !== "draft") return res.status(400).json({ error: "Recipients can only be chosen while the campaign is a draft." });
    const b = req.body || {};
    let rows = [], invalid = [];
    if (b.source === "paste") {
      ({ recipients: rows, invalid } = ee.parseRecipients(b.text));
      if (b.save_list) await upsertContacts(req.companyId, rows, cleanList(b.save_list), "import");
    } else {
      const list = cleanList(b.list);
      const contacts = await prisma.emailContact.findMany({ where: { company_id: req.companyId, ...(b.source === "list" && list ? { lists: { has: list } } : {}) }, select: { email: true, name: true } });
      rows = contacts.map((x) => ({ email: x.email, name: x.name }));
    }
    if (!rows.length) return res.status(400).json({ error: "No valid email addresses were found." });
    if (rows.length > MAX_RECIPIENTS) return res.status(400).json({ error: `Up to ${MAX_RECIPIENTS} recipients per campaign.` });
    const blocked = new Set((await prisma.emailSuppression.findMany({ where: { company_id: req.companyId }, select: { email: true } })).map((x) => x.email));
    await prisma.emailCampaignRecipient.deleteMany({ where: { campaign_id: c.id } });
    const data = rows.map((x) => ({ campaign_id: c.id, company_id: req.companyId, email: x.email, name: x.name || null, status: blocked.has(x.email) ? "skipped" : "pending", error: blocked.has(x.email) ? "On the do-not-email list" : null }));
    for (let i = 0; i < data.length; i += 1000) await prisma.emailCampaignRecipient.createMany({ data: data.slice(i, i + 1000), skipDuplicates: true });
    await prisma.emailCampaign.update({ where: { id: c.id }, data: { total: data.length } });
    const updated = await ee.refreshCounts(c.id);
    res.json({ campaign: campaignView(updated), will_send: data.filter((x) => x.status === "pending").length, blocked: data.filter((x) => x.status === "skipped").length, invalid: invalid.slice(0, 20), invalid_count: invalid.length });
  }));

  r.post("/campaigns/:id/test", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    if (c.kind === "outreach") return res.status(400).json({ error: "For outreach, use Send me this draft on an email in the review list." });
    const settings = await ee.getSettings(req.companyId);
    const to = ee.cleanEmail(req.body?.to || settings.test_address || req.user?.email);
    if (!ee.validEmail(to)) return res.status(400).json({ error: "Enter the address that should receive the test." });
    const sender = await ee.resolveSender(req.companyId, settings);
    if (!sender.ok) return res.status(400).json({ error: sender.problem });
    const { mail } = ee.buildMail({ campaign: c, recipient: { email: to, name: req.body?.name || "" }, sender, settings, companyId: req.companyId, test: true });
    try {
      await ee.sendOne({ sender, mail, to });
      if (to !== settings.test_address) await prisma.emailEngineSetting.update({ where: { company_id: req.companyId }, data: { test_address: to } });
      res.json({ ok: true, to, from: sender.address });
    } catch (error) {
      const why = ee.classify(error).why;
      res.status(400).json({ error: `The test could not be sent: ${String(error?.response || error?.message || error).slice(0, 240)}`, steps: ee.troubleshooting(why, sender) });
    }
  }));

  r.post("/campaigns/:id/send", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    if (c.status !== "draft") return res.status(400).json({ error: "This campaign was already started." });
    if (c.kind === "outreach") {
      const [settings, platform] = await Promise.all([ee.getSettings(req.companyId), ee.getPlatform()]);
      if (!platform.outreach_enabled) return res.status(400).json({ error: "Outreach is switched off by AIStaff for now." });
      if (String(c.brief || "").trim().length < 30) return res.status(400).json({ error: "Write what you offer and why it helps (at least a few sentences) — the AI uses it for every email." });
      if (!String(c.sender_person?.name || "").trim()) return res.status(400).json({ error: "Enter the name of the person sending (one-to-one emails come from a person)." });
      if (!c.pia_done_at || !outreach.piaComplete(c.pia)) return res.status(400).json({ error: "Complete the privacy check first." });
      const sender = await outreach.resolveOutreachSender(req.companyId, settings, platform);
      if (!sender.ok) return res.status(400).json({ error: sender.problem });
      const ready = await prisma.emailCampaignRecipient.count({ where: { campaign_id: c.id, status: "draft_needed" } });
      if (!ready) return res.status(400).json({ error: "Add prospects first (held personal addresses do not count until you allow them)." });
      const updated = await prisma.emailCampaign.update({ where: { id: c.id }, data: { status: "sending", started_at: new Date(), from_address: sender.address, pause_reason: null, alerted_at: null } });
      await audit(req, "email_engine.outreach_start", { campaign_id: c.id, prospects: ready, from: sender.address });
      return res.json({ campaign: campaignView(updated) });
    }
    const pending = await prisma.emailCampaignRecipient.count({ where: { campaign_id: c.id, status: "pending" } });
    if (!pending) return res.status(400).json({ error: "Choose the recipients first." });
    const sender = await ee.resolveSender(req.companyId);
    if (!sender.ok) return res.status(400).json({ error: sender.problem });
    const updated = await prisma.emailCampaign.update({ where: { id: c.id }, data: { status: "sending", started_at: new Date(), from_address: sender.address, pause_reason: null, alerted_at: null } });
    await audit(req, "email_engine.campaign_send", { campaign_id: c.id, recipients: pending, from: sender.address });
    res.json({ campaign: campaignView(updated) });
  }));

  r.post("/campaigns/:id/pause", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    if (c.status !== "sending") return res.status(400).json({ error: "Only a sending campaign can be paused." });
    const updated = await prisma.emailCampaign.update({ where: { id: c.id }, data: { status: "paused", pause_reason: "manual" } });
    await audit(req, "email_engine.campaign_pause", { campaign_id: c.id });
    res.json({ campaign: campaignView(updated) });
  }));

  r.post("/campaigns/:id/resume", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    if (c.status !== "paused") return res.status(400).json({ error: "Only a paused campaign can be resumed." });
    const sender = c.kind === "outreach" ? await outreach.resolveOutreachSender(req.companyId, await ee.getSettings(req.companyId), await ee.getPlatform()) : await ee.resolveSender(req.companyId);
    if (!sender.ok) return res.status(400).json({ error: sender.problem });
    const updated = await prisma.emailCampaign.update({ where: { id: c.id }, data: { status: "sending", pause_reason: null, alerted_at: null, from_address: sender.address } });
    await audit(req, "email_engine.campaign_resume", { campaign_id: c.id });
    res.json({ campaign: campaignView(updated) });
  }));

  r.post("/campaigns/:id/cancel", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    if (!["sending", "paused"].includes(c.status)) return res.status(400).json({ error: "Only a sending or paused campaign can be stopped." });
    await prisma.emailCampaignRecipient.updateMany({ where: { campaign_id: c.id, status: { in: ["pending", "draft_needed", "drafting", "review", "waiting", "held"] } }, data: { status: "skipped", error: "Campaign stopped", next_step_at: null } });
    await ee.refreshCounts(c.id);
    const updated = await prisma.emailCampaign.update({ where: { id: c.id }, data: { status: "cancelled", finished_at: new Date() } });
    await audit(req, "email_engine.campaign_cancel", { campaign_id: c.id });
    res.json({ campaign: campaignView(updated) });
  }));

  r.post("/campaigns/:id/retry-failed", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    const blocked = (await prisma.emailSuppression.findMany({ where: { company_id: req.companyId }, select: { email: true } })).map((x) => x.email);
    const result = await prisma.emailCampaignRecipient.updateMany({ where: { campaign_id: c.id, status: "failed", email: { notIn: blocked }, ...(c.kind === "outreach" ? { outcome: null, draft_body: { not: null } } : {}) }, data: { status: "pending", attempts: 0, next_try_at: null } });
    if (!result.count) return res.status(400).json({ error: "Nothing to retry (failed addresses that bounced are on the do-not-email list)." });
    const updated = await prisma.emailCampaign.update({ where: { id: c.id }, data: { status: c.status === "draft" ? "draft" : "sending", finished_at: null, pause_reason: null, alerted_at: null } });
    await ee.refreshCounts(c.id);
    await audit(req, "email_engine.campaign_retry", { campaign_id: c.id, count: result.count });
    res.json({ campaign: campaignView(updated), retried: result.count });
  }));

  /* ---------- outreach ---------- */
  r.post("/outreach/test", asyncRoute(async (req, res) => res.json(await outreach.testOutreachMailbox(req.companyId))));

  r.post("/campaigns/:id/prospects", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    if (c.kind !== "outreach") return res.status(400).json({ error: "Prospects are only for outreach." });
    if (["done", "cancelled"].includes(c.status)) return res.status(400).json({ error: "This outreach is finished. Copy it to start a new one." });
    const { rows, invalid } = outreach.parseProspects(req.body?.text);
    if (!rows.length) return res.status(400).json({ error: "No valid rows. One per line: email, company, contact name, where you found it, why they fit." });
    if (rows.length > 2000) return res.status(400).json({ error: "Up to 2,000 prospects at a time." });
    const emails = rows.map((x) => x.email);
    const [blocked, existing, recent] = await Promise.all([
      prisma.emailSuppression.findMany({ where: { company_id: req.companyId, email: { in: emails } }, select: { email: true, reason: true } }),
      prisma.emailCampaignRecipient.findMany({ where: { campaign_id: c.id, email: { in: emails } }, select: { email: true } }),
      prisma.emailCampaignRecipient.findMany({ where: { company_id: req.companyId, email: { in: emails }, campaign_id: { not: c.id }, campaign: { kind: "outreach" }, OR: [{ sent_at: { gte: new Date(Date.now() - 180 * 86400000) } }, { status: { in: ["draft_needed", "review", "pending", "waiting", "held"] } }] }, select: { email: true } })
    ]);
    const blockedSet = new Map(blocked.map((x) => [x.email, x.reason]));
    const existingSet = new Set(existing.map((x) => x.email));
    const recentSet = new Set(recent.map((x) => x.email));
    const counts = { added: 0, held: 0, blocked: 0, already: 0, recently_contacted: 0, missing_source: 0 };
    const data = [];
    for (const x of rows) {
      if (existingSet.has(x.email)) { counts.already++; continue; }
      let status = x.address_type === "role" ? "draft_needed" : "held", error = null;
      if (status === "held") { counts.held++; error = x.address_type === "freemail" ? "Free email address (e.g. Gmail): only if the company publishes it for business inquiries" : "Personal address: only if the company publishes it for business inquiries"; }
      if (!x.source_note) { status = "held"; error = "Missing where you found this address"; counts.missing_source++; }
      if (blockedSet.has(x.email)) { status = "skipped"; error = `On the do-not-email list (${blockedSet.get(x.email)})`; counts.blocked++; }
      else if (recentSet.has(x.email)) { status = "skipped"; error = "Already contacted by outreach in the last 180 days"; counts.recently_contacted++; }
      if (status === "draft_needed") counts.added++;
      data.push({ campaign_id: c.id, company_id: req.companyId, email: x.email, name: x.name, organization: x.organization, source_note: x.source_note, reason_note: x.reason_note, address_type: x.address_type, status, error,
        events: [{ at: new Date().toISOString(), type: "added", by: req.user?.email || null, source: x.source_note, reason: x.reason_note }] });
    }
    if (data.length) await prisma.emailCampaignRecipient.createMany({ data, skipDuplicates: true });
    const total = await prisma.emailCampaignRecipient.count({ where: { campaign_id: c.id } });
    await prisma.emailCampaign.update({ where: { id: c.id }, data: { total } });
    await ee.refreshCounts(c.id);
    await audit(req, "email_engine.outreach_prospects", { campaign_id: c.id, ...counts, invalid: invalid.length });
    res.json({ ...counts, invalid: invalid.slice(0, 20), invalid_count: invalid.length });
  }));

  r.get("/campaigns/:id/prospects", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    const status = String(req.query.status || "");
    const rows = await prisma.emailCampaignRecipient.findMany({ where: { campaign_id: c.id, ...(status ? { status } : {}) }, orderBy: [{ updated_at: "desc" }], take: 300 });
    res.json({ prospects: rows.map((x) => ({ id: x.id, email: x.email, name: x.name, organization: x.organization, address_type: x.address_type, source_note: x.source_note, reason_note: x.reason_note,
      status: x.status, step: x.step, error: x.error, draft_error: x.draft_error, draft_subject: x.draft_subject, draft_body: x.draft_body, outcome: x.outcome, reply_snippet: x.reply_snippet, replied_at: x.replied_at, sent_at: x.sent_at, events: x.events })) });
  }));

  r.post("/campaigns/:id/allow-held", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    if (req.body?.confirm !== true) return res.status(400).json({ error: "Confirm that the company published these addresses for business inquiries." });
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : null;
    const rows = await prisma.emailCampaignRecipient.findMany({ where: { campaign_id: c.id, status: "held", ...(ids ? { id: { in: ids } } : {}) } });
    let allowed = 0, stillMissing = 0;
    for (const x of rows) {
      if (!x.source_note) { stillMissing++; continue; }
      await prisma.emailCampaignRecipient.update({ where: { id: x.id }, data: { status: "draft_needed", error: null, events: outreach.eventsWith(x, { type: "allowed", by: req.user?.email || null, note: "Confirmed published for business inquiries" }) } });
      allowed++;
    }
    if (allowed && c.status === "done") await prisma.emailCampaign.update({ where: { id: c.id }, data: { status: "sending", finished_at: null } });
    await audit(req, "email_engine.outreach_allow_held", { campaign_id: c.id, allowed });
    res.json({ allowed, still_missing_source: stillMissing });
  }));

  r.post("/campaigns/:id/review/:rid", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    const x = await prisma.emailCampaignRecipient.findFirst({ where: { id: req.params.rid, campaign_id: c.id } });
    if (!x) return res.status(404).json({ error: "Not found." });
    const action = String(req.body?.action || "");
    const by = req.user?.email || null;
    if (action === "approve") {
      if (x.status !== "review") return res.status(400).json({ error: "This email is not waiting for review." });
      const subject = req.body.subject !== undefined ? cleanText(req.body.subject, 200).trim() : x.draft_subject;
      const body = req.body.body !== undefined ? cleanText(req.body.body, 6000).trim() : x.draft_body;
      if (!String(body || "").trim() || (x.step === 0 && !String(subject || "").trim())) return res.status(400).json({ error: "Write the subject and message first." });
      const edited = subject !== x.draft_subject || body !== x.draft_body;
      await prisma.emailCampaignRecipient.update({ where: { id: x.id }, data: { draft_subject: subject, draft_body: body, draft_error: null, status: "pending", events: outreach.eventsWith(x, { type: "approved", by, edited, step: x.step }) } });
    } else if (action === "reject") {
      await prisma.emailCampaignRecipient.update({ where: { id: x.id }, data: { status: "skipped", error: "Not sent: rejected in review", next_step_at: null, events: outreach.eventsWith(x, { type: "rejected", by, step: x.step }) } });
    } else if (action === "redraft") {
      if (!["review", "pending"].includes(x.status)) return res.status(400).json({ error: "Only a draft that is not sent yet can be written again." });
      await prisma.emailCampaignRecipient.update({ where: { id: x.id }, data: { status: "draft_needed", draft_error: null, attempts: 0, next_try_at: null, ...(req.body?.note ? { reason_note: cleanText(req.body.note, 1000) } : {}) } });
    } else if (action === "test") {
      if (!String(x.draft_body || "").trim()) return res.status(400).json({ error: "There is no draft yet." });
      const [settings, platform] = await Promise.all([ee.getSettings(req.companyId), ee.getPlatform()]);
      const sender = await outreach.resolveOutreachSender(req.companyId, settings, platform);
      if (!sender.ok) return res.status(400).json({ error: sender.problem });
      const to = ee.cleanEmail(req.body?.to || settings.test_address || req.user?.email);
      if (!ee.validEmail(to)) return res.status(400).json({ error: "Enter a test address." });
      const company = await prisma.company.findUnique({ where: { id: req.companyId }, select: { name: true } });
      const draft = { ...x, draft_subject: req.body.subject !== undefined ? req.body.subject : x.draft_subject, draft_body: req.body.body !== undefined ? req.body.body : x.draft_body, message_ids: [] };
      const built = outreach.buildOutreachMail({ campaign: c, recipient: draft, sender, settings, companyName: company?.name, companyId: req.companyId });
      built.mail.to = to; built.mail.subject = `[TEST for ${x.email}] ${built.mail.subject}`; delete built.mail.inReplyTo; delete built.mail.references;
      try { await ee.sendOne({ sender, mail: built.mail, to }); } catch (error) { return res.status(400).json({ error: `Test not sent: ${String(error?.response || error?.message).slice(0, 200)}` }); }
      return res.json({ ok: true, to });
    } else if (action === "opted_out" || action === "replied") {
      await prisma.emailCampaignRecipient.update({ where: { id: x.id }, data: { outcome: action, next_step_at: null, status: ["waiting", "pending", "review", "draft_needed"].includes(x.status) ? "sent" : x.status, events: outreach.eventsWith(x, { type: `marked_${action}`, by }) } });
      if (action === "opted_out") await outreach.suppress(req.companyId, x.email, "unsubscribed", `Marked by ${by}`);
    } else return res.status(400).json({ error: "Unknown action." });
    await ee.refreshCounts(c.id);
    await audit(req, `email_engine.outreach_${action}`, { campaign_id: c.id, email: x.email });
    res.json({ ok: true });
  }));

  r.put("/campaigns/:id/pia", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    if (c.kind !== "outreach") return res.status(400).json({ error: "The privacy check is for outreach." });
    const b = req.body || {};
    const pia = {};
    for (const k of ["purpose", "data_used", "source_of_data", "lawful_basis", "opt_out", "security"]) pia[k] = cleanText(b[k], 2000).trim();
    pia.retention_days = ee.clampInt(b.retention_days, 1, 3650, 180);
    pia.confirms = Object.fromEntries(Object.keys(outreach.PIA_CONFIRMS).map((k) => [k, b.confirms?.[k] === true]));
    if (!outreach.piaComplete(pia)) return res.status(400).json({ error: "Answer every question (a sentence each) and tick all three confirmations." });
    const updated = await prisma.emailCampaign.update({ where: { id: c.id }, data: { pia, pia_done_at: new Date(), pia_by: req.user?.email || null } });
    await audit(req, "email_engine.outreach_pia", { campaign_id: c.id });
    res.json({ campaign: campaignView(updated) });
  }));

  r.get("/campaigns/:id/record.csv", asyncRoute(async (req, res) => {
    const c = await loadCampaign(req, res); if (!c) return;
    const csv = await outreach.recordCsv(c);
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", `attachment; filename="outreach-record-${c.id.slice(0, 8)}.csv"`);
    res.send(`\ufeff${csv}`);
  }));

  return r;
}

function buildPlatformRouter({ requireAuth }) {
  const r = express.Router();
  r.use(express.json({ limit: "64kb" }));
  r.use(requireAuth, requirePermission("emailengine.manage"));

  async function view() {
    const [platform, campaigns] = await Promise.all([
      ee.getPlatform(),
      prisma.emailCampaign.findMany({ where: { OR: [{ status: { in: ["sending", "paused"] } }, { created_at: { gte: new Date(Date.now() - 14 * 86400000) } }], NOT: { status: "draft" } }, orderBy: { created_at: "desc" }, take: 50, include: { company: { select: { name: true } } } })
    ]);
    return { platform, campaigns: campaigns.map((c) => ({ ...campaignView(c), company: c.company?.name })) };
  }

  r.get("/", asyncRoute(async (req, res) => res.json(await view())));
  r.put("/", asyncRoute(async (req, res) => {
    const b = req.body || {};
    const p = await ee.getPlatform();
    await prisma.emailEnginePlatform.update({ where: { id: "global" }, data: {
      paused_all: b.paused_all !== undefined ? Boolean(b.paused_all) : p.paused_all,
      pause_note: b.pause_note !== undefined ? cleanText(b.pause_note, 300) || null : p.pause_note,
      max_per_minute: b.max_per_minute !== undefined ? ee.clampInt(b.max_per_minute, 1, 600, p.max_per_minute) : p.max_per_minute,
      max_per_day: b.max_per_day !== undefined ? ee.clampInt(b.max_per_day, 10, 1000000, p.max_per_day) : p.max_per_day,
      outreach_enabled: b.outreach_enabled !== undefined ? Boolean(b.outreach_enabled) : p.outreach_enabled,
      outreach_max_per_day: b.outreach_max_per_day !== undefined ? ee.clampInt(b.outreach_max_per_day, 1, 1000, p.outreach_max_per_day) : p.outreach_max_per_day,
      protected_domains: b.protected_domains !== undefined ? String(b.protected_domains || "").split(/[\s,;]+/).map((d) => d.trim().toLowerCase()).filter((d) => /^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)).slice(0, 50) : p.protected_domains,
      updated_by: req.user?.email || null
    } });
    console.log("[email-engine] platform settings changed by %s: %j", req.user?.email, b);
    res.json(await view());
  }));
  r.post("/campaigns/:id/pause", asyncRoute(async (req, res) => {
    await prisma.emailCampaign.updateMany({ where: { id: req.params.id, status: "sending" }, data: { status: "paused", pause_reason: "platform" } });
    console.log("[email-engine] campaign %s paused by platform user %s", req.params.id, req.user?.email);
    res.json(await view());
  }));
  return r;
}

/* ---------- public unsubscribe page ---------- */
function page(title, body) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${title}</title>
<style>body{margin:0;background:#f5f6f8;font-family:system-ui,-apple-system,Segoe UI,Arial,sans-serif;color:#1a2233}.card{max-width:460px;margin:12vh auto 0;background:#fff;border:1px solid #e2e8f0;border-radius:14px;padding:28px}
h1{font-size:20px;margin:0 0 8px}p{line-height:1.5;color:#475569}button{font:inherit;font-weight:600;background:#1a2233;color:#fff;border:0;border-radius:10px;padding:12px 18px;cursor:pointer}@media(max-width:520px){.card{margin:16px}}</style></head><body><div class="card">${body}</div></body></html>`;
}
function esc(v) { return String(v == null ? "" : v).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;"); }

function buildPublicRouter() {
  const r = express.Router();
  r.use(express.urlencoded({ extended: false, limit: "4kb" }));
  async function lookup(token) {
    const data = ee.readUnsubscribeToken(token);
    if (!data) return null;
    const company = await prisma.company.findUnique({ where: { id: data.companyId }, select: { id: true, name: true } });
    return company ? { ...data, company } : null;
  }
  r.get("/:token", asyncRoute(async (req, res) => {
    const d = await lookup(req.params.token);
    if (!d) return res.status(404).send(page("Link not valid", "<h1>This link is not valid</h1><p>Please reply to the email instead.</p>"));
    const already = await prisma.emailSuppression.findUnique({ where: { company_id_email: { company_id: d.companyId, email: d.email } } });
    if (already?.reason === "unsubscribed") return res.send(page("Unsubscribed", `<h1>You are unsubscribed</h1><p><b>${esc(d.email)}</b> will not receive these emails from ${esc(d.company.name)} anymore.</p>`));
    res.send(page("Unsubscribe", `<h1>Unsubscribe?</h1><p>Stop receiving these emails from <b>${esc(d.company.name)}</b> at <b>${esc(d.email)}</b>.</p><form method="post"><button type="submit">Unsubscribe</button></form><p style="font-size:13px">Messages about your own requests and services may still be sent.</p>`));
  }));
  r.post("/:token", asyncRoute(async (req, res) => {
    const d = await lookup(req.params.token);
    if (!d) return res.status(404).send(page("Link not valid", "<h1>This link is not valid</h1><p>Please reply to the email instead.</p>"));
    await prisma.emailSuppression.upsert({ where: { company_id_email: { company_id: d.companyId, email: d.email } }, update: { reason: "unsubscribed", note: "Clicked unsubscribe" }, create: { company_id: d.companyId, email: d.email, reason: "unsubscribed", note: "Clicked unsubscribe" } });
    console.log("[email-engine] unsubscribed company=%s email=%s", d.companyId, d.email);
    res.send(page("Unsubscribed", `<h1>You are unsubscribed</h1><p><b>${esc(d.email)}</b> will not receive these emails from ${esc(d.company.name)} anymore.</p>`));
  }));
  return r;
}

module.exports = { buildRouter, buildPlatformRouter, buildPublicRouter };
