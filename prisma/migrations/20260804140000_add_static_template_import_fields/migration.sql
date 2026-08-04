-- Adds fields needed by the real static-template importer
-- (scripts/brandee-import-static-templates.js) that reads the actual PNG
-- assets under Assets/Static Ads Template and creates StaticAdTemplate rows
-- from them: which real example (product vs service) a given template is,
-- a short customer-facing "best for" label, dominant colors sampled from the
-- source image, and a checksum so the importer can be re-run safely without
-- creating duplicate rows for a file it already imported.

ALTER TABLE "static_ad_templates" ADD COLUMN "audienceType" TEXT NOT NULL DEFAULT 'UNIVERSAL';
ALTER TABLE "static_ad_templates" ADD COLUMN "idealFor" TEXT;
ALTER TABLE "static_ad_templates" ADD COLUMN "dominantColors" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "static_ad_templates" ADD COLUMN "sourceChecksum" TEXT;
ALTER TABLE "static_ad_templates" ADD COLUMN "importedFromFilename" TEXT;

CREATE INDEX "static_ad_templates_sourceChecksum_idx" ON "static_ad_templates"("sourceChecksum");
