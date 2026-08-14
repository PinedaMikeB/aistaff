/**
 * Password reset.
 *
 * SECURITY PROPERTIES, and why each one is here:
 *
 * 1. The raw token is NEVER stored. Only sha256(token) is persisted. A dump of
 *    password_reset_tokens is therefore useless to an attacker — same reason
 *    password_hash exists instead of the password.
 * 2. Tokens come from crypto.randomBytes, never Math.random or a UUID.
 * 3. Single use. Redeeming one invalidates every other outstanding token for
 *    that user, so an older email in the inbox cannot be replayed.
 * 4. Short lived (60 minutes).
 * 5. Enumeration-safe: requestReset() returns the SAME shape whether or not
 *    the address belongs to an account. The caller must not branch on it.
 * 6. On success the user's session_epoch is bumped, killing every existing
 *    session immediately. Without this the attacker who triggered the reset
 *    keeps their 30-day cookie and the reset achieves nothing.
 */

const crypto = require("crypto");
const nodemailer = require("nodemailer");
const { prisma } = require("./db");
const { hashPassword } = require("./auth");
const { BUSINESS_IDENTITY } = require("./payments");

const TOKEN_TTL_MINUTES = 60;
const TOKEN_BYTES = 32;

function hashToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken)).digest("hex");
}

function newRawToken() {
  return crypto.randomBytes(TOKEN_BYTES).toString("hex");
}

function isEmailConfigured() {
  return Boolean(process.env.SMTP_HOST && process.env.SMTP_USER && process.env.SMTP_PASS);
}

function createTransport() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port: Number(process.env.SMTP_PORT || 587),
    secure: Number(process.env.SMTP_PORT) === 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
  });
}

function appUrl() {
  return (process.env.APP_URL || "https://aistaff.click").replace(/\/+$/, "");
}


/**
 * Step 1: someone asked for a reset link.
 *
 * ALWAYS resolves the same way. Never tell the caller whether the address
 * exists — that would turn this endpoint into a customer-list oracle, undoing
 * the generic "Invalid email or password" the login route already returns.
 */
async function requestReset({ email, ip }) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  const user = await prisma.user.findUnique({
    where: { email: cleanEmail },
    select: { id: true, email: true, name: true, status: true }
  });

  // Unknown address, or a suspended account: do the same amount of nothing.
  if (!user || user.status !== "active") return { ok: true };

  const rawToken = newRawToken();
  await prisma.passwordResetToken.create({
    data: {
      user_id: user.id,
      token_hash: hashToken(rawToken),
      expires_at: new Date(Date.now() + TOKEN_TTL_MINUTES * 60 * 1000),
      requested_ip: ip || null
    }
  });

  await sendResetEmail({ to: user.email, name: user.name, rawToken });
  return { ok: true };
}

async function sendResetEmail({ to, name, rawToken }) {
  // The raw token appears here and nowhere else — not in the database, not in
  // logs. Keep it out of any console.log added later.
  const link = `${appUrl()}/admin/reset-password?token=${rawToken}`;

  if (!isEmailConfigured()) {
    // Deliberately quiet about the address. Never throw — a mail outage must
    // not change what the caller sees, or it leaks which addresses exist.
    console.warn("[password-reset] SMTP not configured; reset email not sent");
    return;
  }

  const brand = (BUSINESS_IDENTITY && BUSINESS_IDENTITY.legalName) || "AIStaff";
  const text = [
    `Hi ${name || "there"},`,
    "",
    `Someone asked to reset the password for your ${brand} account.`,
    "",
    `Reset it here (the link works once, and expires in ${TOKEN_TTL_MINUTES} minutes):`,
    link,
    "",
    "If this wasn't you, you can ignore this email — your password stays as it is.",
    "",
    brand
  ].join("\n");

  try {
    await createTransport().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject: `Reset your ${brand} password`,
      text
    });
  } catch (error) {
    // Same reasoning as above: swallow, log without the address.
    console.error("[password-reset] send failed:", error.message);
  }
}

/**
 * Step 2: redeem a token and set the new password.
 *
 * Returns { ok: false, code } on failure. Codes are safe to show — they say
 * the LINK is bad, never whether an account exists.
 */
async function resetPassword({ token, newPassword }) {
  if (!token) return { ok: false, code: "invalid_token" };
  if (!newPassword || String(newPassword).length < 8) {
    return { ok: false, code: "weak_password" };
  }

  const record = await prisma.passwordResetToken.findUnique({
    where: { token_hash: hashToken(token) },
    select: { id: true, user_id: true, expires_at: true, used_at: true }
  });

  if (!record) return { ok: false, code: "invalid_token" };
  if (record.used_at) return { ok: false, code: "token_already_used" };
  if (record.expires_at.getTime() < Date.now()) return { ok: false, code: "token_expired" };

  const password_hash = await hashPassword(newPassword);

  await prisma.$transaction([
    // Bumping session_epoch is what actually logs the attacker out. Everything
    // else here is bookkeeping.
    prisma.user.update({
      where: { id: record.user_id },
      data: { password_hash, session_epoch: { increment: 1 } }
    }),
    prisma.passwordResetToken.update({
      where: { id: record.id },
      data: { used_at: new Date() }
    }),
    // Any other outstanding link for this user dies too.
    prisma.passwordResetToken.updateMany({
      where: { user_id: record.user_id, used_at: null },
      data: { used_at: new Date() }
    })
  ]);

  return { ok: true, userId: record.user_id };
}

/** Housekeeping so the table does not grow without bound at scale. */
async function purgeExpiredTokens() {
  const { count } = await prisma.passwordResetToken.deleteMany({
    where: { expires_at: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } }
  });
  return count;
}

module.exports = {
  TOKEN_TTL_MINUTES,
  hashToken,
  newRawToken,
  isEmailConfigured,
  createTransport,
  appUrl,
  requestReset,
  resetPassword,
  purgeExpiredTokens
};
