ALTER TABLE "leads" ADD COLUMN "source_channel" TEXT;
ALTER TABLE "leads" ADD COLUMN "source_label" TEXT;
ALTER TABLE "leads" ADD COLUMN "source_url" TEXT;
ALTER TABLE "leads" ADD COLUMN "landing_page" TEXT;
ALTER TABLE "leads" ADD COLUMN "referrer" TEXT;
ALTER TABLE "leads" ADD COLUMN "utm_source" TEXT;
ALTER TABLE "leads" ADD COLUMN "utm_medium" TEXT;
ALTER TABLE "leads" ADD COLUMN "utm_campaign" TEXT;
ALTER TABLE "leads" ADD COLUMN "utm_content" TEXT;
ALTER TABLE "leads" ADD COLUMN "utm_term" TEXT;
ALTER TABLE "leads" ADD COLUMN "fbclid" TEXT;
ALTER TABLE "leads" ADD COLUMN "gclid" TEXT;
ALTER TABLE "leads" ADD COLUMN "visitor_id" TEXT;
ALTER TABLE "leads" ADD COLUMN "first_seen_at" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "last_touch_at" TIMESTAMP(3);
ALTER TABLE "leads" ADD COLUMN "touch_count" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "website_events" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "lead_id" TEXT,
  "conversation_id" TEXT,
  "visitor_id" TEXT NOT NULL,
  "session_id" TEXT,
  "event_name" TEXT NOT NULL,
  "source_page" TEXT,
  "page_url" TEXT,
  "path" TEXT,
  "referrer" TEXT,
  "utm_source" TEXT,
  "utm_medium" TEXT,
  "utm_campaign" TEXT,
  "utm_content" TEXT,
  "utm_term" TEXT,
  "fbclid" TEXT,
  "gclid" TEXT,
  "ip_hash" TEXT,
  "user_agent" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "website_events_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "leads_company_id_source_channel_idx" ON "leads"("company_id", "source_channel");
CREATE INDEX "leads_company_id_utm_campaign_idx" ON "leads"("company_id", "utm_campaign");
CREATE INDEX "leads_company_id_visitor_id_idx" ON "leads"("company_id", "visitor_id");
CREATE INDEX "website_events_company_id_created_at_idx" ON "website_events"("company_id", "created_at");
CREATE INDEX "website_events_company_id_visitor_id_idx" ON "website_events"("company_id", "visitor_id");
CREATE INDEX "website_events_lead_id_created_at_idx" ON "website_events"("lead_id", "created_at");
CREATE INDEX "website_events_conversation_id_created_at_idx" ON "website_events"("conversation_id", "created_at");

ALTER TABLE "website_events" ADD CONSTRAINT "website_events_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "website_events" ADD CONSTRAINT "website_events_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "website_events" ADD CONSTRAINT "website_events_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
