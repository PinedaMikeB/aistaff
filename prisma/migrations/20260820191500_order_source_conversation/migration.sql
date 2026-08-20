-- Link Messenger-created checkout orders back to the conversation that created
-- them, so a paid webhook can send onboarding instructions in the same chat.
ALTER TABLE "orders" ADD COLUMN IF NOT EXISTS "source_conversation_id" TEXT;

CREATE INDEX IF NOT EXISTS "orders_source_conversation_id_idx" ON "orders"("source_conversation_id");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'orders_source_conversation_id_fkey'
  ) THEN
    ALTER TABLE "orders"
      ADD CONSTRAINT "orders_source_conversation_id_fkey"
      FOREIGN KEY ("source_conversation_id")
      REFERENCES "conversations"("id")
      ON DELETE SET NULL
      ON UPDATE CASCADE;
  END IF;
END $$;
