-- CreateTable
CREATE TABLE "model_settings" (
    "fn" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "note" TEXT,
    "updated_by" TEXT,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "model_settings_pkey" PRIMARY KEY ("fn")
);

