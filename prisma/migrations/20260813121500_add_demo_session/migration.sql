-- CreateTable
CREATE TABLE "demo_sessions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobile_number" TEXT,
    "website_url" TEXT,
    "facebook_url" TEXT,
    "business_name" TEXT,
    "snapshot" JSONB,
    "scrape_status" TEXT NOT NULL DEFAULT 'pending',
    "scrape_error" TEXT,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "sms_sent" INTEGER NOT NULL DEFAULT 0,
    "requested_ip" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "converted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "demo_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "demo_sessions_email_idx" ON "demo_sessions"("email");

-- CreateIndex
CREATE INDEX "demo_sessions_expires_at_idx" ON "demo_sessions"("expires_at");

-- CreateIndex
CREATE INDEX "demo_sessions_created_at_idx" ON "demo_sessions"("created_at");

