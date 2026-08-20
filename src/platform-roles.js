/**
 * Who at AIStaff can do what.
 *
 * Three roles, agreed 2026-08-19:
 *
 *   admin    — everything, including adding and removing platform users
 *   manager  — customer side: view, assist, fix knowledge bases
 *   support  — same as manager, plus global prompt and model switching
 *
 * ONE LINE HELD FIRM: only `admin` manages platform users. Everything else is
 * recoverable; the ability to grant yourself permissions is not. An earlier
 * draft gave that to support, which would have let anyone with the least
 * customer-facing role escalate to full control.
 *
 * Roles live on User.platform_role and are read fresh from the database on
 * every request (see auth.js) — never trusted from the session token.
 */

const ROLES = ["admin", "manager", "support"];

const PERMISSIONS = {
  // Platform user management — admin only, deliberately.
  "platform.users": ["admin"],
  // Pricing and policy changes.
  "platform.pricing": ["admin"],
  // Global prompt and model registry: changes behaviour for EVERY tenant.
  "platform.behaviour": ["admin", "support"],
  // Seeing customers and their numbers.
  "customers.view": ["admin", "manager", "support"],
  // Hiding inactive/test workspaces from the live customer queue.
  "customers.status": ["admin"],
  // Entering a customer workspace to help.
  "customers.assist": ["admin", "manager", "support"]
};

/** Normalise legacy values. STAFF/SUPERADMIN predate the three-role model. */
function normaliseRole(value) {
  const v = String(value || "").toLowerCase().trim();
  if (v === "superadmin" || v === "owner") return "admin";
  if (v === "staff") return "manager";
  return ROLES.includes(v) ? v : null;
}

function can(user, permission) {
  const role = normaliseRole(user?.platform_role);
  if (!role) return false;
  const allowed = PERMISSIONS[permission];
  return Array.isArray(allowed) && allowed.includes(role);
}

function isPlatformUser(user) {
  return Boolean(normaliseRole(user?.platform_role));
}

/** Express guard. `requirePermission("customers.view")` */
function requirePermission(permission) {
  return (req, res, next) => {
    if (!isPlatformUser(req.user)) {
      return res.status(403).json({ error: "This area is for AIStaff staff only." });
    }
    if (!can(req.user, permission)) {
      return res.status(403).json({
        error: "Your role does not allow this.",
        needed: permission,
        role: normaliseRole(req.user.platform_role)
      });
    }
    next();
  };
}

module.exports = { ROLES, PERMISSIONS, normaliseRole, can, isPlatformUser, requirePermission };
