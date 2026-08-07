#!/usr/bin/env node
// Backfills static_ad_templates.imageGenPrompt from the per-framework art
// direction in src/brandee/templateImagePrompts.js and flips those rows to
// renderMode = AI_GENERATED_LAYOUT.
//
// Safe to rerun: it only writes rows whose framework has a prompt, and by
// default it does NOT overwrite a prompt that is already set (a Super Admin
// may have edited it). Pass --force to overwrite.
//
// Usage:
//   node scripts/brandee-backfill-template-image-prompts.js          # dry run
//   node scripts/brandee-backfill-template-image-prompts.js --apply
//   node scripts/brandee-backfill-template-image-prompts.js --apply --force

require("dotenv").config();
const { prisma } = require("../src/db");
const { imagePromptForFramework } = require("../src/brandee/templateImagePrompts");

const apply = process.argv.includes("--apply");
const force = process.argv.includes("--force");

async function main() {
  const rows = await prisma.staticAdTemplate.findMany({
    where: { status: "ACTIVE" },
    select: { id: true, slug: true, frameworkKey: true, imageGenPrompt: true, renderMode: true },
    orderBy: { slug: "asc" }
  });

  let updated = 0;
  let skippedExisting = 0;
  let noPrompt = 0;

  for (const row of rows) {
    const prompt = imagePromptForFramework(row.frameworkKey);
    if (!prompt) { noPrompt += 1; continue; }
    if (row.imageGenPrompt && !force) { skippedExisting += 1; continue; }

    console.log(`${apply ? "UPDATE" : "would update"}  ${row.slug}  (${row.frameworkKey})`);
    if (apply) {
      await prisma.staticAdTemplate.update({
        where: { id: row.id },
        data: { imageGenPrompt: prompt, renderMode: "AI_GENERATED_LAYOUT" }
      });
    }
    updated += 1;
  }

  console.log(`\n${apply ? "Applied" : "Dry run"}: ${updated} template(s) with art direction, ${skippedExisting} already had a prompt, ${noPrompt} framework(s) have no prompt yet (stay on the SVG compositor).`);
  if (!apply) console.log("Rerun with --apply to write these changes.");
}

main()
  .catch((error) => { console.error(error); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
