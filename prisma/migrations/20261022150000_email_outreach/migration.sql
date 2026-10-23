-- Email Engine Outreach (2026-10-22): one-to-one AI-drafted prospecting, pace (N every H hours), follow-ups, reply reading, privacy check.
-- AlterTable
ALTER TABLE "email_campaign_recipients" ADD COLUMN     "address_type" TEXT,
ADD COLUMN     "draft_body" TEXT,
ADD COLUMN     "draft_error" TEXT,
ADD COLUMN     "draft_subject" TEXT,
ADD COLUMN     "events" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "message_ids" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "next_step_at" TIMESTAMP(3),
ADD COLUMN     "organization" TEXT,
ADD COLUMN     "outcome" TEXT,
ADD COLUMN     "reason_note" TEXT,
ADD COLUMN     "replied_at" TIMESTAMP(3),
ADD COLUMN     "reply_snippet" TEXT,
ADD COLUMN     "source_note" TEXT,
ADD COLUMN     "step" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "email_campaigns" ADD COLUMN     "brief" TEXT,
ADD COLUMN     "followup_days" INTEGER NOT NULL DEFAULT 4,
ADD COLUMN     "followups" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'broadcast',
ADD COLUMN     "last_sent_at" TIMESTAMP(3),
ADD COLUMN     "pace_count" INTEGER,
ADD COLUMN     "pace_hours" INTEGER,
ADD COLUMN     "pia" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "pia_by" TEXT,
ADD COLUMN     "pia_done_at" TIMESTAMP(3),
ADD COLUMN     "require_review" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "send_window" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "sender_person" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "email_engine_platform" ADD COLUMN     "outreach_enabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "outreach_max_per_day" INTEGER NOT NULL DEFAULT 50,
ADD COLUMN     "protected_domains" TEXT[] DEFAULT ARRAY['aistaff.click']::TEXT[];

-- AlterTable
ALTER TABLE "email_engine_settings" ADD COLUMN     "outreach_config" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "outreach_footer" TEXT,
ADD COLUMN     "outreach_last_error" TEXT,
ADD COLUMN     "outreach_poll" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "outreach_secret" TEXT,
ADD COLUMN     "outreach_tested_at" TIMESTAMP(3),
ADD COLUMN     "outreach_tested_hash" TEXT;

