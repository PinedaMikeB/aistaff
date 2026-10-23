-- CreateTable
CREATE TABLE "business_engines" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "default_instruction" TEXT NOT NULL,
    "catalog_version" INTEGER NOT NULL DEFAULT 1,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_engines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_field_definitions" (
    "id" TEXT NOT NULL,
    "engine_id" TEXT NOT NULL,
    "field_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "data_type" TEXT NOT NULL DEFAULT 'string',
    "default_enabled" BOOLEAN NOT NULL DEFAULT true,
    "default_required" BOOLEAN NOT NULL DEFAULT false,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engine_field_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_operation_definitions" (
    "id" TEXT NOT NULL,
    "engine_id" TEXT NOT NULL,
    "operation_key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "operation_type" TEXT NOT NULL,
    "required_fields" JSONB NOT NULL DEFAULT '[]',
    "default_policy" TEXT NOT NULL,
    "minimum_policy" TEXT NOT NULL,
    "default_fallback" TEXT NOT NULL DEFAULT 'create_human_task',
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engine_operation_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_engines" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "engine_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "instruction_enabled" BOOLEAN NOT NULL DEFAULT true,
    "default_instruction_snapshot" TEXT NOT NULL,
    "tenant_instruction" TEXT,
    "catalog_version" INTEGER NOT NULL DEFAULT 1,
    "enabled_at" TIMESTAMP(3),
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_engines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_engine_fields" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "tenant_engine_id" TEXT NOT NULL,
    "definition_id" TEXT,
    "field_key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT,
    "data_type" TEXT NOT NULL DEFAULT 'string',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "is_custom" BOOLEAN NOT NULL DEFAULT false,
    "external_field" TEXT,
    "display_order" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_engine_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_engine_operations" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "tenant_engine_id" TEXT NOT NULL,
    "operation_definition_id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "policy" TEXT NOT NULL,
    "fallback_policy" TEXT NOT NULL DEFAULT 'create_human_task',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_engine_operations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "engine_operation_mappings" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "tenant_engine_operation_id" TEXT NOT NULL,
    "integration_action_id" TEXT NOT NULL,
    "field_mapping" JSONB NOT NULL DEFAULT '{}',
    "response_mapping" JSONB DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'mapped',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "engine_operation_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "business_operation_requests" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "tenant_engine_operation_id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "integration_execution_id" TEXT,
    "status" TEXT NOT NULL,
    "policy" TEXT NOT NULL,
    "requested_arguments" JSONB NOT NULL,
    "result" JSONB,
    "error_message" TEXT,
    "fallback_used" TEXT,
    "requested_by" TEXT,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "business_operation_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "capability_gaps" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "tenant_engine_operation_id" TEXT NOT NULL,
    "operation_key" TEXT NOT NULL,
    "frequency_count" INTEGER NOT NULL DEFAULT 1,
    "last_request_context" JSONB,
    "fallback_used" TEXT,
    "first_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_seen_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "capability_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_audit_logs" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "actor_id" TEXT,
    "actor_email" TEXT,
    "action" TEXT NOT NULL,
    "target_type" TEXT NOT NULL,
    "target_id" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tenant_audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "business_engines_key_key" ON "business_engines"("key");

-- CreateIndex
CREATE INDEX "business_engines_active_display_order_idx" ON "business_engines"("active", "display_order");

-- CreateIndex
CREATE INDEX "engine_field_definitions_engine_id_display_order_idx" ON "engine_field_definitions"("engine_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "engine_field_definitions_engine_id_field_key_key" ON "engine_field_definitions"("engine_id", "field_key");

-- CreateIndex
CREATE INDEX "engine_operation_definitions_engine_id_display_order_idx" ON "engine_operation_definitions"("engine_id", "display_order");

-- CreateIndex
CREATE UNIQUE INDEX "engine_operation_definitions_engine_id_operation_key_key" ON "engine_operation_definitions"("engine_id", "operation_key");

-- CreateIndex
CREATE INDEX "tenant_engines_company_id_enabled_idx" ON "tenant_engines"("company_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_engines_company_id_engine_id_key" ON "tenant_engines"("company_id", "engine_id");

-- CreateIndex
CREATE INDEX "tenant_engine_fields_company_id_tenant_engine_id_idx" ON "tenant_engine_fields"("company_id", "tenant_engine_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_engine_fields_tenant_engine_id_field_key_key" ON "tenant_engine_fields"("tenant_engine_id", "field_key");

-- CreateIndex
CREATE INDEX "tenant_engine_operations_company_id_enabled_idx" ON "tenant_engine_operations"("company_id", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_engine_operations_tenant_engine_id_operation_definit_key" ON "tenant_engine_operations"("tenant_engine_id", "operation_definition_id");

-- CreateIndex
CREATE UNIQUE INDEX "engine_operation_mappings_tenant_engine_operation_id_key" ON "engine_operation_mappings"("tenant_engine_operation_id");

-- CreateIndex
CREATE INDEX "engine_operation_mappings_company_id_status_idx" ON "engine_operation_mappings"("company_id", "status");

-- CreateIndex
CREATE INDEX "engine_operation_mappings_integration_action_id_idx" ON "engine_operation_mappings"("integration_action_id");

-- CreateIndex
CREATE INDEX "business_operation_requests_company_id_status_idx" ON "business_operation_requests"("company_id", "status");

-- CreateIndex
CREATE INDEX "business_operation_requests_company_id_created_at_idx" ON "business_operation_requests"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "business_operation_requests_conversation_id_status_idx" ON "business_operation_requests"("conversation_id", "status");

-- CreateIndex
CREATE INDEX "business_operation_requests_integration_execution_id_idx" ON "business_operation_requests"("integration_execution_id");

-- CreateIndex
CREATE UNIQUE INDEX "capability_gaps_tenant_engine_operation_id_key" ON "capability_gaps"("tenant_engine_operation_id");

-- CreateIndex
CREATE INDEX "capability_gaps_company_id_frequency_count_idx" ON "capability_gaps"("company_id", "frequency_count");

-- CreateIndex
CREATE INDEX "tenant_audit_logs_company_id_created_at_idx" ON "tenant_audit_logs"("company_id", "created_at");

-- CreateIndex
CREATE INDEX "tenant_audit_logs_company_id_action_idx" ON "tenant_audit_logs"("company_id", "action");

-- AddForeignKey
ALTER TABLE "engine_field_definitions" ADD CONSTRAINT "engine_field_definitions_engine_id_fkey" FOREIGN KEY ("engine_id") REFERENCES "business_engines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_operation_definitions" ADD CONSTRAINT "engine_operation_definitions_engine_id_fkey" FOREIGN KEY ("engine_id") REFERENCES "business_engines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_engines" ADD CONSTRAINT "tenant_engines_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_engines" ADD CONSTRAINT "tenant_engines_engine_id_fkey" FOREIGN KEY ("engine_id") REFERENCES "business_engines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_engine_fields" ADD CONSTRAINT "tenant_engine_fields_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_engine_fields" ADD CONSTRAINT "tenant_engine_fields_tenant_engine_id_fkey" FOREIGN KEY ("tenant_engine_id") REFERENCES "tenant_engines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_engine_operations" ADD CONSTRAINT "tenant_engine_operations_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_engine_operations" ADD CONSTRAINT "tenant_engine_operations_tenant_engine_id_fkey" FOREIGN KEY ("tenant_engine_id") REFERENCES "tenant_engines"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_engine_operations" ADD CONSTRAINT "tenant_engine_operations_operation_definition_id_fkey" FOREIGN KEY ("operation_definition_id") REFERENCES "engine_operation_definitions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_operation_mappings" ADD CONSTRAINT "engine_operation_mappings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_operation_mappings" ADD CONSTRAINT "engine_operation_mappings_tenant_engine_operation_id_fkey" FOREIGN KEY ("tenant_engine_operation_id") REFERENCES "tenant_engine_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "engine_operation_mappings" ADD CONSTRAINT "engine_operation_mappings_integration_action_id_fkey" FOREIGN KEY ("integration_action_id") REFERENCES "integration_actions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_operation_requests" ADD CONSTRAINT "business_operation_requests_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "business_operation_requests" ADD CONSTRAINT "business_operation_requests_tenant_engine_operation_id_fkey" FOREIGN KEY ("tenant_engine_operation_id") REFERENCES "tenant_engine_operations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_gaps" ADD CONSTRAINT "capability_gaps_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "capability_gaps" ADD CONSTRAINT "capability_gaps_tenant_engine_operation_id_fkey" FOREIGN KEY ("tenant_engine_operation_id") REFERENCES "tenant_engine_operations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenant_audit_logs" ADD CONSTRAINT "tenant_audit_logs_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

