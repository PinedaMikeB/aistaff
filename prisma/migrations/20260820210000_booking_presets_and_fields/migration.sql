-- Industry presets and reusable booking fields. This keeps one calendar core
-- while allowing restaurants, hotels, spas, clinics, repair services, and
-- AIStaff onboarding meetings to collect different details.
ALTER TABLE "booking_settings"
  ADD COLUMN IF NOT EXISTS "booking_type" TEXT NOT NULL DEFAULT 'general',
  ADD COLUMN IF NOT EXISTS "field_mode" TEXT NOT NULL DEFAULT 'preset',
  ADD COLUMN IF NOT EXISTS "required_fields" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "bookings"
  ADD COLUMN IF NOT EXISTS "field_values" JSONB NOT NULL DEFAULT '{}';
