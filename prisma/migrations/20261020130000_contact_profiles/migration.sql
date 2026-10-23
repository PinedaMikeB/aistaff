CREATE TABLE "contact_profiles" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "identity" TEXT NOT NULL,
    "conversation_id" TEXT,
    "name" TEXT,
    "address_as" TEXT,
    "phone" TEXT,
    "phone_key" TEXT,
    "email" TEXT,
    "organization" TEXT,
    "branch" TEXT,
    "department" TEXT,
    "details" JSONB NOT NULL DEFAULT '{}',
    "consent" TEXT NOT NULL DEFAULT 'yes',
    "consent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "contact_profiles_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "contact_profiles_company_id_channel_identity_key" ON "contact_profiles"("company_id", "channel", "identity");
CREATE INDEX "contact_profiles_company_id_phone_key_idx" ON "contact_profiles"("company_id", "phone_key");
ALTER TABLE "contact_profiles" ADD CONSTRAINT "contact_profiles_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
