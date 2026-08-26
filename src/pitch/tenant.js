"use strict";

/**
 * Tenant resolution for an inbound call.
 *
 * Everything Pitch needs to answer as the right business: which company, what
 * it is called, which prompt, which knowledge base.
 *
 * WHY auth_username IS THE KEY
 *   It is the one identifier we issue and control. SIMs change on carrier
 *   switch or damage, serials die with an RMA, source IPs change whenever the
 *   client's ISP feels like it. The SIP credential survives all of that, and
 *   it works unchanged if a tenant later moves from an AIO100 to a SIP trunk.
 *
 * WHY THIS MODULE EXISTS SEPARATELY
 *   Pitch today serves one company from PITCH_COMPANY_ID. That is the only
 *   thing standing between it and multi-tenancy. Isolating resolution here
 *   means the SIP stack, the media path and the brain never learn about
 *   tenancy — they receive a resolved context and use it.
 *
 * SAFETY
 *   A ringing phone must never fail because a lookup did. Every path degrades
 *   to the configured default tenant rather than throwing.
 */

const CACHE_MS = Number(process.env.PITCH_TENANT_CACHE_MS || 60_000);

// auth_username -> { context, expiresAt }
const cache = new Map();

function prisma() {
  const { PrismaClient } = require("@prisma/client");
  if (!global.__pitchPrisma) global.__pitchPrisma = new PrismaClient();
  return global.__pitchPrisma;
}

/**
 * The company this call belongs to.
 *
 * @param {object} identity
 * @param {string} [identity.authUsername] SIP account that registered — the
 *        preferred key, supplied by Asterisk on the inbound channel.
 * @param {string} [identity.deviceSerial] fallback for provisioning tools.
 * @returns {Promise<{companyId, deviceId, maxChannels, source}>}
 */
async function resolveCompany({ authUsername, deviceSerial } = {}) {
  const fallback = () => ({
    companyId: process.env.PITCH_COMPANY_ID || null,
    deviceId: null,
    maxChannels: Number(process.env.PITCH_MAX_CHANNELS || 1),
    source: "env-default",
  });

  if (!authUsername && !deviceSerial) return fallback();

  const key = authUsername || `serial:${deviceSerial}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.context;

  try {
    const db = prisma();
    // SipDevice may not exist yet — this module is written ahead of the
    // migration so the media refactor can land independently.
    if (!db.sipDevice) return fallback();

    const device = await db.sipDevice.findFirst({
      where: authUsername ? { auth_username: authUsername } : { device_serial: deviceSerial },
      select: { id: true, company_id: true, status: true, max_channels: true },
    });

    if (!device) return fallback();

    // Suspended is how non-payment kills a line without destroying its
    // history. The caller should hear a polite message, not a busy tone —
    // that decision belongs to the dialplan, not here.
    if (device.status === "suspended" || device.status === "returned") {
      const ctx = { companyId: null, deviceId: device.id, maxChannels: 0, source: `status:${device.status}` };
      cache.set(key, { context: ctx, expiresAt: now + CACHE_MS });
      return ctx;
    }

    const ctx = {
      companyId: device.company_id,
      deviceId: device.id,
      maxChannels: device.max_channels || 1,
      source: "sip-device",
    };
    cache.set(key, { context: ctx, expiresAt: now + CACHE_MS });
    return ctx;
  } catch {
    return fallback();
  }
}

function clearTenantCache() { cache.clear(); }

module.exports = { resolveCompany, clearTenantCache };
