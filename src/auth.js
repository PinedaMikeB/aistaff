const argon2 = require("argon2");
const jwt = require("jsonwebtoken");
const { prisma } = require("./db");

const COOKIE_NAME = "ai_inbox_session";

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
    { sub: user.id, company_id: user.company_id, role: user.role },
    jwtSecret(),
    { expiresIn: "8h" }
  );
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
        platform_role: true, mfa_enabled: true, last_login_at: true
      }
    });
    if (!user) return res.status(401).json({ error: "Invalid session" });

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
        platform_role: true, mfa_enabled: true, last_login_at: true
      }
    });
    if (user) {
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
    maxAge: 8 * 60 * 60 * 1000
  });
}

function clearSessionCookie(res) {
  res.clearCookie(COOKIE_NAME);
}

module.exports = {
  COOKIE_NAME,
  hashPassword,
  verifyPassword,
  signSession,
  requireAuth,
  attachUserIfPresent,
  setSessionCookie,
  clearSessionCookie
};
