-- Last call on a phone line (written by Pitch), shown in Settings > Channels > Mobile Phone.
ALTER TABLE "sip_devices" ADD COLUMN "last_call_at" TIMESTAMP(3);
ALTER TABLE "sip_devices" ADD COLUMN "last_call_from" TEXT;
ALTER TABLE "sip_devices" ADD COLUMN "last_call_seconds" INTEGER;
ALTER TABLE "sip_devices" ADD COLUMN "last_call_mode" TEXT;
