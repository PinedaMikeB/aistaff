// Self-serve registration tests (PART 13).
//
// This module's `../db` require instantiates a live `PrismaClient`, which
// this sandbox cannot load (the installed Prisma engine binary was built
// for darwin-arm64, this sandbox is linux-arm64 — a platform mismatch, not
// a code bug; confirmed separately that `new PrismaClient()` triggers an
// unhandled async rejection outside of server.js's global safety net).
// Rather than skip DB-touching logic entirely, this test pre-populates
// `require.cache` for `src/db.js`'s resolved path with an in-memory fake
// `prisma` BEFORE requiring accountRegistration.js, so the real Prisma
// engine is never loaded and the actual registration logic (validation,
// duplicate-email check, password hashing via the real argon2 auth.js,
// Company+User creation shape) is exercised for real.

const test = require("node:test");
const assert = require("node:assert/strict");

const dbPath = require.resolve("../../src/db");

function installFakeDb({ existingEmails = [] } = {}) {
  const users = new Map(existingEmails.map((email) => [email, { id: `existing-${email}`, email }]));
  const fakePrisma = {
    user: {
      findUnique: async ({ where: { email } }) => users.get(email) || null,
      create: async ({ data }) => ({ id: `user-${data.email}`, ...data })
    },
    company: {
      create: async ({ data }) => ({ id: `company-${data.name}`, ...data })
    },
    $transaction: async (fn) => fn({
      company: { create: async ({ data }) => ({ id: `company-${data.name}`, ...data }) },
      user: { create: async ({ data }) => ({ id: `user-${data.email}`, ...data }) }
    })
  };
  require.cache[dbPath] = { id: dbPath, filename: dbPath, loaded: true, exports: { prisma: fakePrisma } };
  return fakePrisma;
}

function freshAccountRegistration() {
  const modPath = require.resolve("../../src/brandee/accountRegistration");
  delete require.cache[modPath];
  return require("../../src/brandee/accountRegistration");
}

test("rejects an empty/too-short name before ever touching the database", async () => {
  installFakeDb();
  const { registerAccount, RegistrationError } = freshAccountRegistration();
  await assert.rejects(
    () => registerAccount({ name: "J", email: "jane@example.com", password: "longenough1", companyName: "" }),
    (err) => err instanceof RegistrationError && err.code === "invalid_name"
  );
});

test("rejects a malformed email address", async () => {
  installFakeDb();
  const { registerAccount, RegistrationError } = freshAccountRegistration();
  await assert.rejects(
    () => registerAccount({ name: "Jane Seller", email: "not-an-email", password: "longenough1", companyName: "" }),
    (err) => err instanceof RegistrationError && err.code === "invalid_email"
  );
});

test("rejects a password shorter than 8 characters", async () => {
  installFakeDb();
  const { registerAccount, RegistrationError } = freshAccountRegistration();
  await assert.rejects(
    () => registerAccount({ name: "Jane Seller", email: "jane@example.com", password: "short", companyName: "" }),
    (err) => err instanceof RegistrationError && err.code === "weak_password"
  );
});

test("rejects registration for an email that already has an account", async () => {
  installFakeDb({ existingEmails: ["taken@example.com"] });
  const { registerAccount, RegistrationError } = freshAccountRegistration();
  await assert.rejects(
    () => registerAccount({ name: "Jane Seller", email: "taken@example.com", password: "longenough1", companyName: "" }),
    (err) => err instanceof RegistrationError && err.code === "email_already_registered"
  );
});

test("successfully registers a new account, creates a personal company when none is given, and never returns the password hash", async () => {
  installFakeDb();
  const { registerAccount } = freshAccountRegistration();
  const user = await registerAccount({ name: "Jane Seller", email: "Jane@Example.com", password: "longenough1", companyName: "" });

  assert.equal(user.email, "jane@example.com", "email must be normalized to lowercase");
  assert.equal(user.name, "Jane Seller");
  assert.equal(user.role, "owner");
  assert.ok(user.company_id, "a company must be created for a solo seller");
  assert.equal("password_hash" in user, false, "the returned user object must never include the password hash");
});

test("uses the supplied company name when one is provided instead of inventing a personal one", async () => {
  installFakeDb();
  const { registerAccount } = freshAccountRegistration();
  const user = await registerAccount({ name: "Jane Seller", email: "jane2@example.com", password: "longenough1", companyName: "Jane's Ecommerce Shop" });
  assert.ok(user.company_id.includes("Jane's Ecommerce Shop"));
});
