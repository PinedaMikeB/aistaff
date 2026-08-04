-- Fixes an over-strict uniqueness constraint discovered via real integration
-- testing: a RESERVE event and its later RELEASE/CONSUME settlement event
-- intentionally share the SAME idempotencyKey (entitlements.js's
-- computeRemaining() groups ledger rows by idempotencyKey to net a released
-- reservation back out of the balance). The original migration declared
-- idempotencyKey globally UNIQUE, which made writing that second settlement
-- row fail with a unique-constraint violation. This migration drops that
-- bare-column unique index and replaces it with a composite unique index on
-- (idempotencyKey, eventType), which still rejects a genuine duplicate
-- RESERVE (or duplicate RELEASE/CONSUME) of the same event while allowing a
-- RESERVE + its RELEASE/CONSUME pair to coexist.

DROP INDEX IF EXISTS "brandee_entitlement_events_idempotencyKey_key";

-- The plain (non-unique) lookup index on idempotencyKey alone is still
-- useful and is left in place.

CREATE UNIQUE INDEX "brandee_entitlement_events_idempotencyKey_eventType_key" ON "brandee_entitlement_events"("idempotencyKey", "eventType");
