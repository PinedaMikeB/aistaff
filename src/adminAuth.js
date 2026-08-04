// AIStaff Super Admin authorization layer.
//
// This is deliberately separate from the tenant-facing `role` field/logic in
// src/auth.js. `platform_role` is a second, orthogonal permission axis:
//   - null              -> ordinary tenant user (TENANT_ADMIN/TENANT_MEMBER,
//                          governed entirely by the existing `role` + `company_id`
//                          tenant-isolation logic already in server.js)
//   - "SUPERADMIN"      -> AIStaff owner / trusted technical operators
//   - "SUPPORT_ADMIN"   -> authorized AIStaff support personnel (restricted)
//
// Nothing here trusts the browser. Every check reads `req.user.platform_role`,
// which requireAuth (src/auth.js) populates from a fresh, server-side Prisma
// read on every request — never from the JWT payload body and never from a
// client-supplied header/field.

const PLATFORM_ROLES = Object.freeze({
  SUPERADMIN: "SUPERADMIN",
  SUPPORT_ADMIN: "SUPPORT_ADMIN"
});

const ALL_ADMIN_ROLES = [PLATFORM_ROLES.SUPERADMIN, PLATFORM_ROLES.SUPPORT_ADMIN];

const ADMIN_ERROR_CODES = Object.freeze({
  UNAUTHORIZED: "ADMIN_UNAUTHORIZED",
  FORBIDDEN: "ADMIN_FORBIDDEN",
  INVALID_INPUT: "ADMIN_INVALID_INPUT",
  RATE_LIMITED: "ADMIN_RATE_LIMITED",
  SERVICE_UNAVAILABLE: "ADMIN_SERVICE_UNAVAILABLE",
  VALIDATION_FAILED: "ADMIN_VALIDATION_FAILED",
  DATABASE_FAILED: "ADMIN_DATABASE_FAILED",
  UNKNOWN_ERROR: "ADMIN_UNKNOWN_ERROR"
});

/**
 * Fields it is NEVER safe to echo back from an admin API or render in an
 * admin page, even to a SUPERADMIN. Used by adminSafeUser() below and by the
 * audit-log metadata scrubber.
 */
const NEVER_EXPOSE_FIELDS = [
  "password_hash", "mfa_secret_encrypted", "mfa_backup_codes_hash",
  "page_access_token_encrypted", "provider_response"
];

/**
 * Express middleware factory for JSON admin APIs. Must run AFTER requireAuth.
 * Returns stable ADMIN_* error codes rather than raw messages/stack traces.
 */
function requireSuperAdminApi(allowedRoles = ALL_ADMIN_ROLES) {
  return function requireSuperAdminApiMiddleware(req, res, next) {
    if (!req.user) {
      return res.status(401).json({ error: "Authentication required", code: ADMIN_ERROR_CODES.UNAUTHORIZED });
    }
    const role = req.user.platform_role;
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).json({ error: "You do not have permission to perform this action.", code: ADMIN_ERROR_CODES.FORBIDDEN });
    }
    req.adminRole = role;
    next();
  };
}

/**
 * Express middleware factory for Super Admin HTML pages. Must run AFTER
 * requireAuth. Unauthenticated visitors are redirected to the admin login
 * page (never shown a bare 401 page); authenticated non-admin users get an
 * explicit 403 page — the admin shell is never served to them.
 */
function requireSuperAdminPage(allowedRoles = ALL_ADMIN_ROLES) {
  return function requireSuperAdminPageMiddleware(req, res, next) {
    if (!req.user) {
      const redirectTo = encodeURIComponent(req.originalUrl || "/superadmin");
      return res.redirect(302, `/superadmin/login?redirect=${redirectTo}`);
    }
    const role = req.user.platform_role;
    if (!role || !allowedRoles.includes(role)) {
      return res.status(403).type("html").send(forbiddenPageHtml());
    }
    req.adminRole = role;
    next();
  };
}

function forbiddenPageHtml() {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8" /><title>Forbidden | AIStaff Super Admin</title>
<style>body{background:#030810;color:#c7ecff;font:15px/1.6 system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0}
.box{max-width:420px;text-align:center;padding:32px}h1{color:#fff;font-size:22px;margin:0 0 12px}
a{color:#24a9ff}</style></head><body><div class="box"><h1>403 — Access denied</h1>
<p>Your account does not have permission to view the AIStaff Super Admin area.</p>
<p><a href="/">Return to AIStaff</a></p></div></body></html>`;
}

/**
 * Whether removing/downgrading SUPERADMIN from `targetUserId` would leave
 * zero active superadmins. Pure function (given a count + the target's
 * current role) so it is unit-testable without a live database.
 */
function isLastActiveSuperadmin({ activeSuperadminCount, targetIsSuperadmin }) {
  return Boolean(targetIsSuperadmin) && Number(activeSuperadminCount) <= 1;
}

async function countActiveSuperadmins(prisma) {
  return prisma.user.count({ where: { platform_role: PLATFORM_ROLES.SUPERADMIN, status: "active" } });
}

/**
 * Strips anything that looks like a secret out of audit-log metadata before
 * it is ever persisted. Defensive/allow-nothing-through-by-default for keys
 * matching common secret naming patterns.
 */
const SECRET_KEY_PATTERN = /(secret|password|token|api[_-]?key|bearer|credential|private[_-]?key)/i;

function scrubMetadata(metadata) {
  if (!metadata || typeof metadata !== "object") return {};
  const clean = {};
  for (const [key, value] of Object.entries(metadata)) {
    if (SECRET_KEY_PATTERN.test(key)) continue;
    if (NEVER_EXPOSE_FIELDS.includes(key)) continue;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      clean[key] = scrubMetadata(value);
    } else {
      clean[key] = value;
    }
  }
  return clean;
}

/**
 * Gate for sensitive/state-changing admin actions (role assignment, tenant
 * status change, retrying a run, etc.). Must run after requireSuperAdminApi.
 *
 * If the account has MFA enabled, a currently-valid MFA session cookie is
 * required or the request is rejected with ADMIN_UNAUTHORIZED + a
 * `mfaRequired: true` flag so the UI can prompt for a fresh TOTP code.
 *
 * If the account does NOT have MFA enabled yet, the action is still allowed
 * (blocking it would make initial superadmin bootstrap impossible), but
 * `req.mfaWarning` is set so callers can both audit-log the gap and surface
 * a "Enable MFA" nag in the response — this is the documented, intentional
 * compromise described in the deliverables report's security-gaps section.
 */
function requireMfaIfEnabled(req, res, next) {
  const { hasVerifiedMfa } = require("./admin/mfaSession");
  if (!req.user?.mfa_enabled) {
    req.mfaWarning = "MFA is not enabled on this account. Enable it in /superadmin/security.";
    return next();
  }
  if (!hasVerifiedMfa(req, req.user.id)) {
    return res.status(401).json({
      error: "MFA verification required for this action.",
      code: ADMIN_ERROR_CODES.UNAUTHORIZED,
      mfaRequired: true
    });
  }
  next();
}

module.exports = {
  PLATFORM_ROLES,
  ALL_ADMIN_ROLES,
  ADMIN_ERROR_CODES,
  NEVER_EXPOSE_FIELDS,
  requireSuperAdminApi,
  requireSuperAdminPage,
  requireMfaIfEnabled,
  isLastActiveSuperadmin,
  countActiveSuperadmins,
  scrubMetadata,
  forbiddenPageHtml
};
