-- Human-readable tenant reference + the missing payment -> tenant link.
--
--   companies.account_number   AIS-YYYY-NNNN. What the customer's accountant
--                              writes on a PO or bank transfer. Reference, not
--                              identity — companies.id remains the key.
--   subscriptions.company_id   Which tenant this payment provisions. Without
--                              it a paid subscription cannot create a
--                              workspace, which is why nobody can log in after
--                              paying today.

-- AlterTable
ALTER TABLE "companies" ADD COLUMN     "account_number" TEXT;

-- AlterTable
ALTER TABLE "subscriptions" ADD COLUMN     "company_id" TEXT;

-- Backfill BEFORE the unique index exists. Oldest company gets 0001 so the
-- numbering reflects the order tenants were actually onboarded.
WITH numbered AS (
  SELECT id,
         to_char(created_at, 'YYYY')                     AS yr,
         row_number() OVER (ORDER BY created_at, id)     AS rn
    FROM "companies"
   WHERE account_number IS NULL
)
UPDATE "companies" c
   SET account_number = 'AIS-' || n.yr || '-' || lpad(n.rn::text, 4, '0')
  FROM numbered n
 WHERE n.id = c.id;

-- CreateIndex
CREATE UNIQUE INDEX "companies_account_number_key" ON "companies"("account_number");

-- CreateIndex
CREATE INDEX "subscriptions_company_id_idx" ON "subscriptions"("company_id");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_company_id_fkey" FOREIGN KEY ("company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
