ALTER TABLE "conversations" ADD COLUMN "ai_history_from" TIMESTAMP(3);
ALTER TABLE "conversations" ADD COLUMN "customer_profile" JSONB NOT NULL DEFAULT '{}';
