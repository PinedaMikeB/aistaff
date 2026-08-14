-- Per-channel identity for Conversation.
--
-- Mobile number is the person; the channel address is how you reach them there.
--   external_id     = the address on THAT channel (PSID for messenger, mobile for voice/SMS)
--   contact_number  = the join key across channels, normalised to E.164 by the app
--
-- psid becomes nullable because non-messenger channels have no PSID. It is kept
-- (not dropped) because it is the only way Meta lets you reply into a thread,
-- and @@unique([company_id, psid]) is retained as a compatibility shim for the
-- 8 existing company_id_psid call sites.

-- AlterTable
ALTER TABLE "conversations" ADD COLUMN     "contact_number" TEXT,
ADD COLUMN     "external_id" TEXT,
ALTER COLUMN "psid" DROP NOT NULL;

-- Backfill BEFORE the unique index exists. Every pre-existing row predates
-- multi-channel, so its PSID is its channel address.
UPDATE "conversations"
   SET "external_id" = "psid"
 WHERE "external_id" IS NULL
   AND "psid" IS NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "conversations_company_id_channel_external_id_key" ON "conversations"("company_id", "channel", "external_id");
