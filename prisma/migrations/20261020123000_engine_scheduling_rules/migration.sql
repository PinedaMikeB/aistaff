ALTER TABLE "tenant_engines" ADD COLUMN "scheduling_rules" JSONB NOT NULL DEFAULT '{}';
UPDATE "tenant_engines" te SET "scheduling_rules" = cs."scheduling_settings"
  FROM "company_settings" cs, "business_engines" be
 WHERE te."company_id" = cs."company_id" AND te."engine_id" = be."id" AND be."key" = 'customer_service'
   AND cs."scheduling_settings" <> '{}'::jsonb;
ALTER TABLE "company_settings" DROP COLUMN "scheduling_settings";
