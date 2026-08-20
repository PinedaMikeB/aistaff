-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "intake_completed_at" TIMESTAMP(3),
ADD COLUMN     "intake_progress" JSONB,
ADD COLUMN     "live_data_interest" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "live_data_source" TEXT;

-- AlterTable
ALTER TABLE "knowledge_base" ADD COLUMN     "confirmed" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "currency" TEXT,
ADD COLUMN     "data" JSONB,
ADD COLUMN     "display_order" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'qa',
ADD COLUMN     "source_kind" TEXT,
ADD COLUMN     "source_name" TEXT,
ADD COLUMN     "title" TEXT,
ADD COLUMN     "valid_until" TIMESTAMP(3),
ALTER COLUMN "question" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "knowledge_base_company_id_active_kind_idx" ON "knowledge_base"("company_id", "active", "kind");
