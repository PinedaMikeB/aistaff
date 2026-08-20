-- CreateTable
CREATE TABLE "assist_sessions" (
    "id" TEXT NOT NULL,
    "staff_user_id" TEXT NOT NULL,
    "staff_email" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "company_name" TEXT NOT NULL,
    "reason" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ended_at" TIMESTAMP(3),

    CONSTRAINT "assist_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "assist_sessions_company_id_started_at_idx" ON "assist_sessions"("company_id", "started_at");

-- CreateIndex
CREATE INDEX "assist_sessions_staff_user_id_started_at_idx" ON "assist_sessions"("staff_user_id", "started_at");

