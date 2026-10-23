CREATE TABLE "integration_connections" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "base_url" TEXT NOT NULL,
  "spec_source_url" TEXT,
  "openapi_spec" JSONB NOT NULL,
  "auth_type" TEXT NOT NULL DEFAULT 'none',
  "auth_config" JSONB,
  "auth_secret_encrypted" TEXT,
  "status" TEXT NOT NULL DEFAULT 'draft',
  "last_tested_at" TIMESTAMP(3),
  "last_test_status" TEXT,
  "last_test_message" TEXT,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_connections_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_actions" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "operation_id" TEXT NOT NULL,
  "tool_name" TEXT NOT NULL,
  "display_name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "http_method" TEXT NOT NULL,
  "path" TEXT NOT NULL,
  "input_schema" JSONB NOT NULL,
  "request_config" JSONB NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "risk_level" TEXT NOT NULL DEFAULT 'write',
  "approval_policy" TEXT NOT NULL DEFAULT 'staff_approval',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "integration_actions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "integration_executions" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "action_id" TEXT NOT NULL,
  "conversation_id" TEXT,
  "status" TEXT NOT NULL,
  "approval_policy" TEXT NOT NULL,
  "requested_arguments" JSONB NOT NULL,
  "result" JSONB,
  "error_message" TEXT,
  "requested_by" TEXT,
  "approved_by" TEXT,
  "approved_at" TIMESTAMP(3),
  "started_at" TIMESTAMP(3),
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "integration_executions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "integration_connections_company_id_name_key" ON "integration_connections"("company_id", "name");
CREATE INDEX "integration_connections_company_id_status_idx" ON "integration_connections"("company_id", "status");
CREATE UNIQUE INDEX "integration_actions_connection_id_operation_id_key" ON "integration_actions"("connection_id", "operation_id");
CREATE UNIQUE INDEX "integration_actions_company_id_tool_name_key" ON "integration_actions"("company_id", "tool_name");
CREATE INDEX "integration_actions_company_id_enabled_idx" ON "integration_actions"("company_id", "enabled");
CREATE INDEX "integration_executions_company_id_created_at_idx" ON "integration_executions"("company_id", "created_at");
CREATE INDEX "integration_executions_company_id_status_idx" ON "integration_executions"("company_id", "status");
CREATE INDEX "integration_executions_conversation_id_status_idx" ON "integration_executions"("conversation_id", "status");

ALTER TABLE "integration_connections" ADD CONSTRAINT "integration_connections_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_actions" ADD CONSTRAINT "integration_actions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_actions" ADD CONSTRAINT "integration_actions_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_executions" ADD CONSTRAINT "integration_executions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_executions" ADD CONSTRAINT "integration_executions_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "integration_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "integration_executions" ADD CONSTRAINT "integration_executions_action_id_fkey" FOREIGN KEY ("action_id") REFERENCES "integration_actions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
