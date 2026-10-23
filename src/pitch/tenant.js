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

  // The AIO100 registers Pitch directly, so no SIP username arrives on the call.
  // The line is identified by the router Pitch is registered to (PITCH_SIP_GATEWAY_HOST),
  // matched to Platform > Phone Lines (sip_devices.gateway_host) once a tenant has
  // claimed it with their setup code.
  if (!authUsername && !deviceSerial) {
    const byLine = await resolveByGateway();
    return byLine || fallback();
  }

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

const LINE_CACHE_MS = Number(process.env.PITCH_LINE_CACHE_MS || 10_000);
// Last known settings of each line, kept on disk: if the database cannot be reached when a call
// comes in, the call still belongs to the right business (never the demo). Mike 2026-10-22.
const LINE_DISK_CACHE = require("path").join(__dirname, "../../local-runtime/pitch-line-cache.json");
function readLineDisk(key) {
  try { return JSON.parse(require("fs").readFileSync(LINE_DISK_CACHE, "utf8"))[key] || null; } catch { return null; }
}
function writeLineDisk(key, ctx) {
  try {
    const fs = require("fs");
    let all = {}; try { all = JSON.parse(fs.readFileSync(LINE_DISK_CACHE, "utf8")); } catch {}
    all[key] = { ...ctx, saved_at: new Date().toISOString() };
    fs.mkdirSync(require("path").dirname(LINE_DISK_CACHE), { recursive: true });
    fs.writeFileSync(LINE_DISK_CACHE, JSON.stringify(all, null, 2));
  } catch {}
}

/** The claimed phone line for the router Pitch is registered to, with its tenant's Mobile Phone settings. */
async function resolveByGateway() {
  let host;
  try { host = require("./config").config.sip.gatewayHost; } catch { return null; }
  if (!host) return null;
  const key = `gw:${host}`;
  const now = Date.now();
  const hit = cache.get(key);
  if (hit && hit.expiresAt > now) return hit.context;
  try {
    const rows = await prisma().$queryRawUnsafe(
      `SELECT d.id, d.company_id, d.status, d.max_channels, c.name AS company_name,
              tc.enabled AS live, tc.config AS channel_config
         FROM sip_devices d
         JOIN companies c ON c.id = d.company_id
    LEFT JOIN tenant_channels tc ON tc.company_id = d.company_id AND tc.channel_key = 'mobile_phone'
        WHERE d.gateway_host = $1 AND d.claimed_at IS NOT NULL
     ORDER BY d.claimed_at DESC LIMIT 1`, host);
    const row = rows && rows[0];
    if (!row) { cache.set(key, { context: null, expiresAt: now + LINE_CACHE_MS }); return null; }
    const cfg = row.channel_config || {};
    const blocked = row.status === "suspended" || row.status === "returned";
    const ctx = {
      companyId: row.company_id,
      deviceId: row.id,
      maxChannels: blocked ? 0 : (row.max_channels || 1),
      source: blocked ? `status:${row.status}` : "sip-device",
      businessName: row.company_name || null,
      live: Boolean(row.live),
      pitch: cfg.pitch || {},
      instructions: String(cfg.instructions || ""),
    };
    cache.set(key, { context: ctx, expiresAt: now + LINE_CACHE_MS });
    writeLineDisk(key, ctx);
    return ctx;
  } catch (err) {
    // Database unreachable: use the last known settings of this line (never the demo).
    const saved = readLineDisk(key);
    if (saved) {
      try { require("./log").log.warn(`line: database unreachable (${String(err.message || err).split("\n").pop().slice(0, 120)}) — using saved settings for ${saved.businessName || saved.companyId} from ${saved.saved_at}`); } catch {}
      return { ...saved, fromCache: true };
    }
    return null;
  }
}

/** Phone number digits for comparing caller IDs (+63 917..., 0917..., 917...). */
function last10(v) { return String(v || "").replace(/\D/g, "").slice(-10); }

/** Is this caller allowed while the line is in test mode? */
function isTestCaller(tenant, callerId) {
  const n = last10(callerId);
  return Boolean(n) && (tenant?.pitch?.test_numbers || []).some((t) => last10(t) === n);
}

/** Last call on the line, shown in the tenant's Mobile Phone card. Never throws. */
async function recordCall(tenant, { callerId, seconds, mode }) {
  if (!tenant?.deviceId) return;
  try {
    await prisma().$executeRawUnsafe(
      `UPDATE sip_devices SET last_call_at = NOW(), last_call_from = $1, last_call_seconds = $2,
              last_call_mode = $3, last_seen_at = NOW() WHERE id = $4`,
      String(callerId || "").slice(0, 40), Math.round(Number(seconds) || 0), mode || null, tenant.deviceId);
  } catch { /* columns may not exist yet; never break a call */ }
}

function clearTenantCache() { cache.clear(); }

module.exports = { resolveCompany, clearTenantCache, isTestCaller, recordCall, last10, db: prisma };
