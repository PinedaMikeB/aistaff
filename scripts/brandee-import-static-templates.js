#!/usr/bin/env node
// Brandee static-ad template importer (PART 3).
//
// Reads real template source images from a LOCAL folder (never hard-coded
// into runtime — this only ever runs as a one-off/rerunnable CLI script) and
// turns them into StaticAdTemplate rows the public gallery and Super Admin
// can actually manage. Safe to re-run: every file is deduped by a SHA-256
// checksum of its bytes, so re-running after the source folder is deleted,
// moved, or re-copied never creates duplicate rows.
//
// Usage:
//   node scripts/brandee-import-static-templates.js --source="/absolute/path/to/Assets/Static Ads Template"
//   npm run brandee:import-static-templates -- --source="..."
//
// What it does, in order:
//   1. Lists the source folder, skipping hidden/OS files (.DS_Store, etc.)
//      and anything that isn't a real PNG/JPEG/WebP (checked by magic bytes,
//      not just extension).
//   2. For each valid file, computes a SHA-256 checksum. If a StaticAdTemplate
//      row with that exact checksum already exists, the file is SKIPPED
//      (already imported) — nothing is re-copied or re-inserted.
//   3. Otherwise, classifies the file. This importer ships with an exact,
//      hand-verified classification table (CLASSIFICATION below) built by
//      actually looking at every image in this project's source folder —
//      not by guessing from the filename. Any file NOT in that table (e.g. a
//      brand-new file dropped in later) falls back to a low-confidence
//      filename heuristic and is imported as DRAFT with a warning, per PART
//      4's "if confidence is low, import as DRAFT and flag for review" rule.
//   4. Copies the source image into this app's own approved static storage
//      (public/agents/brandee/assets/templates/imported/<slug>/), converted
//      to WebP (source: max 1600px wide, thumbnail: 480px wide) via `sharp`
//      — the ORIGINAL file on the local filesystem is never referenced by
//      the running app, only these copies are.
//   5. Creates one StaticAdTemplate row per image, inheriting the field
//      schema / proof requirements already defined in imageAdTemplates.js
//      for that image's framework (never duplicating that definition), and
//      starting at status DRAFT (a Super Admin must explicitly activate it —
//      see scripts/brandee-activate-imported-templates.js).
//   6. Prints a summary: files found, imported, skipped (duplicate),
//      skipped (invalid), and any low-confidence imports that need review.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const sharp = require("sharp");

const { prisma } = require("../src/db");
const { IMAGE_AD_TEMPLATES } = require("../src/brandee/imageAdTemplates");
const { defaultOverlaySchema } = require("../src/brandee/templateSeedData");

const VALID_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);
const STORAGE_ROOT = path.join(__dirname, "..", "public", "agents", "brandee", "assets", "templates", "imported");

// Maps a source-image framework -> the existing code-level template whose
// field schema / proof requirements this image should inherit (PART 3.7 —
// "assigns template family", never duplicating the schema that already
// exists in imageAdTemplates.js for that framework).
const FRAMEWORK_TO_TEMPLATE_ID = {
  bold_claim: "bold_claim",
  iphone_notes: "iphone_notes",
  features_and_benefits: "feature_benefit",
  before_and_after: "before_and_after",
  offer: "offer_promo",
  testimonial: "testimonial_style",
  question: "question_ad",
  reasons_why: "reasons_why",
  sticky_notes: "sticky_notes",
  us_vs_them: "comparison"
};

const FRAMEWORK_LABELS = {
  bold_claim: "Bold Claim",
  iphone_notes: "iPhone Notes",
  features_and_benefits: "Features & Benefits",
  before_and_after: "Before & After",
  offer: "Offer",
  testimonial: "Testimonial",
  question: "Question",
  reasons_why: "Reasons Why",
  sticky_notes: "Sticky Notes",
  us_vs_them: "Us vs Them"
};

// Hand-verified classification (PART 4: "Do not rely only on filenames if
// the visual content ... provides a better classification" — every one of
// these was confirmed by actually viewing the image, not guessed). Keyed by
// the exact filename found in this project's source folder at the time this
// importer was written.
const CLASSIFICATION = {
  "5 reasons why template 1.png": { frameworkKey: "reasons_why", audienceType: "PRODUCT", title: "Reasons Why — Portable Blender", idealFor: "Products with several distinct, listable benefits", tags: ["colorful", "recommended"] },
  "5 reasons why template 2.png": { frameworkKey: "reasons_why", audienceType: "SERVICE", title: "Reasons Why — Mobile Car Wash", idealFor: "Local services with clear convenience benefits", tags: ["colorful"] },
  "Befroe and after template 1.png": { frameworkKey: "before_and_after", audienceType: "PRODUCT", title: "Before & After — Home Organizer", idealFor: "Products with a genuine, demonstrable before/after result", tags: ["lifestyle", "recommended"] },
  "before and after template 2.png": { frameworkKey: "before_and_after", audienceType: "PRODUCT", title: "Before & After — Skincare", idealFor: "Skincare/beauty products with real customer-supplied before/after photos and a 'results may vary' disclosure", tags: ["lifestyle"] },
  "before and after template 3.png": { frameworkKey: "before_and_after", audienceType: "SERVICE", title: "Before & After — Car Detailing", idealFor: "Services with a visually obvious before/after result", tags: ["lifestyle"] },
  "Bold Claim template 1.png": { frameworkKey: "bold_claim", audienceType: "PRODUCT", title: "Bold Claim — Mini Fan", idealFor: "Products with one strong, defensible standout claim", tags: ["minimal", "recommended"] },
  "Bold Claim Template 2.png": { frameworkKey: "bold_claim", audienceType: "SERVICE", title: "Bold Claim — Office Printer Rental", idealFor: "B2B services with one strong value proposition", tags: ["minimal"] },
  "Features and benefits template 2.png": { frameworkKey: "features_and_benefits", audienceType: "SERVICE", title: "Features & Benefits — Accounting Service", idealFor: "Services with several features that map to clear customer benefits", tags: ["educational", "recommended"] },
  "features and benefit template 1.png": { frameworkKey: "features_and_benefits", audienceType: "PRODUCT", title: "Features & Benefits — Wireless Earbuds", idealFor: "Products with several features that map to clear customer benefits", tags: ["minimal"] },
  "Iphone notes template 1.png": { frameworkKey: "iphone_notes", audienceType: "PRODUCT", title: "iPhone Notes — Insulated Tumbler", idealFor: "Products with 3-5 concrete, specific reasons to switch", tags: ["recommended"] },
  "Iphone notes template 2.png": { frameworkKey: "iphone_notes", audienceType: "SERVICE", title: "iPhone Notes — Dental Clinic", idealFor: "Local services with 3-5 concrete reasons to book", tags: [] },
  "Offer template 1.png": { frameworkKey: "offer", audienceType: "PRODUCT", title: "Offer — Snack Bundle", idealFor: "Products with a real, current discount or bundle offer", tags: ["promotion", "recommended"] },
  "Offer template 2.png": { frameworkKey: "offer", audienceType: "SERVICE", title: "Offer — Wellness Massage", idealFor: "Services with a real, current promotional offer", tags: ["promotion"] },
  "Question Template 1.png": { frameworkKey: "question", audienceType: "PRODUCT", title: "Question — Commuter Backpack", idealFor: "Products where a relatable question drives the decision", tags: ["problem-and-solution", "recommended"] },
  "Question Template 2.png": { frameworkKey: "question", audienceType: "SERVICE", title: "Question — Aircon Cleaning", idealFor: "Local services where a relatable problem/question drives bookings", tags: ["problem-and-solution"] },
  "Sticky notes template 1.png": { frameworkKey: "sticky_notes", audienceType: "SERVICE", title: "Sticky Notes — Laundry Pickup", idealFor: "Everyday services with a handful of short, likeable selling points", tags: ["colorful"] },
  "Sticky notes template 2.png": { frameworkKey: "sticky_notes", audienceType: "PRODUCT", title: "Sticky Notes — Meal Prep Containers", idealFor: "Everyday products with a handful of short, likeable selling points", tags: ["colorful", "recommended"] },
  "Testimonial template 1.png": { frameworkKey: "testimonial", audienceType: "SERVICE", title: "Testimonial — Home Renovation", idealFor: "Services with at least one genuine, verifiable customer quote", tags: ["social-proof"] },
  "Testimonial template 2.png": { frameworkKey: "testimonial", audienceType: "PRODUCT", title: "Testimonial — Pet Shampoo", idealFor: "Products with at least one genuine, verifiable customer quote", tags: ["social-proof", "recommended"] },
  "Us and them template 1.png": { frameworkKey: "us_vs_them", audienceType: "PRODUCT", title: "Us vs Them — Insulated Tumbler", idealFor: "Products with a genuine, provable advantage over the ordinary alternative", tags: ["comparison", "recommended"] },
  "us vs them tamplate 2.png": { frameworkKey: "us_vs_them", audienceType: "SERVICE", title: "Us vs Them — Cleaning Service", idealFor: "Services with a genuine, provable advantage over typical competitors", tags: ["comparison"] }
};

function parseArgs(argv) {
  const args = { source: null };
  for (const arg of argv.slice(2)) {
    const match = arg.match(/^--source=(.*)$/);
    if (match) args.source = match[1].replace(/^["']|["']$/g, "");
  }
  return args;
}

function sniffImageType(buffer) {
  if (buffer.length >= 8 && buffer[0] === 0x89 && buffer[1] === 0x50 && buffer[2] === 0x4e && buffer[3] === 0x47) return "png";
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return "jpeg";
  if (buffer.length >= 12 && buffer.toString("ascii", 0, 4) === "RIFF" && buffer.toString("ascii", 8, 12) === "WEBP") return "webp";
  return null;
}

function slugify(text) {
  return String(text || "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
}

function classify(filename) {
  const exact = CLASSIFICATION[filename];
  if (exact) return { ...exact, confidence: "high" };

  // Low-confidence fallback for any file this importer wasn't specifically
  // taught about — PART 4: import as DRAFT and flag for review rather than
  // guessing a framework it might not actually match.
  const lower = filename.toLowerCase();
  const guess = Object.keys(FRAMEWORK_LABELS).find((key) => lower.includes(key.replace(/_/g, " ")) || lower.includes(key.replace(/_/g, "")));
  return {
    frameworkKey: guess || null,
    audienceType: "UNIVERSAL",
    title: filename.replace(/\.[^.]+$/, ""),
    idealFor: null,
    tags: [],
    confidence: "low"
  };
}

async function toDominantHex(buffer) {
  try {
    const { dominant } = await sharp(buffer).stats();
    const hex = (n) => n.toString(16).padStart(2, "0");
    return `#${hex(dominant.r)}${hex(dominant.g)}${hex(dominant.b)}`;
  } catch {
    return null;
  }
}

async function importOne(filePath, filename, report) {
  const buffer = fs.readFileSync(filePath);
  const detectedType = sniffImageType(buffer);
  if (!detectedType) {
    report.skippedInvalid.push({ filename, reason: "not a recognizable PNG/JPEG/WebP file" });
    return;
  }

  const checksum = crypto.createHash("sha256").update(buffer).digest("hex");
  const existing = await prisma.staticAdTemplate.findFirst({ where: { sourceChecksum: checksum } });
  if (existing) {
    report.skippedDuplicate.push({ filename, existingSlug: existing.slug });
    return;
  }

  const classification = classify(filename);
  const templateId = classification.frameworkKey ? FRAMEWORK_TO_TEMPLATE_ID[classification.frameworkKey] : null;
  const codeTemplate = templateId ? IMAGE_AD_TEMPLATES.find((t) => t.id === templateId) : null;

  const baseSlug = slugify(`${classification.frameworkKey || "template"}_${classification.audienceType}_${filename.replace(/\.[^.]+$/, "")}`);
  let slug = baseSlug;
  let n = 1;
  while (await prisma.staticAdTemplate.findFirst({ where: { slug } })) { slug = `${baseSlug}_${n}`; n += 1; }

  const dominant = await toDominantHex(buffer);

  const dir = path.join(STORAGE_ROOT, slug);
  fs.mkdirSync(dir, { recursive: true });
  const sourcePath = path.join(dir, "source.webp");
  const thumbPath = path.join(dir, "thumb.webp");
  await sharp(buffer).resize({ width: 1600, withoutEnlargement: true }).webp({ quality: 90 }).toFile(sourcePath);
  await sharp(buffer).resize({ width: 480, withoutEnlargement: true }).webp({ quality: 78 }).toFile(thumbPath);

  const publicSourceUrl = `/agents/brandee/assets/templates/imported/${slug}/source.webp`;
  const publicThumbUrl = `/agents/brandee/assets/templates/imported/${slug}/thumb.webp`;

  const row = await prisma.staticAdTemplate.create({
    data: {
      slug,
      name: classification.title,
      description: codeTemplate?.description || `A ${FRAMEWORK_LABELS[classification.frameworkKey] || "custom"}-style ad, imported from a real design example.`,
      category: FRAMEWORK_LABELS[classification.frameworkKey] || classification.title,
      frameworkKey: classification.frameworkKey,
      audienceType: classification.audienceType,
      idealFor: classification.idealFor,
      dominantColors: dominant ? [dominant] : [],
      sourceChecksum: checksum,
      importedFromFilename: filename,
      previewImageUrl: publicThumbUrl,
      thumbnailUrl: publicThumbUrl,
      sourceAssetUrl: publicSourceUrl,
      overlaySchema: defaultOverlaySchema(),
      requiredFieldsSchema: codeTemplate ? codeTemplate.fields.filter((f) => f.required) : [],
      optionalFieldsSchema: codeTemplate ? codeTemplate.fields.filter((f) => !f.required) : [],
      proofRequirements: codeTemplate?.proofRequirement ? [codeTemplate.proofRequirement] : [],
      supportedAspectRatios: ["4:5"],
      defaultAspectRatio: "4:5",
      renderMode: "COMPOSITE_TEMPLATE",
      tags: classification.tags || [],
      status: "DRAFT",
      isFeatured: false,
      isPremium: false
    }
  });

  report.imported.push({ filename, slug: row.slug, frameworkKey: classification.frameworkKey, audienceType: classification.audienceType, confidence: classification.confidence });
  if (classification.confidence === "low") report.lowConfidence.push({ filename, slug: row.slug });
}

async function main() {
  const args = parseArgs(process.argv);
  const source = args.source;
  if (!source) {
    console.error("Usage: node scripts/brandee-import-static-templates.js --source=\"/absolute/path/to/source/folder\"");
    process.exit(1);
  }
  if (!fs.existsSync(source) || !fs.statSync(source).isDirectory()) {
    console.error(`Source folder not found: ${source}`);
    process.exit(1);
  }

  const entries = fs.readdirSync(source);
  const report = { totalFound: 0, imported: [], skippedDuplicate: [], skippedInvalid: [], lowConfidence: [] };

  for (const entry of entries) {
    if (entry.startsWith(".")) continue; // .DS_Store and other hidden/OS files
    const filePath = path.join(source, entry);
    if (!fs.statSync(filePath).isFile()) continue;
    const ext = path.extname(entry).toLowerCase();
    if (!VALID_EXTENSIONS.has(ext)) { report.skippedInvalid.push({ filename: entry, reason: `unsupported extension ${ext}` }); continue; }
    report.totalFound += 1;
    try {
      await importOne(filePath, entry, report);
    } catch (error) {
      report.skippedInvalid.push({ filename: entry, reason: error.message });
    }
  }

  console.log("\nBrandee static template import — summary");
  console.log(`  Source folder:        ${source}`);
  console.log(`  Valid files found:    ${report.totalFound}`);
  console.log(`  Imported (new DRAFT): ${report.imported.length}`);
  console.log(`  Skipped (duplicate):  ${report.skippedDuplicate.length}`);
  console.log(`  Skipped (invalid):    ${report.skippedInvalid.length}`);
  if (report.imported.length) {
    console.log("\n  Imported:");
    for (const item of report.imported) console.log(`    - ${item.filename} -> ${item.slug} (${item.frameworkKey || "unclassified"}, ${item.audienceType}, confidence: ${item.confidence})`);
  }
  if (report.skippedDuplicate.length) {
    console.log("\n  Skipped (already imported):");
    for (const item of report.skippedDuplicate) console.log(`    - ${item.filename} (matches existing template ${item.existingSlug})`);
  }
  if (report.skippedInvalid.length) {
    console.log("\n  Skipped (invalid):");
    for (const item of report.skippedInvalid) console.log(`    - ${item.filename}: ${item.reason}`);
  }
  if (report.lowConfidence.length) {
    console.log("\n  LOW CONFIDENCE — flagged for Super Admin review before activating:");
    for (const item of report.lowConfidence) console.log(`    - ${item.filename} -> ${item.slug}`);
  }
  console.log("\nAll imported templates start as DRAFT and are not publicly visible until a Super Admin (or scripts/brandee-activate-imported-templates.js) activates them.\n");

  await prisma.$disconnect();
}

// Only run the CLI (which connects to Prisma and touches the filesystem)
// when this file is executed directly — `require`-ing it from a test for its
// pure helper functions (slugify/classify/sniffImageType) must never trigger
// a real import run or a database connection attempt.
if (require.main === module) {
  main().catch(async (error) => {
    console.error("Import failed:", error);
    await prisma.$disconnect();
    process.exit(1);
  });
}

module.exports = {
  sniffImageType,
  slugify,
  classify,
  toDominantHex,
  parseArgs,
  CLASSIFICATION,
  FRAMEWORK_TO_TEMPLATE_ID,
  FRAMEWORK_LABELS
};
