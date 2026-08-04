// Brandee entitlement accounting (PART 27) — IMAGE_FINAL / VIDEO_SECONDS
// only. Never mixed into a generic "credits" number anywhere customer-
// facing. Backed by an append-only event ledger (BrandeeEntitlementEvent):
// the remaining balance for a billing period is always DERIVED by summing
// events for the customer's CURRENT subscription period, never stored as a
// single mutable counter — so a crashed request can never silently double-
// spend or lose an entitlement.
//
// Flow for a paid final generation (PART 12/16/27):
//   1. checkBalance()  — read-only, does not reserve anything.
//   2. reserve()       — writes a RESERVE event (counts against the visible
//                        remaining balance immediately, so two concurrent
//                        requests can't both reserve the last unit).
//   3. generate the asset.
//   4. consume()        on success — writes a CONSUME event tied to the same
//                        idempotency key; the reservation converts into a
//                        real deduction.
//      release()         on failure/timeout — writes a RELEASE event that
//                        cancels the reservation; the unit becomes available
//                        again and nothing was actually charged.
//
// A crashed process between steps 2 and 4 leaves an un-settled RESERVE
// event. getBalance() treats any RESERVE without a matching CONSUME/RELEASE
// as still "reserved" (counted against the balance) — a stale reservation
// makes the plan look one unit smaller than it should, which is the safe
// failure direction (never over-grants), and an operator can release it
// manually via releaseStaleReservation() if needed.

const crypto = require("crypto");
const { prisma } = require("../db");
const { ENTITLEMENT_UNITS, getPlan } = require("./pricingConfig");

const VALID_UNITS = Object.values(ENTITLEMENT_UNITS);
const VALID_EVENT_TYPES = ["RESERVE", "CONSUME", "RELEASE", "REFUND"];

function assertValidUnit(unit) {
  if (!VALID_UNITS.includes(unit)) throw new Error(`Invalid entitlement unit: ${unit}`);
}

/**
 * Sums ledger events for one customer+unit within a period into a single
 * "remaining" figure, given the plan's monthly allowance. Pure function so
 * the accounting logic itself is unit-testable without a live database.
 *
 * Net-outstanding = (RESERVE + CONSUME) - (RELEASE + REFUND) grouped by the
 * idempotency key's implicit RESERVE->CONSUME|RELEASE lifecycle is collapsed
 * here to a simpler, still-safe rule: every RESERVE counts against the
 * balance until an explicit RELEASE/REFUND event with the SAME
 * idempotencyKey is also present; a settled CONSUME does not double-count on
 * top of its own RESERVE (a caller should only write one of RESERVE+CONSUME
 * as a pair sharing one idempotencyKey — see reserveAndConsume()/release()).
 */
function computeRemaining({ monthlyAllowance, events }) {
  const byKey = new Map();
  for (const event of events) {
    const key = event.idempotencyKey;
    const bucket = byKey.get(key) || { reserved: 0, released: false, consumed: false };
    if (event.eventType === "RESERVE") bucket.reserved += event.amount;
    if (event.eventType === "CONSUME") bucket.consumed = true;
    if (event.eventType === "RELEASE" || event.eventType === "REFUND") bucket.released = true;
    byKey.set(key, bucket);
  }
  let outstanding = 0;
  for (const bucket of byKey.values()) {
    if (bucket.released) continue; // released/refunded reservations no longer count against the balance
    outstanding += bucket.reserved;
  }
  return Math.max(0, monthlyAllowance - outstanding);
}

function currentPeriodStart(subscription) {
  return subscription?.current_period_start || new Date(new Date().getFullYear(), new Date().getMonth(), 1);
}

async function listEventsForPeriod({ customerId, unit, periodStart }) {
  return prisma.brandeeEntitlementEvent.findMany({
    where: { customer_id: customerId, unit, createdAt: { gte: periodStart } },
    orderBy: { createdAt: "asc" }
  });
}

/**
 * Read-only balance check for one entitlement unit against the customer's
 * active Brandee subscription for the current billing period.
 */
async function getBalance({ customerId, subscription, unit }) {
  assertValidUnit(unit);
  const plan = getPlan(subscription.pricing_plan.slug.replace(/^brandee-/, ""));
  const monthlyAllowance = plan ? (plan.entitlements[unit] || 0) : (subscription.pricing_plan.features?.entitlements?.[unit] || 0);
  const periodStart = currentPeriodStart(subscription);
  const events = await listEventsForPeriod({ customerId, unit, periodStart });
  return { unit, monthlyAllowance, remaining: computeRemaining({ monthlyAllowance, events }) };
}

/**
 * Reserves `amount` of `unit` for one generation attempt. Throws
 * INSUFFICIENT_ENTITLEMENT if the customer doesn't have enough remaining —
 * callers must catch this and show a clear "allowance reached" message
 * rather than attempting generation.
 */
async function reserve({ customerId, subscriptionId, subscription, unit, amount, projectId, idempotencyKey }) {
  assertValidUnit(unit);
  if (!(amount > 0)) throw new Error("Reserve amount must be positive.");
  const key = idempotencyKey || crypto.randomUUID();

  // Idempotency: if this exact reservation was already made (e.g. a retried
  // request), return the existing event rather than reserving twice. Scoped
  // to eventType "RESERVE" specifically — idempotencyKey alone is no longer
  // globally unique, since its later RELEASE/CONSUME settlement event
  // intentionally reuses the same key (see schema.prisma's comment).
  const existing = await prisma.brandeeEntitlementEvent.findUnique({ where: { idempotencyKey_eventType: { idempotencyKey: key, eventType: "RESERVE" } } });
  if (existing) return existing;

  const balance = await getBalance({ customerId, subscription, unit });
  if (balance.remaining < amount) {
    const error = new Error(`Not enough ${unit} remaining this billing period.`);
    error.code = "INSUFFICIENT_ENTITLEMENT";
    error.remaining = balance.remaining;
    throw error;
  }

  return prisma.brandeeEntitlementEvent.create({
    data: { customer_id: customerId, subscription_id: subscriptionId || null, unit, eventType: "RESERVE", amount, projectId: projectId || null, idempotencyKey: key, reason: "final_generation_reserved" }
  });
}

/**
 * Confirms a prior reservation as actually consumed, AFTER a successful
 * generation (PART 12/27: "Deduct one image allowance only after successful
 * generation"). Writing the CONSUME event does not change the derived
 * balance (the RESERVE already counted against it) — it exists so the
 * ledger has an honest record of what was actually produced vs. merely held.
 */
async function consume({ idempotencyKey, reason = "final_generation_succeeded" }) {
  const reservation = await prisma.brandeeEntitlementEvent.findUnique({ where: { idempotencyKey_eventType: { idempotencyKey, eventType: "RESERVE" } } });
  if (!reservation) {
    throw new Error("No matching reservation to consume.");
  }
  return prisma.brandeeEntitlementEvent.create({
    data: {
      customer_id: reservation.customer_id,
      subscription_id: reservation.subscription_id,
      unit: reservation.unit,
      eventType: "CONSUME",
      amount: reservation.amount,
      projectId: reservation.projectId,
      idempotencyKey: `${idempotencyKey}:consume`,
      reason
    }
  });
}

/**
 * Releases a prior reservation, AFTER a failed/timed-out generation (PART
 * 12/27: "If final generation fails, do not consume the allowance / release
 * the reserved allowance"). The unit becomes available again immediately.
 */
async function release({ idempotencyKey, reason = "final_generation_failed" }) {
  const reservation = await prisma.brandeeEntitlementEvent.findUnique({ where: { idempotencyKey_eventType: { idempotencyKey, eventType: "RESERVE" } } });
  if (!reservation) {
    throw new Error("No matching reservation to release.");
  }
  return prisma.brandeeEntitlementEvent.create({
    data: {
      customer_id: reservation.customer_id,
      subscription_id: reservation.subscription_id,
      unit: reservation.unit,
      eventType: "RELEASE",
      amount: reservation.amount,
      projectId: reservation.projectId,
      idempotencyKey,
      reason
    }
  });
}

/**
 * Convenience wrapper for the common "reserve, run the generator, settle"
 * pattern used by both the image/final and video/final routes. `generateFn`
 * must return a promise; on rejection or a falsy `.ok`, the reservation is
 * released and the error/failure is re-surfaced to the caller.
 */
async function withReservedEntitlement({ customerId, subscriptionId, subscription, unit, amount, projectId, idempotencyKey }, generateFn) {
  const key = idempotencyKey || crypto.randomUUID();
  await reserve({ customerId, subscriptionId, subscription, unit, amount, projectId, idempotencyKey: key });
  try {
    const result = await generateFn();
    if (!result || result.ok === false) {
      await release({ idempotencyKey: key, reason: result?.reason || "generation_failed" });
      return result;
    }
    await consume({ idempotencyKey: key });
    return result;
  } catch (error) {
    await release({ idempotencyKey: key, reason: "generation_threw" }).catch(() => {});
    throw error;
  }
}

module.exports = {
  VALID_UNITS,
  VALID_EVENT_TYPES,
  computeRemaining,
  getBalance,
  reserve,
  consume,
  release,
  withReservedEntitlement
};
