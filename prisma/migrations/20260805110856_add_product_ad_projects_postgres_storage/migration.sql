-- CreateTable
CREATE TABLE "product_ad_projects" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "anonymousSessionId" TEXT,
    "userId" TEXT,
    "product" JSONB NOT NULL DEFAULT '{}',
    "templateId" TEXT,
    "styleId" TEXT,
    "templateFields" JSONB NOT NULL DEFAULT '{}',
    "videoFields" JSONB NOT NULL DEFAULT '{}',
    "preview" JSONB,
    "finalAsset" JSONB,
    "creativePlan" JSONB,
    "analysis" JSONB,
    "suggestionDecisions" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "product_ad_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ad_revisions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL,
    "instruction" TEXT,
    "plan" JSONB,
    "svg" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "watermarked" BOOLEAN NOT NULL DEFAULT true,
    "aiUsed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_ad_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "product_ad_image_assets" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "scopeId" TEXT NOT NULL,
    "role" TEXT NOT NULL DEFAULT 'product',
    "url" TEXT NOT NULL,
    "filePath" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "bytes" INTEGER NOT NULL,
    "width" INTEGER,
    "height" INTEGER,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "product_ad_image_assets_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "product_ad_projects_anonymousSessionId_idx" ON "product_ad_projects"("anonymousSessionId");

-- CreateIndex
CREATE INDEX "product_ad_projects_userId_idx" ON "product_ad_projects"("userId");

-- CreateIndex
CREATE INDEX "product_ad_projects_status_idx" ON "product_ad_projects"("status");

-- CreateIndex
CREATE INDEX "product_ad_revisions_projectId_idx" ON "product_ad_revisions"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "product_ad_revisions_projectId_revisionNumber_key" ON "product_ad_revisions"("projectId", "revisionNumber");

-- CreateIndex
CREATE INDEX "product_ad_image_assets_projectId_idx" ON "product_ad_image_assets"("projectId");

-- CreateIndex
CREATE INDEX "product_ad_image_assets_scopeId_idx" ON "product_ad_image_assets"("scopeId");

-- AddForeignKey
ALTER TABLE "product_ad_revisions" ADD CONSTRAINT "product_ad_revisions_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "product_ad_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "product_ad_image_assets" ADD CONSTRAINT "product_ad_image_assets_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "product_ad_projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

