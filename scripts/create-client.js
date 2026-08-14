#!/usr/bin/env node
require("dotenv").config({ override: true });

const readline = require("readline");
const { PrismaClient } = require("@prisma/client");
const { hashPassword } = require("../src/auth");
const { encryptSecret } = require("../src/crypto");

const prisma = new PrismaClient();

function ask(rl, question, defaultValue = "") {
  const suffix = defaultValue ? ` [${defaultValue}]` : "";
  return new Promise((resolve) => {
    rl.question(`${question}${suffix}: `, (answer) => resolve(answer.trim() || defaultValue));
  });
}

async function main() {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  console.log("\nAIStaff — Create client tenant\n");

  const name = await ask(rl, "Company name");
  const industry = await ask(rl, "Industry", "B2B services");
  const website = await ask(rl, "Website", "");
  const contactEmail = await ask(rl, "Company contact email", "");
  const contactNumber = await ask(rl, "Company contact number", "");
  const adminName = await ask(rl, "Admin name", "Admin");
  const adminEmail = await ask(rl, "Admin login email");
  // No shared default. A fixed default password means every tenant created
  // by this script starts with the SAME known credential — that is how
  // "ChangeMe123!" ended up live on more than one account. Blank input now
  // generates a strong random password, printed once at the end.
  const generatedPassword = require("crypto").randomBytes(12).toString("base64url");
  const adminPassword = (await ask(rl, "Admin password (blank = generate a strong one)", "")) || generatedPassword;
  const passwordWasGenerated = adminPassword === generatedPassword;
  const pageId = await ask(rl, "Facebook Page ID (optional, add later if blank)", "");
  const pageName = await ask(rl, "Facebook Page name (optional)", "");
  const pageToken = await ask(rl, "Page access token (optional)", "");

  rl.close();

  if (!name || !adminEmail) {
    console.error("Company name and admin email are required.");
    process.exit(1);
  }

  const company = await prisma.company.create({
    data: {
      name,
      industry,
      website: website || null,
      contact_email: contactEmail || null,
      contact_number: contactNumber || null,
      status: "active"
    }
  });

  await prisma.companySetting.create({
    data: {
      company_id: company.id,
      ai_enabled: true,
      auto_reply_enabled: true,
      human_handoff_enabled: true,
      quotation_mode: "approval_required",
      allow_ai_quotation_drafts: true,
      allow_auto_send_quotation: false,
      quotation_requires_admin_approval: true,
      notify_email: contactEmail || process.env.SEED_ADMIN_EMAIL || null
    }
  });

  await prisma.user.create({
    data: {
      company_id: company.id,
      name: adminName,
      email: adminEmail,
      password_hash: await hashPassword(adminPassword),
      role: "admin",
      status: "active"
    }
  });

  if (pageId && pageToken) {
    await prisma.facebookPage.create({
      data: {
        company_id: company.id,
        page_id: pageId,
        page_name: pageName || name,
        page_access_token_encrypted: encryptSecret(pageToken),
        status: "active"
      }
    });
  }

  const defaultQuestions = [
    ["What service or product do you need quoted?", "service_needed"],
    ["Where is your office or project location?", "location"],
    ["How urgent is this request?", "urgency"],
    ["May I get your company name?", "company_name"],
    ["May I get the contact person's name?", "customer_name"],
    ["What mobile number and email should our team use?", "mobile_number"]
  ];

  for (const [index, [question, field_key]] of defaultQuestions.entries()) {
    await prisma.qualificationQuestion.create({
      data: {
        company_id: company.id,
        question,
        field_key,
        required: true,
        display_order: index + 1,
        active: true
      }
    });
  }

  console.log("\nClient created successfully.");
  console.log(`Company ID: ${company.id}`);
  console.log(`Admin login: ${adminEmail}`);
  console.log(`Password: ${adminPassword}${passwordWasGenerated ? "   <-- generated, shown once, save it now" : ""}`);
  console.log("\nNext steps:");
  console.log("1. Log in at http://localhost:3000/admin/login");
  console.log("2. Add knowledge base entries for this client");
  console.log("3. Connect Facebook Page in Settings (if not added now)");
  console.log("4. Send a test Messenger inquiry");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
