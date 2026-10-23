#!/usr/bin/env node
/**
 * Create (or replace) a tenant's inbound alert key for POST /api/hooks/tenant-alert.
 *   node scripts/tenant-alert-key.js <company_id>
 * Prints the key ONCE (only its sha256 is stored). Put it in the tenant system's server
 * environment, never in a browser.
 */
const crypto = require("crypto");
const { prisma } = require("../src/db");
(async () => {
  const companyId = process.argv[2];
  if (!companyId) { console.error("usage: node scripts/tenant-alert-key.js <company_id>"); process.exit(1); }
  const key = `ais_hook_${crypto.randomBytes(24).toString("hex")}`;
  await prisma.companySetting.update({ where: { company_id: companyId }, data: { alert_hook_key_hash: crypto.createHash("sha256").update(key).digest("hex") } });
  process.stdout.write(key);
  process.exit(0);
})().catch((error) => { console.error(error.message); process.exit(1); });
