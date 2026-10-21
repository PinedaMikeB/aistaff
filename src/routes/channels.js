/**
 * Settings > Channels API (added 2026-10-20). Tenant admins only.
 *   GET  /api/channels                 all four channel cards with status
 *   PUT  /api/channels/:key            { enabled?, ai_replies?, config?, password? }
 *   POST /api/channels/email/test      log in to IMAP + SMTP with the saved settings
 * Facebook Messenger: this API only stores the pause / AI-replies switches. The Page
 * connection itself stays in Settings > Facebook Page Connection (Meta App Review flow).
 */
const express = require("express");
const { prisma } = require("../db");
const emailChannel = require("../email-channel");

const KEYS = ["facebook_messenger", "email", "website_chat", "mobile_phone"];
const LATER = new Set(["mobile_phone"]);

const asyncRoute = (handler) => (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);

function requireTenantAdmin(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();
  if (!["admin", "account_admin", "owner"].includes(role) && !(req.user?.platform_role && req.assistSessionId)) {
    return res.status(403).json({ error: "Only a tenant administrator can change channels." });
  }
  next();
}

function audit(req, action, metadata) {
  return prisma.tenantAuditLog.create({ data: {
    company_id: req.companyId, actor_id: req.user?.id || null, actor_email: req.user?.email || null,
    action, target_type: "channel", target_id: metadata?.channel || null, metadata
  } }).catch(() => {});
}

function alertEmails(settings) {
  const list = Array.isArray(settings?.alert_contacts) ? settings.alert_contacts.map((c) => c?.email) : [];
  return [...new Set([...list, ...String(settings?.notify_email || "").split(/[,;\s]+/)].map((e) => String(e || "").trim().toLowerCase()).filter((e) => e.includes("@")))];
}

function stateOf(row, extra = {}) {
  if (extra.later) return "later";
  if (!row) return extra.defaultState || "off";
  if (!row.enabled) return Object.keys(row.config || {}).length || extra.connected ? "paused" : "off";
  if (row.last_error && (!row.last_ok_at || new Date(row.last_error_at) > new Date(row.last_ok_at))) return "problem";
  return "connected";
}

async function describe(companyId) {
  const [rows, pages, settings, company] = await Promise.all([
    prisma.tenantChannel.findMany({ where: { company_id: companyId } }),
    prisma.facebookPage.findMany({ where: { company_id: companyId }, orderBy: { updated_at: "desc" }, select: { page_name: true, status: true } }),
    prisma.companySetting.findUnique({ where: { company_id: companyId } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } })
  ]);
  const byKey = Object.fromEntries(rows.map((r) => [r.channel_key, r]));
  const page = pages.find((p) => p.status === "active") || null;

  const fbRow = byKey.facebook_messenger;
  const facebook = {
    key: "facebook_messenger",
    enabled: fbRow ? fbRow.enabled : Boolean(page),
    ai_replies: fbRow ? fbRow.ai_replies : true,
    state: !page ? "needs_setup" : (fbRow && !fbRow.enabled ? "paused" : "connected"),
    page_name: page?.page_name || null
  };

  const er = byKey.email;
  const config = er?.config || {};
  const tested = emailChannel.isTested(er);
  const email = {
    key: "email",
    enabled: Boolean(er?.enabled),
    ai_replies: er ? er.ai_replies : true,
    state: !er || !config.address ? "off" : (!tested ? "needs_setup" : stateOf(er)),
    config: {
      provider: config.provider || "hostinger", address: config.address || "", sender_name: config.sender_name || company?.name || "",
      username: config.username || "", imap_host: config.imap_host || emailChannel.PROVIDERS.hostinger.imap_host,
      imap_port: config.imap_port || 993, smtp_host: config.smtp_host || emailChannel.PROVIDERS.hostinger.smtp_host,
      smtp_port: config.smtp_port || 465, signature: config.signature || ""
    },
    has_password: Boolean(er?.secret_encrypted),
    tested,
    last_tested_at: er?.last_tested_at || null,
    last_ok_at: er?.last_ok_at || null,
    last_error: er?.last_error || null,
    last_error_at: er?.last_error_at || null,
    reading_since: config.poll?.started_at || null
  };
  const later = (key) => ({ key, enabled: false, ai_replies: byKey[key] ? byKey[key].ai_replies : true, state: "later" });
  const wr = byKey.website_chat;
  const wc = wr?.config || {};
  const websiteChat = {
    key: "website_chat",
    enabled: Boolean(wr?.enabled),
    ai_replies: wr ? wr.ai_replies : true,
    state: wr?.enabled ? "connected" : (wc.public_key ? "paused" : "off"),
    public_key: wc.public_key || null,
    allowed_origins: Array.isArray(wc.allowed_origins) ? wc.allowed_origins : [],
    greeting: wc.greeting || "",
    color: wc.color || "#1d4ed8",
    embed_src: `${String(process.env.PUBLIC_APP_URL || "https://aistaff.click").replace(/\/$/, "")}/embed/closer-widget.js`
  };
  return {
    company_name: company?.name || "",
    alert_emails: alertEmails(settings),
    providers: emailChannel.PROVIDERS,
    channels: [facebook, email, websiteChat, later("mobile_phone")].map((ch) => ({ ...ch, instructions: String(byKey[ch.key]?.config?.instructions || ""), reply_style: require("../reply-style").STYLES.includes(byKey[ch.key]?.config?.reply_style) ? byKey[ch.key].config.reply_style : require("../reply-style").defaultStyle(ch.key) }))
  };
}

function buildRouter({ requireAuth }) {
  const router = express.Router();
  router.use(requireAuth, requireTenantAdmin);

  router.get("/", asyncRoute(async (req, res) => res.json(await describe(req.companyId))));

  router.post("/email/test", asyncRoute(async (req, res) => {
    const row = await emailChannel.getEmailChannel(req.companyId);
    if (!row) return res.status(400).json({ error: "Save the email settings first." });
    const result = await emailChannel.testEmailChannel(row);
    const now = new Date();
    await prisma.tenantChannel.update({ where: { id: row.id }, data: result.ok
      ? { tested_fingerprint: emailChannel.fingerprint(row), last_tested_at: now, last_ok_at: now, last_error: null }
      : { tested_fingerprint: null, last_tested_at: now, last_error: result.error, last_error_at: now } });
    await audit(req, "channel.email.test", { channel: "email", ok: result.ok, error: result.error || null });
    res.json({ ...result, channel: (await describe(req.companyId)).channels.find((c) => c.key === "email") });
  }));

  router.put("/:key", asyncRoute(async (req, res) => {
    const key = req.params.key;
    if (!KEYS.includes(key)) return res.status(404).json({ error: "Unknown channel." });
    if (LATER.has(key) && req.body?.enabled) return res.status(400).json({ error: "This channel is not available yet — it will be set up later." });
    const body = req.body || {};
    const existing = await prisma.tenantChannel.findUnique({ where: { company_id_channel_key: { company_id: req.companyId, channel_key: key } } });
    const data = {};
    if (typeof body.ai_replies === "boolean") data.ai_replies = body.ai_replies;

    if (key === "facebook_messenger" && typeof body.enabled === "boolean") data.enabled = body.enabled;

    if (key === "email") {
      const [settings, company] = await Promise.all([
        prisma.companySetting.findUnique({ where: { company_id: req.companyId } }),
        prisma.company.findUnique({ where: { id: req.companyId }, select: { name: true } })
      ]);
      let config = existing?.config || {};
      if (body.config && typeof body.config === "object") {
        config = emailChannel.normalizeConfig(body.config, config, company?.name || "");
        const problem = emailChannel.validateConfig(config);
        if (problem) return res.status(400).json({ error: problem });
        if (alertEmails(settings).includes(config.address)) {
          return res.status(400).json({ error: `${config.address} is listed in Settings > General > Who gets alerts. A customer inbox must not receive staff alerts (it would read them as customer mail). Remove it there first.` });
        }
        const clash = await prisma.tenantChannel.findFirst({ where: { channel_key: "email", company_id: { not: req.companyId }, config: { path: ["address"], equals: config.address } } });
        if (clash) return res.status(400).json({ error: "This inbox is already connected to another AIStaff account." });
        data.config = config;
      }
      if (typeof body.password === "string" && body.password.length) {
        if (body.password.length > 300) return res.status(400).json({ error: "Password is too long." });
        data.secret_encrypted = emailChannel.encryptSecret(body.password);
      }
      if (typeof body.enabled === "boolean") {
        if (body.enabled) {
          const candidate = { ...existing, ...data, config: data.config || config };
          if (!candidate.config?.address) return res.status(400).json({ error: "Save the email settings first." });
          if (!emailChannel.isTested(candidate)) return res.status(400).json({ error: "Run Test connection first (after any change to the address, servers or password)." });
          // Start reading from NOW: older mail in the inbox is never answered.
          const { poll, problem_alerted_at, ...rest } = candidate.config;
          data.config = rest;
        }
        data.enabled = body.enabled;
      }
      // Any change to address/servers/password invalidates the last test; the channel pauses until re-tested.
      const after = { ...existing, ...data, config: data.config || config };
      if (existing?.enabled && !emailChannel.isTested(after) && data.enabled !== false) {
        data.enabled = false;
      }
    }

    if (key === "website_chat") {
      let config = { ...(existing?.config || {}) };
      if (body.widget && typeof body.widget === "object") {
        const raw = Array.isArray(body.widget.allowed_origins) ? body.widget.allowed_origins : String(body.widget.allowed_origins || "").split(/[\s,]+/);
        const origins = [];
        for (const item of raw.map((v) => String(v || "").trim()).filter(Boolean)) {
          let url;
          try { url = new URL(/^https?:\/\//i.test(item) ? item : `https://${item}`); } catch { return res.status(400).json({ error: `Not a website address: ${item}` }); }
          if (url.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(url.hostname)) return res.status(400).json({ error: `Use https:// for ${item}` });
          origins.push(url.origin.toLowerCase());
        }
        config.allowed_origins = [...new Set(origins)].slice(0, 10);
        if (typeof body.widget.greeting === "string") config.greeting = body.widget.greeting.trim().slice(0, 300);
        if (/^#[0-9a-fA-F]{6}$/.test(String(body.widget.color || ""))) config.color = body.widget.color;
        if (!config.public_key) config.public_key = `w_${require("crypto").randomBytes(18).toString("base64url")}`;
        data.config = config;
      }
      if (typeof body.enabled === "boolean") {
        const cfg = data.config || config;
        if (body.enabled && !(Array.isArray(cfg.allowed_origins) && cfg.allowed_origins.length && cfg.public_key)) {
          return res.status(400).json({ error: "Add your website address and save first." });
        }
        data.enabled = body.enabled;
      }
    }

    // Reply style (formal / casual) per channel: wording only, never pauses a channel.
    if (typeof body.instructions === "string") {
      if (body.instructions.length > 2000) return res.status(400).json({ error: "Channel instructions are too long (2,000 characters max)." });
      data.config = { ...(data.config || existing?.config || {}), instructions: body.instructions.trim() };
    }
    if (require("../reply-style").STYLES.includes(body.reply_style)) {
      data.config = { ...(data.config || existing?.config || {}), reply_style: body.reply_style };
    }

    const row = await prisma.tenantChannel.upsert({
      where: { company_id_channel_key: { company_id: req.companyId, channel_key: key } },
      create: { company_id: req.companyId, channel_key: key, enabled: key === "facebook_messenger" ? (data.enabled ?? true) : Boolean(data.enabled), ai_replies: data.ai_replies ?? true, config: data.config || {}, secret_encrypted: data.secret_encrypted || null },
      update: data
    });
    await audit(req, "channel.update", { channel: key, enabled: row.enabled, ai_replies: row.ai_replies, changed: Object.keys(data).filter((k) => k !== "secret_encrypted").concat(data.secret_encrypted ? ["password"] : []) });
    res.json(await describe(req.companyId));
  }));

  router.use((error, req, res, next) => {
    console.error("[channels] %s", error.stack || error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Channel request failed." });
  });
  return router;
}

module.exports = { buildRouter, describe };
