/**
 * Website Chat Widget for every tenant (added 2026-10-20). Settings > Channels > Website Chat Widget.
 *   GET  /embed/closer-widget.js                       the embeddable script (any site)
 *   GET  /api/public/widget/:key/config                name + greeting for the widget header
 *   POST /api/public/widget/:key/messages              { visitorId, text, page } -> Closer's reply
 *   GET  /api/public/widget/:key/messages?visitorId=&after=   new messages (staff replies too)
 * :key is tenant_channels.config.public_key (website_chat). Only the tenant's allowed origins
 * (config.allowed_origins) may call it. One conversation per visitor (channel website_chat).
 */
const path = require("path");
const fs = require("fs");
const express = require("express");
const { prisma } = require("../db");

const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now();
  const list = (hits.get(key) || []).filter((t) => now - t < windowMs);
  if (list.length >= max) return true;
  list.push(now); hits.set(key, list);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some((t) => now - t < windowMs)) hits.delete(k);
  return false;
}
const clean = (value, max) => String(value ?? "").replace(/\u0000/g, "").trim().slice(0, max);
const VISITOR_RE = /^[a-zA-Z0-9_-]{8,80}$/;

async function widgetFor(key) {
  if (!/^[a-zA-Z0-9_-]{16,80}$/.test(String(key || ""))) return null;
  const row = await prisma.tenantChannel.findFirst({ where: { channel_key: "website_chat", config: { path: ["public_key"], equals: key } } }).catch(() => null);
  return row && row.enabled ? row : null;
}

function originAllowed(row, origin) {
  const list = Array.isArray(row?.config?.allowed_origins) ? row.config.allowed_origins : [];
  if (!origin) return false;
  return list.some((allowed) => String(allowed).toLowerCase().replace(/\/$/, "") === String(origin).toLowerCase());
}

function cors(req, res, row) {
  const origin = req.get("origin") || "";
  res.setHeader("Vary", "Origin");
  if (row && originAllowed(row, origin)) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    res.setHeader("Access-Control-Max-Age", "600");
    return true;
  }
  return false;
}

function publicMessages(rows) {
  return rows.map((m) => ({ id: m.id, from: m.sender_type === "customer" ? "visitor" : m.sender_type === "admin" ? "staff" : "closer", text: m.message_text, at: m.created_at }));
}

async function conversationFor(companyId, visitorId) {
  return prisma.conversation.findUnique({ where: { company_id_channel_external_id: { company_id: companyId, channel: "website_chat", external_id: visitorId } } });
}

function buildRouter() {
  const router = express.Router();
  const scriptPath = path.join(__dirname, "..", "widget", "closer-widget.js");

  router.get("/embed/closer-widget.js", (req, res) => {
    res.setHeader("Content-Type", "application/javascript; charset=utf-8");
    res.setHeader("Cross-Origin-Resource-Policy", "cross-origin");
    res.setHeader("Cache-Control", "public, max-age=60");
    fs.createReadStream(scriptPath).on("error", () => res.status(404).end()).pipe(res);
  });

  router.options("/api/public/widget/:key/:what", async (req, res) => {
    const row = await widgetFor(req.params.key);
    cors(req, res, row);
    res.status(204).end();
  });

  router.get("/api/public/widget/:key/config", async (req, res) => {
    const row = await widgetFor(req.params.key);
    if (!cors(req, res, row)) return res.status(403).json({ ok: false });
    const company = await prisma.company.findUnique({ where: { id: row.company_id }, select: { name: true } });
    res.json({ ok: true, name: row.config?.widget_title || company?.name || "Chat with us", greeting: row.config?.greeting || `Hi! Welcome to ${company?.name || "our website"}. How can we help you today?`, color: row.config?.color || "#1d4ed8" });
  });

  // Live steps while a reply is being prepared (src/progress.js). Cheap: memory only.
  router.get("/api/public/widget/:key/progress", async (req, res) => {
    const row = await widgetFor(req.params.key);
    if (!cors(req, res, row)) return res.status(403).json({ ok: false });
    const visitorId = String(req.query.visitorId || "");
    if (!VISITOR_RE.test(visitorId)) return res.status(400).json({ ok: false });
    const conversation = await conversationFor(row.company_id, visitorId);
    const item = conversation ? require("../progress").get(conversation.id) : null;
    res.set("Cache-Control", "no-store").json({ ok: true, step: item ? item.text : null });
  });

  router.get("/api/public/widget/:key/messages", async (req, res) => {
    const row = await widgetFor(req.params.key);
    if (!cors(req, res, row)) return res.status(403).json({ ok: false });
    const visitorId = String(req.query.visitorId || "");
    if (!VISITOR_RE.test(visitorId)) return res.status(400).json({ ok: false });
    const conversation = await conversationFor(row.company_id, visitorId);
    if (!conversation) return res.json({ ok: true, messages: [] });
    const after = Date.parse(String(req.query.after || "")) || 0;
    const rows = await prisma.message.findMany({ where: { conversation_id: conversation.id, ...(after ? { created_at: { gt: new Date(after) } } : {}) }, orderBy: { created_at: "asc" }, take: 60 });
    res.json({ ok: true, messages: publicMessages(rows) });
  });

  router.post("/api/public/widget/:key/messages", express.json({ limit: "16kb" }), async (req, res) => {
    const row = await widgetFor(req.params.key);
    if (!cors(req, res, row)) return res.status(403).json({ ok: false });
    const ip = req.get("cf-connecting-ip") || req.ip || "unknown";
    const visitorId = String(req.body?.visitorId || "");
    const text = clean(req.body?.text, 2000);
    if (!VISITOR_RE.test(visitorId) || !text) return res.status(400).json({ ok: false, error: "Please type a message." });
    if (limited(`ip:${ip}`, 30, 10 * 60 * 1000) || limited(`v:${visitorId}`, 20, 10 * 60 * 1000)) {
      return res.status(429).json({ ok: false, error: "Too many messages. Please wait a moment and try again." });
    }
    const companyId = row.company_id;
    const page = clean(req.body?.page, 300);
    const now = new Date();
    let conversation = await conversationFor(companyId, visitorId);
    if (!conversation) {
      conversation = await prisma.conversation.create({ data: { company_id: companyId, channel: "website_chat", external_id: visitorId, customer_name: `Website visitor ${visitorId.slice(-6).toUpperCase()}`, last_message_at: now } });
    } else {
      await prisma.conversation.update({ where: { id: conversation.id }, data: { last_message_at: now } }).catch(() => {});
    }
    const customerMessage = await prisma.message.create({ data: { company_id: companyId, conversation_id: conversation.id, sender_type: "customer", sender_id: visitorId, message_text: text } });
    let lead = await prisma.lead.findFirst({ where: { company_id: companyId, conversation_id: conversation.id } });
    if (!lead) {
      lead = await prisma.lead.create({ data: { company_id: companyId, conversation_id: conversation.id, lead_status: "new", customer_name: conversation.customer_name, source_channel: "website_chat", source_label: "Website chat", source_url: page || null, visitor_id: visitorId } }).catch(() => null);
    }
    const settings = await prisma.companySetting.findUnique({ where: { company_id: companyId } });
    if (!settings?.ai_enabled || !row.ai_replies || conversation.needs_human) {
      return res.json({ ok: true, messages: publicMessages([customerMessage]), note: "Thanks! A team member will reply here soon." });
    }
    const { generateSalesReply, leadUpdateDataForAi } = require("../ai");
    let ai;
    const recovery = require("../reply-recovery");
    recovery.markStart(conversation.id);
    require("../progress").step(conversation.id, "Reading your message…");
    try {
      ai = await generateSalesReply({ companyId, conversationId: conversation.id, message: text });
    } catch (error) {
      recovery.markEnd(conversation.id);
      require("../progress").clear(conversation.id);
      console.error("[widget] REPLY FAILED company=%s conversation=%s: %s", companyId, conversation.id, error.message);
      await prisma.conversation.update({ where: { id: conversation.id }, data: { needs_human: true, status: "handoff" } }).catch(() => {});
      await prisma.humanHandoff.create({ data: { company_id: companyId, conversation_id: conversation.id, reason: `Website chat reply failed: ${error.message}`.slice(0, 1000) } }).catch(() => {});
      return res.json({ ok: true, messages: publicMessages([customerMessage]), note: "Thanks! A team member will reply here soon." });
    }
    if (lead) await prisma.lead.update({ where: { id: lead.id }, data: { ...(ai.leadPatch || {}), ...leadUpdateDataForAi(lead.lead_status, ai) } }).catch(() => {});
    await prisma.conversation.update({ where: { id: conversation.id }, data: { intent: ai.intent, lead_score: ai.leadScore, needs_human: ai.needsHuman, status: ai.needsHuman ? "handoff" : "open", last_message_at: new Date() } }).catch(() => {});
    if (ai.needsHuman && settings?.human_handoff_enabled) {
      await prisma.humanHandoff.create({ data: { company_id: companyId, conversation_id: conversation.id, reason: String(ai.handoffReason || "Website chat requested human handoff").slice(0, 1000) } }).catch(() => {});
    }
    recovery.markEnd(conversation.id);
    require("../progress").clear(conversation.id);
    const parts = [ai.reply, ...(ai.followUpMessages || [])].map((t) => String(t || "").trim()).filter(Boolean);
    const saved = [];
    for (const part of parts) saved.push(await prisma.message.create({ data: { company_id: companyId, conversation_id: conversation.id, sender_type: "ai", sender_id: "ai_sales_assistant", message_text: part, ai_generated: true } }));
    console.log("[widget] company=%s visitor=%s conversation=%s replied=%d", companyId, visitorId.slice(-6), conversation.id, saved.length);
    res.json({ ok: true, messages: publicMessages([customerMessage, ...saved]) });
  });

  return router;
}

module.exports = { buildRouter, widgetFor };
