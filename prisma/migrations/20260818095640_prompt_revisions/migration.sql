-- CreateTable
CREATE TABLE "prompt_revisions" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "note" TEXT,
    "created_by" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_revisions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "prompt_revisions_key_is_active_idx" ON "prompt_revisions"("key", "is_active");

-- CreateIndex
CREATE UNIQUE INDEX "prompt_revisions_key_version_key" ON "prompt_revisions"("key", "version");

