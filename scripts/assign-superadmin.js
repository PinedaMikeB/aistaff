#!/usr/bin/env node
// Securely assign (or revoke) the AIStaff Super Admin platform role.
//
// This is intentionally a LOCAL, INTERACTIVE, CLI-ONLY script — there is no
// HTTP endpoint that can set platform_role to SUPERADMIN for a brand-new
// account, and public signup never accepts this field at all. This script
// is the only way to create the very first superadmin. After that, a
// SUPERADMIN can promote/demote other accounts to SUPERADMIN/SUPPORT_ADMIN
// through the Super Admin UI itself (Users page -> a confirmed action),
// which is audit-logged and protected against self-assignment and against
// removing the last active superadmin.
//
// Usage:
//   node scripts/assign-superadmin.js
//
// You will be asked for the target user's email, then asked to explicitly
// confirm by re-typing that email before anything is written.

require("dotenv").config({ override: true });

const readline = require("readline");
const { PrismaClient } = require("@prisma/client");
const { hashPassword } = require("../src/auth");

const prisma = new PrismaClient();

function ask(rl, question, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => resolve(answer.trim() || defaultValue));
  });
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("\nAIStaff — Assign Super Admin platform role\n");
  console.log("This can grant SUPERADMIN or SUPPORT_ADMIN, or revoke either, for one account.");
  console.log("It never runs over HTTP and is not reachable by any API.\n");

  const email = await ask(rl, "Target account email");
  if (!email) {
    console.error("Email is required.");
    rl.close();
    process.exit(1);
  }

  let user = await prisma.user.findUnique({ where: { email } });

  if (!user) {
    console.log(`\nNo existing account found for ${email}.`);
    const create = (await ask(rl, "Create a new internal AIStaff account for this email? (yes/no)", "no")).toLowerCase();
    if (create !== "yes") {
      console.log("Nothing changed.");
      rl.close();
      await prisma.$disconnect();
      return;
    }

    let company = await prisma.company.findFirst({ where: { name: "AIStaff Internal" } });
    if (!company) {
      company = await prisma.company.create({ data: { name: "AIStaff Internal", industry: "Internal", status: "active" } });
      console.log("Created an 'AIStaff Internal' company record to hold internal operator accounts.");
    }

    const name = await ask(rl, "Full name");
    const password = await ask(rl, "Temporary password (the operator should change this immediately after first login)");
    if (!name || !password || password.length < 8) {
      console.error("Name and a password of at least 8 characters are required.");
      rl.close();
      process.exit(1);
    }

    user = await prisma.user.create({
      data: {
        company_id: company.id,
        name,
        email,
        password_hash: await hashPassword(password),
        role: "owner",
        status: "active"
      }
    });
    console.log(`Created account ${email}.`);
  }

  console.log(`\nCurrent platform role for ${user.email}: ${user.platform_role || "(none)"}`);
  const action = await ask(rl, "Set platform role to SUPERADMIN, SUPPORT_ADMIN, or NONE (to revoke)", "SUPERADMIN");
  const normalized = action.trim().toUpperCase();
  if (!["SUPERADMIN", "SUPPORT_ADMIN", "NONE"].includes(normalized)) {
    console.error("Must be exactly SUPERADMIN, SUPPORT_ADMIN, or NONE.");
    rl.close();
    process.exit(1);
  }
  const newRole = normalized === "NONE" ? null : normalized;

  if (!newRole && user.platform_role === "SUPERADMIN") {
    const activeSuperadmins = await prisma.user.count({ where: { platform_role: "SUPERADMIN", status: "active" } });
    if (activeSuperadmins <= 1) {
      console.error("\nRefusing to remove the last active SUPERADMIN. Assign SUPERADMIN to another account first.");
      rl.close();
      process.exit(1);
    }
  }

  console.log(`\nAbout to set platform_role = ${newRole || "null"} for ${user.email} (${user.id}).`);
  const confirmEmail = await ask(rl, "Type the account email again to confirm this change");
  if (confirmEmail !== email) {
    console.error("Confirmation did not match. Nothing changed.");
    rl.close();
    process.exit(1);
  }

  await prisma.user.update({ where: { id: user.id }, data: { platform_role: newRole } });
  console.log(`\nDone. ${user.email} now has platform_role = ${newRole || "null"}.`);
  if (newRole) {
    console.log("\nNext steps for this operator:");
    console.log(`  1. Sign in at /superadmin/login with ${user.email}.`);
    console.log("  2. Immediately go to /superadmin/security and enable MFA.");
    console.log("  3. Change the temporary password if one was set above (via the normal account settings).");
  }

  rl.close();
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("Failed:", error.message);
  await prisma.$disconnect();
  process.exit(1);
});
