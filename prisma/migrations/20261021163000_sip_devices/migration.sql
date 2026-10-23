
-- CreateTable
CREATE TABLE "sip_devices" (
    "id" TEXT NOT NULL,
    "company_id" TEXT,
    "model" TEXT NOT NULL DEFAULT 'AIO100-1V',
    "device_serial" TEXT NOT NULL,
    "sim_number" TEXT,
    "carrier" TEXT,
    "phone_number" TEXT,
    "gateway_host" TEXT,
    "gateway_port" INTEGER,
    "auth_username" TEXT NOT NULL,
    "auth_password_encrypted" TEXT,
    "status" TEXT NOT NULL DEFAULT 'in_stock',
    "max_channels" INTEGER NOT NULL DEFAULT 1,
    "setup_code" TEXT,
    "setup_code_expires_at" TIMESTAMP(3),
    "assigned_at" TIMESTAMP(3),
    "claimed_at" TIMESTAMP(3),
    "last_check_at" TIMESTAMP(3),
    "last_check_ok" BOOLEAN,
    "last_seen_at" TIMESTAMP(3),
    "notes" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sip_devices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "sip_devices_device_serial_key" ON "sip_devices"("device_serial");

-- CreateIndex
CREATE UNIQUE INDEX "sip_devices_auth_username_key" ON "sip_devices"("auth_username");

-- CreateIndex
CREATE UNIQUE INDEX "sip_devices_setup_code_key" ON "sip_devices"("setup_code");

-- CreateIndex
CREATE INDEX "sip_devices_company_id_idx" ON "sip_devices"("company_id");

-- AddForeignKey
ALTER TABLE "sip_devices" ADD CONSTRAINT "sip_devices_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

