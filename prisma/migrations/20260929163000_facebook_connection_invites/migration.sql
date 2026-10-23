CREATE TABLE "facebook_connection_invites" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "created_by_user_id" TEXT NOT NULL,
    "created_by_email" TEXT NOT NULL,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "used_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "connected_page_id" TEXT,
    "connected_page_name" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "facebook_connection_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "facebook_connection_invites_token_hash_key"
ON "facebook_connection_invites"("token_hash");

CREATE INDEX "facebook_connection_invites_company_id_created_at_idx"
ON "facebook_connection_invites"("company_id", "created_at");

CREATE INDEX "facebook_connection_invites_expires_at_idx"
ON "facebook_connection_invites"("expires_at");
