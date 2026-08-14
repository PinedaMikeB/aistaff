const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const { prisma } = require("./db");

const COOKIE_NAME = "ai_inbox_session";

// Session lifetime. Change here only — both the JWT and the cookie read it.
const SESSION_TTL_DAYS = 30;
const SESSION_TTL_MS = SESSION_TTL_DAYS * 24 * 60 * 60 * 1000;

function jwtSecret() {
  return process.env.JWT_SECRET || "local-dev-secret-change-me";
}

async function hashPassword(password) {
  return argon2.hash(password, { type: argon2.argon2id });
}

async function verifyPassword(hash, password) {
  return argon2.verify(hash, password);
}

function signSession(user) {
  return jwt.sign(
    {
      sub: user.id,
      company_id: user.company_id,
      role: user.role,
      // Stamped into the token so a password reset can kill every existing
      // session immediately. Compared against the DB value on each request.
      epoch: user.session_epoch || 0
    },
    jwtSecret(),
    // 30 days. Long sessions suit alternating admin staff who would otherwise
    // re-authenticate constantly. This is only safe BECAUSE of session_epoch
    // above: a password reset bumps the epoch and every outstanding token dies
    // immediately, so a long-lived token is revocable rather than a 30-day
    // window an attacker keeps. Kept in step with the cookie maxAge below — a
    // cookie outliving its token produces confusing 401s.
    { expiresIn: SESSION_TTL_DAYS + "d" }
  );
}

/**
 * True when the token was issued before the user's sessions were invalidated.
 *
 * Tokens minted before session_epoch existed carry no `epoch` claim; those are
 * treated as epoch 0, which matches every current user's default. Existing
 * sessions therefore keep working and nobody is logged out by this change.
 */
function sessionIsStale(payload, user) {
  return Number(payload.epoch || 0) !== Number(user.session_epoch || 0);
}

async function requireAuth(req, res, next) {
  try {
    const token = req.cookies[COOKIE_NAME] || req.headers.authorization?.replace("Bearer ", "");
    if (!token) return res.status(401).json({ error: "Authentication required" });

    const payload = jwt.verify(token, jwtSecret());
    const user = await prisma.user.findFirst({
      where: { id: payload.sub, status: "active" },
      select: {
        id: true, company_id: true, name: true, email: true, role: true, status: true,
        // Read fresh from the database on every request — never trust the JWT
        // payload or any client-supplied value for these. Safe to select
        // broadly here since none of these are secrets (no hashes/tokens).
        platform_role: true, mfa_enabled: true, last_login_at: true, session_epoch: true
      }
    });
    if (!user) return res.status(401).json({ error: "Invalid session" });
    if (sessionIsStale(payload, user)) {
      clearSessionCookie(res);
      return res.status(401).json({ error: "Session expired, please sign in again" });
    }

    req.user = user;
    req.companyId = user.company_id;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid session" });
  }
}

// Optional-auth variant for PUBLIC routes: if a valid session cookie is
// present, populate req.user exactly like requireAuth does; if not, continue
// as anonymous — NEVER 401. This is what lets the public Brandee preview
// endpoints recognize a logged-in customer and skip the anonymous
// free-preview limit. Without this, req.user was always undefined on the
// public routes and logged-in users were treated as anonymous forever.
async function attachUserIfPresent(req, res, next) {
  try {
    const token = req.cookies[COOKIE_NAME] || req.headers.authorization?.replace("Bearer ", "");
    if (!token) return next();
    const payload = jwt.verify(token, jwtSecret());
    const user = await prisma.user.findFirst({
      where: { id: payload.sub, status: "active" },
      select: {
        id: true, company_id: true, name: true, email: true, role: true, status: true,
        platform_role: true, mfa_enabled: true, last_login_at: true, session_epoch: true
      }
    });
    // Stale token on a PUBLIC route: stay anonymous rather than 401, matching
    // this function's contract.
    if (user && !sessionIsStale(payload, user)) {
      req.user = user;
      req.companyId = user.company_id;
    }
  } catch (error) {
    // Expired/invalid token on a public route: proceed anonymously.
  }
  next();
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    // Was previously hardcoded to `false` in every environment. Made
    // environment-aware so production deployments (NODE_ENV=production)
    // require HTTPS-only transmission, while local dev over plain HTTP
    // still works. Set NODE_ENV=production in the deployed environment for
    // this to take effect.
    secure: process.env.NODE_ENV === "production",
    maxAge: SESSION_TTL_MS
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

module.exports = {
  COOKIE_NAME,
  SESSION_TTL_DAYS,
  SESSION_TTL_MS,
  hashPassword,
  verifyPassword,
  signSession,
  sessionIsStale,
  requireAuth,
  attachUserIfPresent,
  setSessionCookie,
  clearSessionCookie
};
