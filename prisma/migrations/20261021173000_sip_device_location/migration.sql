-- Where the router lives: hosted at AIStaff (default) or at the customer's site.
ALTER TABLE "sip_devices" ADD COLUMN "location" TEXT NOT NULL DEFAULT 'aistaff';
