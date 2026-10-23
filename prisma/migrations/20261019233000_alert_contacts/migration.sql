ALTER TABLE "company_settings" ADD COLUMN "alert_contacts" JSONB NOT NULL DEFAULT '[]';
-- Existing notify emails become contacts (name to be filled in by the tenant).
UPDATE "company_settings"
   SET "alert_contacts" = (
     SELECT COALESCE(jsonb_agg(jsonb_build_object('name', '', 'email', trim(e), 'phone', '')), '[]'::jsonb)
       FROM regexp_split_to_table(COALESCE("notify_email", ''), '[,;[:space:]]+') AS e
      WHERE trim(e) LIKE '%@%'
   );
