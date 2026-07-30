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
      select: { id: true, company_id: true, name: true, email: true, role: true, status: true }
    });
    if (!user) return res.status(401).json({ error: "Invalid session" });

    req.user = user;
    req.companyId = user.company_id;
    next();
  } catch (error) {
    return res.status(401).json({ error: "Invalid session" });
  }
}

function setSessionCookie(res, token) {
  res.cookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: false,
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
  setSessionCookie,
  clearSessionCookie
};
