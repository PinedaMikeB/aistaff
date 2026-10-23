/** Scheduling cut-off rules per Business Engine (Customer Service). Tenant admins only. Added 2026-10-20. */
const express = require("express");
const { prisma } = require("../db");
const rules = require("../scheduling-rules");

function requireTenantAdmin(req, res, next) {
  const role = String(req.user?.role || "").toLowerCase();
  if (!["admin", "account_admin", "owner"].includes(role) && !(req.user?.platform_role && req.assistSessionId)) return res.status(403).json({ error: "Only a tenant administrator can change the scheduling rules." });
  next();
}
const wrap = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

function preview(settings) {
  const s = rules.normalize({ ...settings, enabled: true });
  const plain = rules.targetDate(s, { needsPrep: false });
  const prep = rules.targetDate(s, { needsPrep: true });
  return { now_after_cutoff: plain.afterCutoff, plain: rules.niceDate(plain.date), prep: rules.niceDate(prep.date) };
}

function buildRouter({ requireAuth }) {
  const router = express.Router();
  router.use(requireAuth, requireTenantAdmin);
  router.get("/:engineKey", wrap(async (req, res) => {
    const row = await rules.tenantEngineFor(req.companyId, req.params.engineKey);
    if (!row) return res.status(404).json({ error: "Set up this engine first." });
    const settings = rules.normalize(row.scheduling_rules || {});
    res.json({ settings, preview: preview(settings) });
  }));
  router.put("/:engineKey", wrap(async (req, res) => {
    const row = await rules.tenantEngineFor(req.companyId, req.params.engineKey);
    if (!row) return res.status(404).json({ error: "Set up this engine first." });
    const next = rules.normalize({ ...(row.scheduling_rules || {}), ...(req.body || {}) });
    await prisma.tenantEngine.update({ where: { id: row.id }, data: { scheduling_rules: next } });
    await prisma.tenantAuditLog.create({ data: { company_id: req.companyId, actor_id: req.user?.id || null, actor_email: req.user?.email || null, action: "scheduling_rules.update", target_type: "tenant_engine", metadata: { engine: req.params.engineKey, ...next } } }).catch(() => {});
    res.json({ settings: next, preview: preview(next) });
  }));
  router.use((error, req, res, next) => { console.error("[scheduling-rules] %s", error.stack || error.message); res.status(500).json({ error: error.message }); });
  return router;
}
module.exports = { buildRouter };
