// Append-only admin audit log writer.
//
// By convention (not database constraint, since Postgres row-level
// immutability isn't set up in this project) no route in this codebase ever
// issues an UPDATE or DELETE against admin_audit_logs — only .create() calls
// exist. Keep it that way: audit history must never be editable through the
// normal application.

const { prisma } = require("../db");
const { scrubMetadata } = require("../adminAuth");

const AUDIT_ACTIONS = Object.freeze({
  ADMIN_LOGIN: "admin.login",
  ADMIN_LOGIN_FAILED: "admin.login_failed",
  ROLE_ASSIGNED: "admin.role_assigned",
  ROLE_REMOVED: "admin.role_removed",
  CREATIVE_BRAIN_VALIDATED: "brandee.creative_brain_validated",
  RESOURCE_VALIDATED: "brandee.resource_validated",
  SERVICE_TESTED: "brandee.service_tested",
  MODEL_TESTED: "brandee.model_tested",
  RUN_INSPECTED: "brandee.run_inspected",
  RUN_RETRIED: "brandee.run_retried",
  TENANT_STATUS_CHANGED: "tenant.status_changed",
  USER_STATUS_CHANGED: "user.status_changed",
  DATA_EXPORTED: "admin.data_exported",
  CONFIG_CHANGED: "admin.config_changed"
});

/**
 * Records one audit event. Never throws into the caller — a transient audit
 * DB hiccup should not be allowed to silently block or corrupt an otherwise
 * successful admin action, but it IS loudly logged server-side so it can't
 * go unnoticed. Returns { ok: boolean } so callers can surface a soft
 * warning if they want to.
 */
async function recordAuditEvent({
  req = null,
  actorUserId,
  actorRole,
  action,
  targetType,
  targetId = null,
  metadata = {}
}) {
  const ipAddress = req ? (req.ip || req.headers?.["x-forwarded-for"] || null) : null;
  const userAgent = req ? (req.headers?.["user-agent"] || null) : null;

  try {
    await prisma.adminAuditLog.create({
      data: {
        actor_user_id: actorUserId,
        actor_role: actorRole || "unknown",
        action,
        target_type: targetType,
        target_id: targetId,
        ip_address: ipAddress,
        user_agent: userAgent,
        metadata: scrubMetadata(metadata)
      }
    });
    return { ok: true };
  } catch (error) {
    console.error("[admin-audit] FAILED to write audit log entry — this must be investigated:", {
      action, targetType, targetId, actorUserId, error: error.message
    });
    return { ok: false };
  }
}

async function listAuditLogs({ limit = 100, action = null, targetType = null } = {}) {
  const where = {};
  if (action) where.action = action;
  if (targetType) where.target_type = targetType;
  const rows = await prisma.adminAuditLog.findMany({
    where,
    orderBy: { created_at: "desc" },
    take: Math.min(Math.max(Number(limit) || 100, 1), 500),
    include: { actor: { select: { id: true, name: true, email: true } } }
  });
  return rows;
}

module.exports = { AUDIT_ACTIONS, recordAuditEvent, listAuditLogs };
