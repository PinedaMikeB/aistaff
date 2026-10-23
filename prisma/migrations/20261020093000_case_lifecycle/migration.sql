-- AlterTable
ALTER TABLE "business_operation_requests" ADD COLUMN "case_status" TEXT,
ADD COLUMN "closed_at" TIMESTAMP(3),
ADD COLUMN "reference" TEXT;

-- CreateIndex
CREATE INDEX "business_operation_requests_company_id_case_status_idx" ON "business_operation_requests"("company_id", "case_status");

-- CreateIndex
CREATE INDEX "business_operation_requests_conversation_id_case_status_idx" ON "business_operation_requests"("conversation_id", "case_status");

-- Backfill: write requests (need_key or collected customer details) get a case status.
UPDATE "business_operation_requests" SET "case_status" = 'waiting' WHERE "status" IN ('failed','retrying') AND ("need_key" IS NOT NULL OR "requested_arguments" ? 'description');
UPDATE "business_operation_requests" SET "case_status" = 'merged', "reference" = COALESCE("result"->>'linked_reference', "result"->>'superseded_by_reference', 'SR-2026-000005'), "closed_at" = "completed_at" WHERE "status" = 'replaced';
UPDATE "business_operation_requests" SET "case_status" = 'closed', "closed_at" = "completed_at" WHERE "status" = 'closed';
