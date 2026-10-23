-- Universal Connections & Actions: resumable discovery/auth/test/review state.
-- Existing records remain compatible and resume at Review Actions.
ALTER TABLE "integration_connections"
  ADD COLUMN "source_url" TEXT,
  ADD COLUMN "connection_type" TEXT NOT NULL DEFAULT 'rest_openapi',
  ADD COLUMN "discovery_status" TEXT NOT NULL DEFAULT 'succeeded',
  ADD COLUMN "discovery_message" TEXT,
  ADD COLUMN "discovery_metadata" JSONB,
  ADD COLUMN "wizard_step" TEXT NOT NULL DEFAULT 'review',
  ADD COLUMN "credential_status" TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN "credential_updated_at" TIMESTAMP(3),
  ADD COLUMN "oauth_state_hash" TEXT,
  ADD COLUMN "oauth_pkce_encrypted" TEXT,
  ADD COLUMN "oauth_state_expires_at" TIMESTAMP(3),
  ADD COLUMN "api_version" TEXT,
  ADD COLUMN "behavior_config" JSONB,
  ADD COLUMN "last_success_at" TIMESTAMP(3),
  ADD COLUMN "disabled_at" TIMESTAMP(3);

ALTER TABLE "integration_actions"
  ADD COLUMN "category" TEXT NOT NULL DEFAULT 'other',
  ADD COLUMN "minimum_approval_policy" TEXT NOT NULL DEFAULT 'staff_approval',
  ADD COLUMN "is_high_impact" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "source" TEXT NOT NULL DEFAULT 'openapi',
  ADD COLUMN "validated" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "response_schema" JSONB;

UPDATE "integration_connections"
SET "credential_status" = CASE
  WHEN "auth_type" = 'none' THEN 'not_required'
  WHEN "auth_secret_encrypted" IS NOT NULL THEN 'unverified'
  ELSE 'missing'
END,
"discovery_metadata" = jsonb_build_object('migratedExistingConnection', true);

UPDATE "integration_actions"
SET "category" = CASE
  WHEN "http_method" IN ('GET', 'HEAD', 'OPTIONS') THEN 'read'
  WHEN "http_method" = 'POST' THEN 'create'
  WHEN "http_method" IN ('PUT', 'PATCH') THEN 'update'
  WHEN "http_method" = 'DELETE' THEN 'delete'
  ELSE 'other'
END,
"minimum_approval_policy" = CASE
  WHEN "http_method" IN ('GET', 'HEAD', 'OPTIONS') THEN 'automatic'
  ELSE 'staff_approval'
END,
"is_high_impact" = ("http_method" = 'DELETE'),
"validated" = true;
