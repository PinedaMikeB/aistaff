/** Daily briefing report settings (Settings > General). Tenant admins only. Added 2026-10-20. */
const express = require("express");
const { prisma } = require("../db");
const briefing = require("../briefing");

function requireTenantAdmin(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();
  if (!["admin", "account_admin", "owner"].includes(role) && !(req.user?.platform_role && req.assistSessionId)) return res.status(403).json({ error: "Only a tenant administrator can change the briefing report." });
  next();
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function buildRouter({ requireAuth }) {
  const router = express.Router();
  router.use(requireAuth, requireTenantAdmin);
  router.get("/", wrap(async (req, res) => {
    const settings = await prisma.companySetting.findUnique({ where: { company_id: req.companyId } });
    res.json({ settings: briefing.normalize(settings?.briefing_settings || {}), sections: briefing.SECTIONS, recipients: briefing.recipientsFor(settings) });
  }));
  router.put("/", wrap(async (req, res) => {
    const current = await prisma.companySetting.findUnique({ where: { company_id: req.companyId } });
    const next = briefing.normalize({ ...(current?.briefing_settings || {}), ...(req.body || {}), last_sent_date: current?.briefing_settings?.last_sent_date, last_sent_at: current?.briefing_settings?.last_sent_at });
    if (!next.days.length && next.enabled) return res.status(400).json({ error: "Choose at least one day." });
    await prisma.companySetting.update({ where: { company_id: req.companyId }, data: { briefing_settings: next } });
    await prisma.tenantAuditLog.create({ data: { company_id: req.companyId, actor_id: req.user?.id || null, actor_email: req.user?.email || null, action: "briefing.update", target_type: "company_settings", metadata: { enabled: next.enabled, days: next.days, time: next.time, sections: next.sections } } }).catch(() => {});
    res.json({ settings: next, sections: briefing.SECTIONS, recipients: briefing.recipientsFor(current) });
  }));
  router.post("/test", wrap(async (req, res) => {
    const to = String(req.user?.email || "").toLowerCase();
    if (!to.includes("@")) return res.status(400).json({ error: "Your login has no email address." });
    const result = await briefing.sendReport(req.companyId, { onlyTo: to });
    res.json({ ok: result.ok, to, counts: result.counts });
  }));
  router.use((error, req, res, next) => { console.error("[briefing] %s", error.stack || error.message); res.status(500).json({ error: error.message }); });
  return router;
}
module.exports = { buildRouter };
