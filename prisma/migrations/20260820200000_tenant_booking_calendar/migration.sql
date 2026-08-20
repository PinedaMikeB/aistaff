-- Optional tenant booking calendar. Present for every workspace, inactive
-- until the tenant enables/configures it.
CREATE TABLE IF NOT EXISTS "booking_settings" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "timezone" TEXT NOT NULL DEFAULT 'Asia/Manila',
  "slot_interval_minutes" INTEGER NOT NULL DEFAULT 30,
  "min_notice_minutes" INTEGER NOT NULL DEFAULT 120,
  "max_days_ahead" INTEGER NOT NULL DEFAULT 30,
  "business_hours" JSONB NOT NULL DEFAULT '{}',
  "instructions" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "booking_settings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_settings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX IF NOT EXISTS "booking_settings_company_id_key" ON "booking_settings"("company_id");

CREATE TABLE IF NOT EXISTS "booking_services" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "duration_minutes" INTEGER NOT NULL DEFAULT 60,
  "price" DECIMAL(12,2),
  "deposit_amount" DECIMAL(12,2),
  "location" TEXT,
  "active" BOOLEAN NOT NULL DEFAULT true,
  "display_order" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "booking_services_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "booking_services_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "booking_services_company_id_active_idx" ON "booking_services"("company_id", "active");

CREATE TABLE IF NOT EXISTS "bookings" (
  "id" TEXT NOT NULL,
  "company_id" TEXT NOT NULL,
  "service_id" TEXT,
  "conversation_id" TEXT,
  "lead_id" TEXT,
  "customer_name" TEXT NOT NULL,
  "mobile_number" TEXT,
  "email" TEXT,
  "service_name" TEXT NOT NULL,
  "start_at" TIMESTAMP(3) NOT NULL,
  "end_at" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'requested',
  "source" TEXT NOT NULL DEFAULT 'admin',
  "notes" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "bookings_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "bookings_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "bookings_service_id_fkey" FOREIGN KEY ("service_id") REFERENCES "booking_services"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "bookings_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "bookings_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX IF NOT EXISTS "bookings_company_id_start_at_idx" ON "bookings"("company_id", "start_at");
CREATE INDEX IF NOT EXISTS "bookings_company_id_status_idx" ON "bookings"("company_id", "status");
CREATE INDEX IF NOT EXISTS "bookings_service_id_idx" ON "bookings"("service_id");
CREATE INDEX IF NOT EXISTS "bookings_conversation_id_idx" ON "bookings"("conversation_id");
CREATE INDEX IF NOT EXISTS "bookings_lead_id_idx" ON "bookings"("lead_id");
