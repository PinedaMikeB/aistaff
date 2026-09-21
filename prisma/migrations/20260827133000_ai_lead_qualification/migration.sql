ALTER TABLE "company_settings"
  ADD COLUMN "lead_qualification_rules" JSONB;

ALTER TABLE "leads"
  ADD COLUMN "lead_qualification_status" TEXT NOT NULL DEFAULT 'unknown',
  ADD COLUMN "lead_qualification_reason" TEXT,
  ADD COLUMN "lead_qualification_confidence" INTEGER,
  ADD COLUMN "lead_next_action" TEXT;

CREATE INDEX "leads_company_id_lead_qualification_status_idx"
  ON "leads"("company_id", "lead_qualification_status");
