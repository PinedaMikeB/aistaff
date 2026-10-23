-- Email Engine (2026-10-22): bulk email to many recipients, throttled, with unsubscribe. First block of the Marketing engine.
-- DropIndex
DROP INDEX "leads_company_id_lead_qualification_status_idx";

-- CreateTable
CREATE TABLE "email_engine_settings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "sender_mode" TEXT NOT NULL DEFAULT 'channel',
    "mailbox_config" JSONB NOT NULL DEFAULT '{}',
    "mailbox_secret" TEXT,
    "mailbox_tested_at" TIMESTAMP(3),
    "mailbox_tested_hash" TEXT,
    "reply_to" TEXT,
    "per_minute" INTEGER NOT NULL DEFAULT 10,
    "mailbox_daily_limit" INTEGER NOT NULL DEFAULT 1000,
    "reserve_for_closer" INTEGER NOT NULL DEFAULT 200,
    "footer_text" TEXT,
    "unsubscribe_label" TEXT,
    "test_address" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_engine_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_contacts" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "organization" TEXT,
    "lists" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaigns" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "body_text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "pause_reason" TEXT,
    "from_address" TEXT,
    "total" INTEGER NOT NULL DEFAULT 0,
    "sent_count" INTEGER NOT NULL DEFAULT 0,
    "failed_count" INTEGER NOT NULL DEFAULT 0,
    "skipped_count" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),
    "alerted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_campaigns_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_campaign_recipients" (
    "id" TEXT NOT NULL,
    "campaign_id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "message_id" TEXT,
    "from_address" TEXT,
    "sent_at" TIMESTAMP(3),
    "next_try_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_campaign_recipients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_suppressions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "note" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_suppressions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_engine_platform" (
    "id" TEXT NOT NULL DEFAULT 'global',
    "paused_all" BOOLEAN NOT NULL DEFAULT false,
    "pause_note" TEXT,
    "max_per_minute" INTEGER NOT NULL DEFAULT 30,
    "max_per_day" INTEGER NOT NULL DEFAULT 3000,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "email_engine_platform_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "email_engine_settings_company_id_key" ON "email_engine_settings"("company_id");

-- CreateIndex
CREATE INDEX "email_contacts_company_id_created_at_idx" ON "email_contacts"("company_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_contacts_company_id_email_key" ON "email_contacts"("company_id", "email");

-- CreateIndex
CREATE INDEX "email_campaigns_company_id_created_at_idx" ON "email_campaigns"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "email_campaigns_status_idx" ON "email_campaigns"("status");

-- CreateIndex
CREATE INDEX "email_campaign_recipients_campaign_id_status_idx" ON "email_campaign_recipients"("campaign_id", "status");

-- CreateIndex
CREATE INDEX "email_campaign_recipients_from_address_sent_at_idx" ON "email_campaign_recipients"("from_address", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_campaign_recipients_campaign_id_email_key" ON "email_campaign_recipients"("campaign_id", "email");

-- CreateIndex
CREATE UNIQUE INDEX "email_suppressions_company_id_email_key" ON "email_suppressions"("company_id", "email");

-- AddForeignKey
ALTER TABLE "email_engine_settings" ADD CONSTRAINT "email_engine_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_contacts" ADD CONSTRAINT "email_contacts_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaigns" ADD CONSTRAINT "email_campaigns_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_campaign_recipients" ADD CONSTRAINT "email_campaign_recipients_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "email_campaigns"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_suppressions" ADD CONSTRAINT "email_suppressions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

