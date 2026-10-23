-- CreateTable
CREATE TABLE "staff_resolve_actions" (
    "id" TEXT NOT NULL,
    "company_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor_email" TEXT,
    "via" TEXT NOT NULL,
    "reference" TEXT,
    "outcome" TEXT NOT NULL,
    "detail" TEXT,
    "message_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "staff_resolve_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "staff_resolve_actions_message_id_key" ON "staff_resolve_actions"("message_id");

-- CreateIndex
CREATE INDEX "staff_resolve_actions_request_id_created_at_idx" ON "staff_resolve_actions"("request_id", "created_at");

-- AddForeignKey
ALTER TABLE "staff_resolve_actions" ADD CONSTRAINT "staff_resolve_actions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;


