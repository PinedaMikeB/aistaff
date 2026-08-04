// Super Admin pricing/allowance management (PART 20). Draft/publish
// workflow: an edit creates or updates a DRAFT row; publishing sets that row
// to "published" and archives whatever was previously published, so there
// is always at most one published row (what getEffectivePricing() reads)
// and a full history of prior published configurations for audit/rollback.

const { prisma } = require("../db");
const { z } = require("zod");
const pricingConfig = require("../brandee/pricingConfig");

const PlanOverride = z.object({
  slug: z.string().min(1),
  name: z.string().min(1),
  monthlyPrice: z.number().positive(),
  currency: z.string().default("PHP"),
  entitlements: z.object({ IMAGE_FINAL: z.number().int().min(0), VIDEO_SECONDS: z.number().int().min(0) }),
  limits: z.object({ brandKits: z.number().int().min(0), savedProducts: z.number().int().min(0), aspectRatios: z.array(z.string()), priorityRendering: z.boolean() }),
  features: z.array(z.string()).default([]),
  featured: z.boolean().default(false),
  visible: z.boolean().default(true),
  sortOrder: z.number().int().default(0)
});

const PricingConfigInput = z.object({
  taxMode: z.enum(pricingConfig.TAX_MODES),
  pricesAreTaxInclusive: z.boolean(),
  vatRatePercent: z.number().min(0).max(25),
  plans: z.array(PlanOverride).min(1)
});

async function getLatestDraft() {
  return prisma.brandeePricingConfig.findFirst({ where: { status: "draft" }, orderBy: { updatedAt: "desc" } });
}

async function getPublished() {
  return prisma.brandeePricingConfig.findFirst({ where: { status: "published" }, orderBy: { publishedAt: "desc" } });
}

async function listHistory({ limit = 50 } = {}) {
  return prisma.brandeePricingConfig.findMany({ orderBy: { createdAt: "desc" }, take: Math.min(Math.max(Number(limit) || 50, 1), 200) });
}

/**
 * Creates or updates the current draft. Never touches the published row —
 * a draft is fully safe to edit repeatedly before publishing.
 */
async function saveDraft(input, actorUserId) {
  const data = PricingConfigInput.parse(input);
  const existingDraft = await getLatestDraft();
  if (existingDraft) {
    return prisma.brandeePricingConfig.update({
      where: { id: existingDraft.id },
      data: { ...data, updatedByPlatformUserId: actorUserId }
    });
  }
  return prisma.brandeePricingConfig.create({
    data: { ...data, status: "draft", createdByPlatformUserId: actorUserId, updatedByPlatformUserId: actorUserId }
  });
}

/**
 * Publishes a draft: the previously published row (if any) is archived, and
 * this draft becomes the new published row. Runtime pricing reads flip over
 * atomically (a single findFirst by status).
 */
async function publishDraft(draftId, actorUserId) {
  const draft = await prisma.brandeePricingConfig.findUnique({ where: { id: draftId } });
  if (!draft) throw new Error("Draft not found.");
  if (draft.status !== "draft") throw new Error("Only a draft configuration can be published.");

  const previouslyPublished = await getPublished();

  const [, published] = await prisma.$transaction([
    previouslyPublished
      ? prisma.brandeePricingConfig.update({ where: { id: previouslyPublished.id }, data: { status: "archived" } })
      : prisma.brandeePricingConfig.count({ where: { id: "no-op" } }),
    prisma.brandeePricingConfig.update({ where: { id: draftId }, data: { status: "published", publishedAt: new Date(), updatedByPlatformUserId: actorUserId } })
  ]);

  return published;
}

module.exports = { PricingConfigInput, getLatestDraft, getPublished, listHistory, saveDraft, publishDraft };
