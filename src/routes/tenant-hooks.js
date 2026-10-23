/**
 * Inbound alerts FROM a tenant's own system (added 2026-10-20).
 *   POST /api/hooks/tenant-alert   header x-aistaff-hook-key: <tenant key>
 *   body { kind, title, summary, details: {label: value}, link, link_label }
 * The key is per tenant (company_settings.alert_hook_key_hash = sha256(key)); create one with
 * scripts/tenant-alert-key.js. The alert goes to the tenant's alert contacts (Settings >
 * General > Who gets alerts) and the platform admin, like ACTION NEEDED alerts.
 * First use: Marga Collections — customer would not give a mobile number / email.
 */
const crypto = require("crypto");
const express = require("express");
const { prisma } = require("../db");
const { sendToTenantAndPlatform } = require("../notify");

const hits = new Map();
const clean = (value, max) => String(value ?? "").replace(/[\r\n]+/g, " ").trim().slice(0, max);
const esc = (value) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

function buildRouter() {
  const router = express.Router();
  router.post("/tenant-alert", express.json({ limit: "64kb" }), async (req, res) => {
    try {
      const key = String(req.get("x-aistaff-hook-key") || "");
      if (key.length < 24) return res.status(401).json({ ok: false, error: "missing key" });
      const hash = crypto.createHash("sha256").update(key).digest("hex");
      const settings = await prisma.companySetting.findFirst({ where: { alert_hook_key_hash: hash } });
      if (!settings) return res.status(401).json({ ok: false, error: "unknown key" });
      const now = Date.now();
      const list = (hits.get(settings.company_id) || []).filter((t) => now - t < 3600000);
      if (list.length >= 60) return res.status(429).json({ ok: false, error: "too many alerts this hour" });
      list.push(now); hits.set(settings.company_id, list);

      const company = await prisma.company.findUnique({ where: { id: settings.company_id }, select: { name: true } });
      const body = req.body || {};
      const title = clean(body.title, 160) || "Alert from your system";
      const summary = clean(body.summary, 1000);
      const rows = Object.entries(body.details && typeof body.details === "object" ? body.details : {}).slice(0, 20)
        .map(([k, v]) => [clean(k, 60), clean(v, 400)]).filter(([, v]) => v);
      const link = /^https:\/\//.test(String(body.link || "")) ? String(body.link).slice(0, 300) : "";
      const linkLabel = clean(body.link_label, 60) || "Open";
      const subject = `ALERT: ${title} — ${company?.name || "your business"}`;
      const text = [subject, "", summary, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", link ? `${linkLabel}: ${link}` : ""].filter((l, i, all) => l !== "" || all[i - 1] !== "").join("\n");
      const html = `<div style="font-family:system-ui,-apple-system,Segoe UI,sans-serif;max-width:560px;margin:0 auto;color:#1a2233">
        <h2 style="margin:0 0 8px;font-size:18px;color:#b91c1c">${esc(title)}</h2>
        ${summary ? `<p style="font-size:14px;margin:0 0 12px">${esc(summary)}</p>` : ""}
        <table style="font-size:13px;border-collapse:collapse">${rows.map(([k, v]) => `<tr><td style="padding:3px 12px 3px 0;color:#6a7382;vertical-align:top">${esc(k)}</td><td style="padding:3px 0">${esc(v)}</td></tr>`).join("")}</table>
        ${link ? `<p style="margin:16px 0 0"><a href="${esc(link)}" style="display:inline-block;padding:10px 14px;border-radius:8px;background:#1d4ed8;color:#fff;text-decoration:none;font-weight:700">${esc(linkLabel)}</a></p>` : ""}
      </div>`;
      const result = await sendToTenantAndPlatform({ settings, tenantName: company?.name || "", build: () => ({ subject, text, html }) });
      await prisma.tenantAuditLog.create({ data: { company_id: settings.company_id, action: "tenant_alert.received", target_type: "hook", metadata: { kind: clean(body.kind, 60), title, sent: result.ok } } }).catch(() => {});
      console.log("[tenant-alert] company=%s kind=%s sent=%s", settings.company_id, clean(body.kind, 60), result.ok);
      res.json({ ok: true, sent: result.ok });
    } catch (error) {
      console.error("[tenant-alert] %s", error.stack || error.message);
      res.status(500).json({ ok: false });
    }
  });
  return router;
}

module.exports = { buildRouter };
