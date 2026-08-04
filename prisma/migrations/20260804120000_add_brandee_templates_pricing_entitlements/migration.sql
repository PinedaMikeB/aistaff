-- CreateTable
CREATE TABLE "static_ad_templates" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "frameworkKey" TEXT,
    "previewImageUrl" TEXT,
    "thumbnailUrl" TEXT,
    "sourceAssetUrl" TEXT,
    "overlaySchema" JSONB NOT NULL DEFAULT '{}',
    "requiredFieldsSchema" JSONB NOT NULL DEFAULT '[]',
    "optionalFieldsSchema" JSONB NOT NULL DEFAULT '[]',
    "proofRequirements" JSONB NOT NULL DEFAULT '[]',
    "supportedAspectRatios" JSONB NOT NULL DEFAULT '[]',
    "defaultAspectRatio" TEXT NOT NULL DEFAULT '4:5',
    "defaultLanguage" TEXT NOT NULL DEFAULT 'english',
    "renderMode" TEXT NOT NULL DEFAULT 'COMPOSITE_TEMPLATE',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentTemplateId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdByPlatformUserId" TEXT,
    "updatedByPlatformUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "static_ad_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "static_ad_templates_slug_idx" ON "static_ad_templates"("slug");

-- CreateIndex
CREATE INDEX "static_ad_templates_status_idx" ON "static_ad_templates"("status");

-- CreateIndex
CREATE INDEX "static_ad_templates_category_idx" ON "static_ad_templates"("category");

-- CreateIndex
CREATE INDEX "static_ad_templates_parentTemplateId_idx" ON "static_ad_templates"("parentTemplateId");

-- CreateTable
CREATE TABLE "ugc_templates" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "previewPosterUrl" TEXT,
    "previewVideoUrl" TEXT,
    "sourceAssetUrl" TEXT,
    "storyboardSchema" JSONB NOT NULL DEFAULT '{}',
    "sceneSchema" JSONB NOT NULL DEFAULT '[]',
    "creatorRequirements" JSONB NOT NULL DEFAULT '{}',
    "voiceRequirements" JSONB NOT NULL DEFAULT '{}',
    "scriptSchema" JSONB NOT NULL DEFAULT '{}',
    "requiredFieldsSchema" JSONB NOT NULL DEFAULT '[]',
    "optionalFieldsSchema" JSONB NOT NULL DEFAULT '[]',
    "proofRequirements" JSONB NOT NULL DEFAULT '[]',
    "supportedDurations" JSONB NOT NULL DEFAULT '[]',
    "supportedAspectRatios" JSONB NOT NULL DEFAULT '[]',
    "supportedLanguages" JSONB NOT NULL DEFAULT '[]',
    "modelProvider" TEXT,
    "providerConfiguration" JSONB NOT NULL DEFAULT '{}',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "isFeatured" BOOLEAN NOT NULL DEFAULT false,
    "isPremium" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 1,
    "parentTemplateId" TEXT,
    "publishedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),
    "createdByPlatformUserId" TEXT,
    "updatedByPlatformUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "ugc_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ugc_templates_slug_idx" ON "ugc_templates"("slug");

-- CreateIndex
CREATE INDEX "ugc_templates_status_idx" ON "ugc_templates"("status");

-- CreateIndex
CREATE INDEX "ugc_templates_category_idx" ON "ugc_templates"("category");

-- CreateIndex
CREATE INDEX "ugc_templates_parentTemplateId_idx" ON "ugc_templates"("parentTemplateId");

-- CreateTable
CREATE TABLE "brandee_pricing_configs" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "taxMode" TEXT NOT NULL DEFAULT 'NON_VAT',
    "pricesAreTaxInclusive" BOOLEAN NOT NULL DEFAULT true,
    "vatRatePercent" DECIMAL(5,2) NOT NULL DEFAULT 12,
    "plans" JSONB NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdByPlatformUserId" TEXT,
    "updatedByPlatformUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "brandee_pricing_configs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "brandee_pricing_configs_status_idx" ON "brandee_pricing_configs"("status");

-- CreateTable
CREATE TABLE "brandee_entitlement_events" (
    "id" TEXT NOT NULL,
    "customer_id" TEXT NOT NULL,
    "subscription_id" TEXT,
    "unit" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "projectId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "brandee_entitlement_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "brandee_entitlement_events_idempotencyKey_key" ON "brandee_entitlement_events"("idempotencyKey");

-- CreateIndex
CREATE INDEX "brandee_entitlement_events_customer_id_unit_idx" ON "brandee_entitlement_events"("customer_id", "unit");

-- CreateIndex
CREATE INDEX "brandee_entitlement_events_subscription_id_idx" ON "brandee_entitlement_events"("subscription_id");

-- CreateIndex
CREATE INDEX "brandee_entitlement_events_idempotencyKey_idx" ON "brandee_entitlement_events"("idempotencyKey");

-- AddForeignKey
ALTER TABLE "brandee_entitlement_events" ADD CONSTRAINT "brandee_entitlement_events_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
