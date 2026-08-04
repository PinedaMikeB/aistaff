// Short-lived "MFA verified this session" token for Super Admin access.
//
// The main app session (src/auth.js, COOKIE_NAME "ai_inbox_session") is
// shared with the rest of the product and is intentionally left untouched.
// This is a SECOND, separate, short-lived cookie that only ever means "this
// browser completed a TOTP challenge for this admin user recently" — it
// carries no authorization by itself (requireSuperAdminApi/Page still checks
// platform_role independently); it only gates the extra MFA step for
// accounts that have mfa_enabled = true.

const jwt = require("jsonwebtoken");

const ADMIN_MFA_COOKIE = "aistaff_admin_mfa";
const MFA_SESSION_MS = 30 * 60 * 1000; // 30 minutes

function jwtSecret() {
  return process.env.JWT_SECRET || "local-dev-secret-change-me";
}

function issueAdminMfaCookie(res, userId) {
  const token = jwt.sign({ sub: userId, purpose: "admin_mfa" }, jwtSecret(), { expiresIn: "30m" });
  res.cookie(ADMIN_MFA_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    maxAge: MFA_SESSION_MS
  });
}

function clearAdminMfaCookie(res) {
  res.clearCookie(ADMIN_MFA_COOKIE);
}

/**
 * Returns true only if the request carries a currently-valid MFA cookie
 * issued for exactly this userId.
 */
function hasVerifiedMfa(req, userId) {
  try {
    const token = req.cookies?.[ADMIN_MFA_COOKIE];
    if (!token) return false;
    const payload = jwt.verify(token, jwtSecret());
    return payload.purpose === "admin_mfa" && payload.sub === userId;
  } catch {
    return false;
  }
}

module.exports = { ADMIN_MFA_COOKIE, issueAdminMfaCookie, clearAdminMfaCookie, hasVerifiedMfa };
