"use strict";

/**
 * Phone Lines (Pitch routers) — added 2026-10-21.
 *
 * DUAL MODE: everything here is done from panels, never from .env or SSH.
 *   AIStaff staff:  Platform > Phone Lines  (add router, assign to a tenant,
 *                   get the handoff kit with a one-time setup code)
 *   Tenant:         Settings > Channels > Mobile Phone  (enter the setup code,
 *                   plug in, check connection, personalise Pitch)
 *
 * NOT YET CONNECTED TO PITCH. Pitch still answers from its own server settings
 * (PITCH_COMPANY_ID). These records are what src/pitch/tenant.js will read
 * (by auth_username) once that step is switched on. Nothing here places or
 * answers calls.
 */

const crypto = require("crypto");
const net = require("net");
const { execFile } = require("child_process");
const express = require("express");
const { prisma } = require("../db");
const { encryptSecret, decryptSecret } = require("../crypto");
const { requirePermission } = require("../platform-roles");

const STATUSES = ["in_stock", "assigned", "active", "suspended", "returned"];
const CODE_DAYS = 30;
// No 0/O, 1/I/L — codes are read aloud and typed from paper.
const CODE_CHARS = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

// Voices a tenant may pick. Platform-wide list (AIStaff decides what is approved).
const APPROVED_VOICES = [
  { id: "zonos1110_22050_epoch180", label: "Taglish voice — standard (current Pitch voice)" }
];

const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function randomFrom(chars, n) {
  const bytes = crypto.randomBytes(n);
  let out = "";
  for (let i = 0; i < n; i += 1) out += chars[bytes[i] % chars.length];
  return out;
}
function newSetupCode() { return `AIS-${randomFrom(CODE_CHARS, 4)}-${randomFrom(CODE_CHARS, 4)}`; }
function normCode(v) {
  const s = String(v || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  const body = s.startsWith("AIS") ? s.slice(3) : s;
  return body.length === 8 ? `AIS-${body.slice(0, 4)}-${body.slice(4)}` : null;
}
function clean(v, max = 120) { return String(v == null ? "" : v).trim().slice(0, max); }
function validHost(h) { return /^(?:\d{1,3}\.){3}\d{1,3}$/.test(h) || /^[a-z0-9.-]{1,253}$/i.test(h); }

/** What staff see. The SIP password is never in a list response. */
function adminView(d) {
  return {
    id: d.id, location: d.location || "aistaff", model: d.model, device_serial: d.device_serial, sim_number: d.sim_number, carrier: d.carrier,
    phone_number: d.phone_number, gateway_host: d.gateway_host, gateway_port: d.gateway_port,
    auth_username: d.auth_username, status: d.status, max_channels: d.max_channels, notes: d.notes,
    company_id: d.company_id, company_name: d.company?.name || null,
    setup_code: d.claimed_at ? null : d.setup_code, setup_code_expires_at: d.claimed_at ? null : d.setup_code_expires_at,
    assigned_at: d.assigned_at, claimed_at: d.claimed_at,
    last_check_at: d.last_check_at, last_check_ok: d.last_check_ok, last_seen_at: d.last_seen_at, created_at: d.created_at
  };
}

/** What a tenant sees about its own line. */
function tenantView(d) {
  if (!d) return null;
  return {
    phone_number: d.phone_number, model: d.model, carrier: d.carrier, status: d.status,
    hosted: (d.location || "aistaff") === "aistaff",
    claimed: Boolean(d.claimed_at), claimed_at: d.claimed_at,
    last_check_at: d.last_check_at, last_check_ok: d.last_check_ok, last_seen_at: d.last_seen_at,
    last_call_at: d.last_call_at, last_call_from: d.last_call_from, last_call_seconds: d.last_call_seconds, last_call_mode: d.last_call_mode
  };
}

async function platformAudit(req, action, metadata) {
  const companyId = metadata.company_id || null;
  console.log("[phone-lines] %s by %s %j", action, req.user?.email || "?", metadata);
  if (!companyId) return; // tenant audit log needs a tenant; in-stock routers are logged above
  try {
    await prisma.tenantAuditLog.create({ data: {
      company_id: companyId, actor_id: req.user?.id || null, actor_email: req.user?.email || null,
      action, target_type: "phone_line", target_id: metadata.device_id || null, metadata
    } });
  } catch (e) { console.error("[phone-lines] audit failed:", e.message); }
}

/** Reachability check from the AIStaff server to the router. */
function checkReachable(host, port) {
  return new Promise((resolve) => {
    if (!host || !validHost(host)) return resolve({ ok: false, detail: "No router address saved yet (AIStaff fills this in)." });
    execFile("ping", ["-c", "1", "-W", "2", host], { timeout: 4000 }, (err) => {
      if (!err) return resolve({ ok: true, detail: "Router is reachable." });
      if (!port) return resolve({ ok: false, detail: "Router did not answer. Check power, cable and SIM." });
      const s = net.connect({ host, port: Number(port), timeout: 2500 });
      s.on("connect", () => { s.destroy(); resolve({ ok: true, detail: "Router is reachable." }); });
      s.on("timeout", () => { s.destroy(); resolve({ ok: false, detail: "Router did not answer. Check power, cable and SIM." }); });
      s.on("error", () => resolve({ ok: false, detail: "Router did not answer. Check power, cable and SIM." }));
    });
  });
}


function appUrl() { return String(process.env.PUBLIC_APP_URL || "https://aistaff.click").replace(/\/$/, ""); }
const EMAIL_RE = /^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/;
function escHtml(v) { return String(v == null ? "" : v).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c])); }

/** The handoff kit as an email: setup code, steps, and a direct link to the tenant's own panel. */
function kitEmail(d, companyName) {
  const link = `${appUrl()}/admin/settings/channels`;
  const expires = d.setup_code_expires_at ? new Date(d.setup_code_expires_at).toLocaleDateString("en-PH", { dateStyle: "medium" }) : "";
  const hosted = (d.location || "aistaff") === "aistaff";
  const steps = hosted ? [
    `Log in to AIStaff and open Settings > Channels > Mobile Phone: ${link}`,
    "Type the setup code above and press Link my router.",
    "Give your phone assistant a name and greeting, and choose what it can do. AIStaff keeps and manages the router for you — nothing to install."
  ] : [
    "Put the SIM into the router (if it is not in yet).",
    "Connect the router to your internet with the LAN cable, then plug in the power.",
    `Log in to AIStaff and open Settings > Channels > Mobile Phone: ${link}`,
    "Type the setup code above and press Link my router.",
    "Press Check connection, then give your phone assistant a name and greeting."
  ];
  const subject = "Your AIStaff phone line setup code";
  const text = [
    `Your AIStaff phone line for ${companyName} is ready.`, "",
    d.phone_number ? `Your AI phone number: ${d.phone_number}` : "",
    `Your setup code: ${d.setup_code}`,
    expires ? `Valid until ${expires}. Use it once.` : "", "",
    ...steps.map((t, i) => `${i + 1}. ${t}`), "",
    `Router: ${d.model} · Serial ${d.device_serial}`
  ].filter((l) => l !== null).join("\n");
  const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#1a2233">
    <p style="color:#4b3ecf;font-size:12px;letter-spacing:.08em;margin:0">AISTAFF · PHONE LINE SETUP</p>
    <h2 style="margin:4px 0 12px">${escHtml(companyName)}</h2>
    ${d.phone_number ? `<p>Your AI phone number: <b>${escHtml(d.phone_number)}</b></p>` : ""}
    <p style="margin:12px 0 4px">Your setup code:</p>
    <p style="font:700 28px/1.2 ui-monospace,Menlo,monospace;letter-spacing:2px;margin:0">${escHtml(d.setup_code)}</p>
    ${expires ? `<p style="font-size:12px;color:#6a7382">Valid until ${escHtml(expires)}. Use it once.</p>` : ""}
    <ol>${steps.map((t) => `<li style="margin:4px 0">${escHtml(t).replace(escHtml(link), `<a href="${link}">${escHtml(link)}</a>`)}</li>`).join("")}</ol>
    <p><a href="${link}" style="display:inline-block;background:#1a1d29;color:#fff;text-decoration:none;padding:10px 16px;border-radius:8px">Open Mobile Phone settings</a></p>
    <p style="font-size:12px;color:#6a7382">Router: ${escHtml(d.model)} · Serial ${escHtml(d.device_serial)}</p></div>`;
  return { subject, text, html };
}

async function kitRecipients(companyId) {
  const [admins, settings] = await Promise.all([
    prisma.user.findMany({ where: { company_id: companyId, platform_role: null }, select: { email: true, role: true } }),
    prisma.companySetting.findUnique({ where: { company_id: companyId } })
  ]);
  const adminEmails = admins.filter((u) => /admin|owner/i.test(String(u.role || ""))).map((u) => u.email);
  const alerts = Array.isArray(settings?.alert_contacts) ? settings.alert_contacts.map((c) => c?.email) : [];
  return [...new Set([...adminEmails, ...alerts].map((e) => String(e || "").trim().toLowerCase()).filter((e) => EMAIL_RE.test(e)))];
}

// ---------------------------------------------------------------- platform

function buildPlatformRouter({ requireAuth }) {
  const r = express.Router();
  r.use(requireAuth, requirePermission("phonelines.manage"));

  r.get("/", asyncRoute(async (req, res) => {
    const rows = await prisma.sipDevice.findMany({ orderBy: { created_at: "desc" }, include: { company: { select: { name: true } } } });
    res.json({ devices: rows.map(adminView), statuses: STATUSES });
  }));

  r.post("/", asyncRoute(async (req, res) => {
    const b = req.body || {};
    const serial = clean(b.device_serial, 80);
    if (!serial) return res.status(400).json({ error: "Serial number is required (it is on the router label)." });
    if (await prisma.sipDevice.findUnique({ where: { device_serial: serial } })) return res.status(400).json({ error: "A router with this serial number is already added." });
    const host = clean(b.gateway_host, 253);
    if (host && !validHost(host)) return res.status(400).json({ error: "Router address must be an IP address or host name." });
    const password = randomFrom("abcdefghijkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789", 20);
    const d = await prisma.sipDevice.create({ data: {
      model: clean(b.model, 60) || "AIO100-1V",
      location: b.location === "customer" ? "customer" : "aistaff",
      device_serial: serial,
      sim_number: clean(b.sim_number, 40) || null,
      carrier: clean(b.carrier, 40) || null,
      phone_number: clean(b.phone_number, 40) || null,
      gateway_host: host || null,
      gateway_port: Number(b.gateway_port) > 0 ? Math.min(65535, Number(b.gateway_port)) : null,
      max_channels: Math.max(1, Math.min(8, Number(b.max_channels) || 1)),
      notes: clean(b.notes, 1000) || null,
      auth_username: `pl_${randomFrom("abcdefghijkmnpqrstuvwxyz23456789", 10)}`,
      auth_password_encrypted: encryptSecret(password)
    }, include: { company: { select: { name: true } } } });
    await platformAudit(req, "phone_line.add", { device_id: d.id, serial });
    res.json({ device: adminView(d) });
  }));

  r.put("/:id", asyncRoute(async (req, res) => {
    const b = req.body || {};
    const data = {};
    for (const k of ["model", "sim_number", "carrier", "phone_number", "notes"]) if (k in b) data[k] = clean(b[k], k === "notes" ? 1000 : 60) || null;
    if ("gateway_host" in b) {
      const host = clean(b.gateway_host, 253);
      if (host && !validHost(host)) return res.status(400).json({ error: "Router address must be an IP address or host name." });
      data.gateway_host = host || null;
    }
    if ("gateway_port" in b) data.gateway_port = Number(b.gateway_port) > 0 ? Math.min(65535, Number(b.gateway_port)) : null;
    if ("location" in b) data.location = b.location === "customer" ? "customer" : "aistaff";
    if ("max_channels" in b) data.max_channels = Math.max(1, Math.min(8, Number(b.max_channels) || 1));
    const d = await prisma.sipDevice.update({ where: { id: req.params.id }, data, include: { company: { select: { name: true } } } });
    await platformAudit(req, "phone_line.edit", { device_id: d.id, company_id: d.company_id, changed: Object.keys(data) });
    res.json({ device: adminView(d) });
  }));

  // Assign to a tenant and issue the one-time setup code (the handoff kit).
  r.post("/:id/assign", asyncRoute(async (req, res) => {
    const companyId = clean(req.body?.company_id, 60);
    const company = companyId && await prisma.company.findUnique({ where: { id: companyId }, select: { id: true, name: true } });
    if (!company) return res.status(400).json({ error: "Choose the customer this router is for." });
    const existing = await prisma.sipDevice.findUnique({ where: { id: req.params.id } });
    if (!existing) return res.status(404).json({ error: "Router not found." });
    if (["suspended", "returned"].includes(existing.status)) return res.status(400).json({ error: `This router is ${existing.status}. Put it back in stock first.` });
    if (existing.company_id && existing.company_id !== company.id && existing.claimed_at) return res.status(400).json({ error: "This router is already set up by another customer. Unassign it first." });
    const d = await prisma.sipDevice.update({ where: { id: existing.id }, data: {
      company_id: company.id, status: "assigned", assigned_at: new Date(), claimed_at: null,
      setup_code: newSetupCode(), setup_code_expires_at: new Date(Date.now() + CODE_DAYS * 86400000)
    }, include: { company: { select: { name: true } } } });
    await platformAudit(req, "phone_line.assign", { device_id: d.id, company_id: company.id });
    res.json({ device: adminView(d) });
  }));

  r.post("/:id/new-code", asyncRoute(async (req, res) => {
    const existing = await prisma.sipDevice.findUnique({ where: { id: req.params.id } });
    if (!existing?.company_id || existing.claimed_at) return res.status(400).json({ error: "Only an assigned router that is not set up yet gets a new code." });
    const d = await prisma.sipDevice.update({ where: { id: existing.id }, data: { setup_code: newSetupCode(), setup_code_expires_at: new Date(Date.now() + CODE_DAYS * 86400000) }, include: { company: { select: { name: true } } } });
    await platformAudit(req, "phone_line.new_code", { device_id: d.id, company_id: d.company_id });
    res.json({ device: adminView(d) });
  }));

  r.post("/:id/status", asyncRoute(async (req, res) => {
    const status = clean(req.body?.status, 20);
    if (!["in_stock", "suspended", "returned", "active"].includes(status)) return res.status(400).json({ error: "Unknown status." });
    const data = { status };
    if (status === "in_stock" || status === "returned") Object.assign(data, { company_id: null, setup_code: null, setup_code_expires_at: null, assigned_at: null, claimed_at: null });
    const before = await prisma.sipDevice.findUnique({ where: { id: req.params.id } });
    const d = await prisma.sipDevice.update({ where: { id: req.params.id }, data, include: { company: { select: { name: true } } } });
    await platformAudit(req, "phone_line.status", { device_id: d.id, company_id: before?.company_id || null, status });
    res.json({ device: adminView(d) });
  }));

  r.get("/:id/kit-recipients", asyncRoute(async (req, res) => {
    const d = await prisma.sipDevice.findUnique({ where: { id: req.params.id } });
    if (!d?.company_id) return res.status(400).json({ error: "Assign the router to a customer first." });
    res.json({ emails: await kitRecipients(d.company_id) });
  }));

  // Email the handoff kit to the customer so they finish setup in their own panel.
  r.post("/:id/email-kit", asyncRoute(async (req, res) => {
    const d = await prisma.sipDevice.findUnique({ where: { id: req.params.id }, include: { company: { select: { name: true } } } });
    if (!d?.company_id || d.claimed_at || !d.setup_code) return res.status(400).json({ error: "Only an assigned router that is not set up yet has a kit to send." });
    const to = String(req.body?.to || "").split(/[\s,;]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
    const bad = to.filter((e) => !EMAIL_RE.test(e));
    if (!to.length) return res.status(400).json({ error: "Add at least one email address." });
    if (bad.length) return res.status(400).json({ error: `Not an email address: ${bad.join(", ")}` });
    const mail = kitEmail(d, d.company?.name || "your business");
    const { sendNotification } = require("../notify");
    const result = await sendNotification({ to: to.join(", "), subject: mail.subject, text: mail.text, html: mail.html, audience: "tenant", tenantName: d.company?.name || "" });
    await platformAudit(req, "phone_line.email_kit", { device_id: d.id, company_id: d.company_id, to, ok: result.ok });
    if (!result.ok) return res.status(502).json({ error: result.reason === "not_configured" ? "Email is not set up on this server (support mailbox missing)." : `Email failed: ${result.reason}` });
    res.json({ ok: true, sent_to: to });
  }));

  r.post("/:id/check", asyncRoute(async (req, res) => {
    const d = await prisma.sipDevice.findUnique({ where: { id: req.params.id } });
    if (!d) return res.status(404).json({ error: "Router not found." });
    const result = await checkReachable(d.gateway_host, d.gateway_port);
    const u = await prisma.sipDevice.update({ where: { id: d.id }, data: { last_check_at: new Date(), last_check_ok: result.ok, ...(result.ok ? { last_seen_at: new Date() } : {}) }, include: { company: { select: { name: true } } } });
    res.json({ device: adminView(u), check: result });
  }));

  // Installer details for configuring the router. Audited.
  r.get("/:id/sip-login", asyncRoute(async (req, res) => {
    const d = await prisma.sipDevice.findUnique({ where: { id: req.params.id } });
    if (!d) return res.status(404).json({ error: "Router not found." });
    let password = "";
    try { password = decryptSecret(d.auth_password_encrypted); } catch { password = ""; }
    await platformAudit(req, "phone_line.view_sip_login", { device_id: d.id, company_id: d.company_id });
    res.json({ auth_username: d.auth_username, password, note: "Enter these in the router's SIP account. Pitch will use them once phone lines are connected to Pitch." });
  }));

  r.use((error, req, res, next) => {
    console.error("[phone-lines] %s", error.stack || error.message);
    res.status(error.statusCode || 500).json({ error: error.message || "Phone line request failed." });
  });
  return r;
}

// ---------------------------------------------------------------- tenant

async function deviceFor(companyId) {
  return prisma.sipDevice.findFirst({ where: { company_id: companyId, status: { in: ["assigned", "active"] } }, orderBy: { assigned_at: "desc" } });
}

/** Tenant setup steps, computed from facts — the UI only renders them. */
function setupSteps(device, pitch) {
  const p = pitch || {};
  return {
    code: Boolean(device?.claimed_at),
    plug: Boolean(device?.last_check_ok),
    personalise: Boolean(p.agent_name && p.greeting),
    actions: Boolean(p.actions_saved),
    golive: false
  };
}

function normalisePitch(input, existing) {
  const b = input || {};
  const out = { ...(existing || {}) };
  if ("agent_name" in b) out.agent_name = clean(b.agent_name, 40);
  if ("greeting" in b) out.greeting = clean(b.greeting, 300);
  if ("fallback_line" in b) out.fallback_line = clean(b.fallback_line, 300);
  if ("voice" in b) out.voice = APPROVED_VOICES.some((v) => v.id === b.voice) ? b.voice : APPROVED_VOICES[0].id;
  if ("hours_days" in b) out.hours_days = clean(b.hours_days, 60);
  if ("hours_open" in b) out.hours_open = /^\d{2}:\d{2}$/.test(b.hours_open) ? b.hours_open : "";
  if ("hours_close" in b) out.hours_close = /^\d{2}:\d{2}$/.test(b.hours_close) ? b.hours_close : "";
  if ("after_hours" in b) out.after_hours = ["answer", "message"].includes(b.after_hours) ? b.after_hours : "answer";
  for (const k of ["allow_sms", "allow_booking", "allow_tickets"]) if (k in b) out[k] = Boolean(b[k]);
  if ("address_title" in b) out.address_title = Boolean(b.address_title);
  if ("alert_contact" in b) out.alert_contact = clean(b.alert_contact, 120);
  if ("asr_words" in b) {
    const raw = Array.isArray(b.asr_words) ? b.asr_words : String(b.asr_words || "").split(/[,;\n]+/);
    const seen = new Set();
    out.asr_words = raw.map((x) => clean(x, 40)).filter((x) => {
      const k = x.toLowerCase();
      if (!x || seen.has(k)) return false;
      seen.add(k); return true;
    }).slice(0, 40);
  }
  if ("test_numbers" in b) {
    const raw = Array.isArray(b.test_numbers) ? b.test_numbers : String(b.test_numbers || "").split(/[,;\n]+/);
    out.test_numbers = raw.map((x) => clean(x, 30)).filter((x) => x.replace(/\D/g, "").length >= 10).slice(0, 5);
  }
  if (b.actions_saved) out.actions_saved = true;
  // Call order (Settings > Channels > Mobile Phone > Call order): which steps the phone Director runs, in order.
  if (Array.isArray(b.call_order)) {
    const known = new Set(require("../voice-director").CALL_STEPS.map((s) => s.key));
    const seen = new Set();
    out.call_order = b.call_order.filter((x) => x && known.has(x.key) && !seen.has(x.key) && seen.add(x.key)).map((x) => ({ key: x.key, on: x.on !== false }));
  }
  if ("call_serial_first" in b) out.call_serial_first = b.call_serial_first !== false;
  if (out.agent_name === "" && "agent_name" in b) return { error: "Give your phone assistant a name (for example Marie)." };
  if (out.greeting === "" && "greeting" in b) return { error: "Add a greeting callers hear first." };
  return { value: out };
}

// Words worth hinting to speech recognition, taken from the tenant's own knowledge base:
// brand/product names (Capitalised words) and model numbers, most frequent first.
const COMMON = new Set(("the a an and or of to in on for with from by at is are be this that these those your our we you they it "
  + "if when what which who how why can will would should may please thank thanks yes no not do does did have has had "
  + "customer customers business service services price prices month monthly day days per rental rent new one two three "
  + "monday tuesday wednesday thursday friday saturday sunday january february march april may june july august september october november december "
  + "philippines manila metro ncr php pesos peso").split(/\s+/));
// Everyday English words (lower-case dictionary entries). A word that is NOT one of these
// is likely a brand, product, place or person name — what speech recognition mishears.
let ENGLISH = null;
function everydayEnglish() {
  if (ENGLISH) return ENGLISH;
  ENGLISH = new Set();
  try {
    for (const w of require("fs").readFileSync("/usr/share/dict/words", "utf8").split("\n")) {
      if (w && w === w.toLowerCase() && !w.includes("'")) ENGLISH.add(w);
    }
  } catch { /* no dictionary on this machine: fall back to the capital-letter rule only */ }
  return ENGLISH;
}

async function suggestAsrWords(companyId) {
  const { loadAistaffAiConfig, formatKnowledgeBaseForPrompt } = require("../aistaff-ai-config");
  const cfg = await loadAistaffAiConfig(companyId);
  const text = formatKnowledgeBaseForPrompt(cfg.knowledgeBase || []) + " " + (cfg.company?.name || "");
  const counts = new Map();
  const re = /\b([A-Z][A-Za-z0-9-]{2,}|[A-Za-z]*\d[A-Za-z0-9-]{2,})\b/g;
  let m;
  while ((m = re.exec(text))) {
    const w = m[1];
    if (COMMON.has(w.toLowerCase()) || /^\d+$/.test(w)) continue;
    if (w.length > 24 || /^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(w)) continue; // internal IDs, not words
    // A capital at the start of a sentence, line or bullet is grammar, not a name.
    const before = text.slice(Math.max(0, m.index - 4), m.index);
    if (!/\d/.test(w) && (m.index === 0 || /(?:[.!?:]\s*|\n\s*|[-*\u2022]\s+|["(]\s*)$/.test(before))) continue;
    const dict = everydayEnglish();
    if (!/\d/.test(w) && dict.size) {
      const lw = w.toLowerCase();
      const stem = lw.replace(/(ies|es|s|ed|ing)$/, "");
      if (dict.has(lw) || dict.has(stem) || dict.has(stem + "e") || dict.has(stem + "y")) continue;
    }
    if (w.length > 3 && w === w.toUpperCase() && !/\d/.test(w)) continue; // headings in capitals
    // Our own product names are not what callers say on a service line.
    if (/^(Closer|Pitch|Brandee|AIStaff|Messenger|Facebook)$/i.test(w)) continue;
    counts.set(w, (counts.get(w) || 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([w]) => w);
}

module.exports = { suggestAsrWords, buildPlatformRouter, deviceFor, tenantView, setupSteps, normalisePitch, normCode, checkReachable, APPROVED_VOICES };
