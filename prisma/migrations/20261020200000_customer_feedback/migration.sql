-- After-service follow-up (2026-10-20): completion check right after a job is closed/delivered,
-- and a satisfaction survey whose frequency is set per topic (Customer Service engine settings).
ALTER TABLE "tenant_engines" ADD COLUMN "feedback_rules" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "customer_feedback" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "token_hash" TEXT NOT NULL,
    "reference" TEXT,
    "customer_key" TEXT,
    "customer_name" TEXT,
    "customer_email" TEXT,
    "job_label" TEXT,
    "staff_name" TEXT,
    "staff_role" TEXT,
    "finished_at" TEXT,
    "topics" JSONB NOT NULL DEFAULT '[]',
    "sent_at" TIMESTAMP(3),
    "send_error" TEXT,
    "answered_at" TIMESTAMP(3),
    "done" TEXT,
    "answers" JSONB NOT NULL DEFAULT '{}',
    "alerted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "customer_feedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "customer_feedback_token_hash_key" ON "customer_feedback"("token_hash");
CREATE UNIQUE INDEX "customer_feedback_request_id_key" ON "customer_feedback"("request_id");
CREATE INDEX "customer_feedback_company_id_customer_key_idx" ON "customer_feedback"("company_id", "customer_key");
CREATE INDEX "customer_feedback_company_id_answered_at_idx" ON "customer_feedback"("company_id", "answered_at");
ALTER TABLE "customer_feedback" ADD CONSTRAINT "customer_feedback_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
