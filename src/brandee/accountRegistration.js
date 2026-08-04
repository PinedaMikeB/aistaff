// Self-serve registration (PART 13). No self-serve signup endpoint existed
// anywhere in this codebase before this task (verified — only
// /api/auth/login, /api/auth/logout, /api/auth/me existed; accounts were
// otherwise created via the internal scripts/create-client.js script or the
// guest-checkout flow). This module is the FIRST self-serve registration
// path, but it reuses every existing primitive rather than inventing a
// parallel identity system: the same `User`/`Company` Prisma models, the
// same argon2 hashPassword from auth.js, and the same JWT session
// signing/cookie helpers used by the existing login route.

const { prisma } = require("../db");
const { hashPassword } = require("../auth");

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

class RegistrationError extends Error {
  constructor(code, message) {
    super(message);
    this.code = code;
  }
}

/**
 * Creates a Company (tenant) + User in one transaction and returns the new
 * User row (without the password hash). A brand-new individual seller/
 * creator signing up through the Brandee product-ad flow doesn't have an
 * existing "company" to join, so a lightweight personal Company record is
 * created for them automatically — this keeps the existing tenant-scoped
 * data model intact without asking a solo seller to fill out a company
 * onboarding form before they can save their first ad.
 */
async function registerAccount({ name, email, password, companyName }) {
  const cleanEmail = String(email || "").trim().toLowerCase();
  const cleanName = String(name || "").trim();

  if (!cleanName || cleanName.length < 2) throw new RegistrationError("invalid_name", "Please enter your name.");
  if (!EMAIL_PATTERN.test(cleanEmail)) throw new RegistrationError("invalid_email", "Please enter a valid email address.");
  if (!password || String(password).length < 8) throw new RegistrationError("weak_password", "Password must be at least 8 characters.");

  const existing = await prisma.user.findUnique({ where: { email: cleanEmail } });
  if (existing) throw new RegistrationError("email_already_registered", "An account with this email already exists.");

  const passwordHash = await hashPassword(password);

  const user = await prisma.$transaction(async (tx) => {
    const company = await tx.company.create({
      data: { name: (companyName || "").trim() || `${cleanName}'s Business`, status: "active" }
    });
    return tx.user.create({
      data: {
        company_id: company.id,
        name: cleanName,
        email: cleanEmail,
        password_hash: passwordHash,
        role: "owner"
      }
    });
  });

  const { password_hash, ...safeUser } = user;
  return safeUser;
}

module.exports = { registerAccount, RegistrationError };
