-- AlterTable
ALTER TABLE "business_operation_requests" ADD COLUMN     "followups" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "last_alert_at" TIMESTAMP(3),
ADD COLUMN     "need_key" TEXT,
ADD COLUMN     "replaced_by_id" TEXT;

-- CreateIndex
CREATE INDEX "business_operation_requests_company_id_need_key_status_idx" ON "business_operation_requests"("company_id", "need_key", "status");


