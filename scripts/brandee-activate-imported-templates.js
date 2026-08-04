#!/usr/bin/env node
// Activates DRAFT StaticAdTemplate rows created by
// brandee-import-static-templates.js, using the exact same audit-logged
// setStatus() path the Super Admin UI itself uses (src/admin/brandeeTemplates.js)
// — this script is a CLI convenience for a bulk first activation, not a
// separate/parallel admin system. Every activated row is still fully
// editable and re-manageable afterward at /superadmin/brandee/templates/static.
//
// Usage:
//   node scripts/brandee-activate-imported-templates.js --actor-email=you@example.com [--only-high-confidence]
//
// Requires an existing account with platform_role SUPERADMIN or
// SUPPORT_ADMIN (the same authorization boundary the HTTP admin routes
// enforce) — refuses to run otherwise, and never activates anything
// silently without a real, attributable actor for the audit trail.

require("dotenv").config({ override: true });
const { prisma } = require("../src/db");
const { setStatus } = require("../src/admin/brandeeTemplates");
const { recordAuditEvent, AUDIT_ACTIONS } = require("../src/admin/auditLog");

function parseArgs(argv) {
  const args = { actorEmail: null, onlyHighConfidence: false };
  for (const arg of argv.slice(2)) {
    const emailMatch = arg.match(/^--actor-email=(.*)$/);
    if (emailMatch) args.actorEmail = emailMatch[1];
    if (arg === "--only-high-confidence") args.onlyHighConfidence = true;
  }
  return args;
}

async function main() {
  const { actorEmail, onlyHighConfidence } = parseArgs(process.argv);
  if (!actorEmail) {
    console.error("Usage: node scripts/brandee-activate-imported-templates.js --actor-email=you@example.com");
    process.exit(1);
  }

  const actor = await prisma.user.findUnique({ where: { email: actorEmail } });
  if (!actor || !["SUPERADMIN", "SUPPORT_ADMIN"].includes(actor.platform_role)) {
    console.error(`No SUPERADMIN/SUPPORT_ADMIN account found for ${actorEmail}. Refusing to activate templates without a real, authorized actor.`);
    process.exit(1);
  }

  const drafts = await prisma.staticAdTemplate.findMany({ where: { status: "DRAFT", importedFromFilename: { not: null } } });
  if (!drafts.length) {
    console.log("No imported DRAFT templates found to activate.");
    await prisma.$disconnect();
    return;
  }

  let activated = 0;
  let skippedLowConfidence = 0;
  for (const template of drafts) {
    if (onlyHighConfidence && !template.frameworkKey) { skippedLowConfidence += 1; continue; }
    await setStatus("static", template.id, "ACTIVE", actor.id);
    await recordAuditEvent({
      actorUserId: actor.id,
      actorRole: actor.platform_role,
      action: AUDIT_ACTIONS.STATIC_TEMPLATE_ACTIVATED,
      targetType: "StaticAdTemplate",
      targetId: template.id,
      metadata: { slug: template.slug, source: "brandee-activate-imported-templates.js" }
    });
    activated += 1;
    console.log(`Activated: ${template.slug} (${template.name})`);
  }

  console.log(`\nDone. Activated ${activated} of ${drafts.length} imported template(s).${skippedLowConfidence ? ` Skipped ${skippedLowConfidence} unclassified (low-confidence) template(s) — review them manually at /superadmin/brandee/templates/static.` : ""}`);
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("Activation failed:", error);
  await prisma.$disconnect();
  process.exit(1);
});
