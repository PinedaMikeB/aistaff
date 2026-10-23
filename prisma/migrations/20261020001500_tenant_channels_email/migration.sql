-- CreateTable
CREATE TABLE "tenant_channels" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "channel_key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "ai_replies" BOOLEAN NOT NULL DEFAULT true,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret_encrypted" TEXT,
    "tested_fingerprint" TEXT,
    "last_tested_at" TIMESTAMP(3),
    "last_ok_at" TIMESTAMP(3),
    "last_error" TEXT,
    "last_error_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_channels_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "email_message_log" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "direction" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "in_reply_to" TEXT,
    "references_header" TEXT,
    "from_address" TEXT,
    "to_address" TEXT,
    "subject" TEXT,
    "skip_reason" TEXT,
    "imap_uid" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "email_message_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenant_channels_company_id_channel_key_key" ON "tenant_channels"("company_id", "channel_key");

-- CreateIndex
CREATE INDEX "email_message_log_conversation_id_created_at_idx" ON "email_message_log"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "email_message_log_company_id_to_address_created_at_idx" ON "email_message_log"("company_id", "to_address", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "email_message_log_company_id_message_id_key" ON "email_message_log"("company_id", "message_id");

-- AddForeignKey
ALTER TABLE "tenant_channels" ADD CONSTRAINT "tenant_channels_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_message_log" ADD CONSTRAINT "email_message_log_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "email_message_log" ADD CONSTRAINT "email_message_log_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "cut_tpl_company_active_status_idx" RENAME TO "customer_update_templates_company_id_active_status_idx";

-- RenameIndex
ALTER INDEX "cut_tpl_company_page_key_version_idx" RENAME TO "customer_update_templates_company_id_facebook_page_id_key_v_idx";

-- RenameIndex
ALTER INDEX "cut_tpl_company_page_key_version_uq" RENAME TO "customer_update_templates_company_id_facebook_page_id_key_v_key";

-- RenameIndex
ALTER INDEX "cut_tpl_page_meta_name_uq" RENAME TO "customer_update_templates_facebook_page_id_meta_template_na_key";


