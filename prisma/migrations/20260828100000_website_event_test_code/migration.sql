ALTER TABLE "website_events"
ADD COLUMN "test_event_code" TEXT;

CREATE INDEX "website_events_company_id_test_event_code_idx"
ON "website_events"("company_id", "test_event_code");
