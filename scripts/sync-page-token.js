#!/usr/bin/env node
require("dotenv").config({ override: true });

const { PrismaClient } = require("@prisma/client");
const { encryptSecret } = require("../src/crypto");

const prisma = new PrismaClient();

async function main() {
  const token = process.env.META_PAGE_ACCESS_TOKEN;
  const pageId = process.env.META_PAGE_ID;
  if (!token || !pageId) {
    console.error("META_PAGE_ACCESS_TOKEN and META_PAGE_ID are required.");
    process.exit(1);
  }

  const encrypted = encryptSecret(token);
  const page = await prisma.facebookPage.upsert({
    where: { page_id: pageId },
    create: {
      company_id: "00000000-0000-0000-0000-000000000001",
      page_id: pageId,
      page_name: "AIStaff Facebook Page",
      page_access_token_encrypted: encrypted,
      status: "active"
    },
    update: {
      page_access_token_encrypted: encrypted,
      status: "active"
    }
  });

  console.log(`Re-encrypted page token for ${page.page_name} (${page.page_id}).`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
