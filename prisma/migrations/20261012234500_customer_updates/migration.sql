-- Tenant-owned, versioned Meta Utility Message templates.
CREATE TABLE "customer_update_templates" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "facebook_page_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "display_name" TEXT NOT NULL,
    "description" TEXT,
    "ai_usage_instruction" TEXT NOT NULL,
    "meta_template_name" TEXT NOT NULL,
    "language" TEXT NOT NULL DEFAULT 'en_US',
    "body_text" TEXT NOT NULL,
    "variable_keys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "variable_examples" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "meta_template_id" TEXT,
    "meta_error" TEXT,
    "archived_at" TIMESTAMP(3),
    "created_by_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_update_templates_pkey" PRIMARY KEY ("id")
);

-- Immutable delivery attempts. The variable and rendered-text snapshots make
-- the exact staff-confirmed message auditable even after a new template version.
CREATE TABLE "customer_update_deliveries" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "facebook_page_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'sending',
    "recipient_name" TEXT,
    "recipient_psid" TEXT NOT NULL,
    "variables" JSONB NOT NULL,
    "rendered_text" TEXT NOT NULL,
    "meta_message_id" TEXT,
    "meta_error" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "created_by_email" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sent_at" TIMESTAMP(3),

    CONSTRAINT "customer_update_deliveries_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "cut_tpl_company_page_key_version_uq"
ON "customer_update_templates"("company_id", "facebook_page_id", "key", "version");

CREATE UNIQUE INDEX "cut_tpl_page_meta_name_uq"
ON "customer_update_templates"("facebook_page_id", "meta_template_name");

CREATE INDEX "cut_tpl_company_active_status_idx"
ON "customer_update_templates"("company_id", "active", "status");

CREATE INDEX "cut_tpl_company_page_key_version_idx"
ON "customer_update_templates"("company_id", "facebook_page_id", "key", "version");

CREATE UNIQUE INDEX "customer_update_deliveries_idempotency_key_key"
ON "customer_update_deliveries"("idempotency_key");

CREATE INDEX "customer_update_deliveries_company_id_created_at_idx"
ON "customer_update_deliveries"("company_id", "created_at");

CREATE INDEX "customer_update_deliveries_conversation_id_created_at_idx"
ON "customer_update_deliveries"("conversation_id", "created_at");

CREATE INDEX "customer_update_deliveries_status_created_at_idx"
ON "customer_update_deliveries"("status", "created_at");

ALTER TABLE "customer_update_templates"
ADD CONSTRAINT "customer_update_templates_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_update_templates"
ADD CONSTRAINT "customer_update_templates_facebook_page_id_fkey"
FOREIGN KEY ("facebook_page_id") REFERENCES "facebook_pages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_update_deliveries"
ADD CONSTRAINT "customer_update_deliveries_company_id_fkey"
FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "customer_update_deliveries"
ADD CONSTRAINT "customer_update_deliveries_facebook_page_id_fkey"
FOREIGN KEY ("facebook_page_id") REFERENCES "facebook_pages"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_update_deliveries"
ADD CONSTRAINT "customer_update_deliveries_conversation_id_fkey"
FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "customer_update_deliveries"
ADD CONSTRAINT "customer_update_deliveries_template_id_fkey"
FOREIGN KEY ("template_id") REFERENCES "customer_update_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
