"use strict";

/**
 * Phone calls in Inquiries (2026-10-21).
 *
 * Every turn of a call is written to the same conversations/messages tables the
 * Inquiries page reads, AS IT HAPPENS, so staff watch the call build up live.
 * One conversation per caller number per tenant (like one Messenger thread per
 * person); a new call from the same number continues that thread.
 *
 * Never blocks or breaks a call: every write is queued in order and failures are
 * logged, not thrown.
 */

const crypto = require("crypto");
const { db } = require("./tenant");
const { log } = require("./log");

function forCall(tenant, callerId, callId) {
  const companyId = tenant && tenant.companyId;
  if (!companyId) return null;
  const number = String(callerId || "").slice(0, 40);
  let conversationId = null;
  let chain = Promise.resolve();

  const run = (label, fn) => {
    chain = chain.then(fn).catch((err) => log.warn(`inbox: ${label} failed — ${err.message}`));
    return chain;
  };

  run("open", async () => {
    const rows = await db().$queryRawUnsafe(
      `SELECT id FROM conversations WHERE company_id = $1 AND channel = 'phone' AND contact_number = $2
        ORDER BY last_message_at DESC LIMIT 1`, companyId, number);
    if (rows && rows[0]) {
      conversationId = rows[0].id;
      await db().$executeRawUnsafe(
        `UPDATE conversations SET status = 'open', needs_human = false, intent = 'phone_call', external_id = $2,
                last_message_at = NOW(), updated_at = NOW() WHERE id = $1`, conversationId, String(callId || "").slice(0, 190));
    } else {
      conversationId = crypto.randomUUID();
      await db().$executeRawUnsafe(
        `INSERT INTO conversations (id, company_id, channel, external_id, contact_number, status, intent, last_message_at, created_at, updated_at)
         VALUES ($1, $2, 'phone', $3, $4, 'open', 'phone_call', NOW(), NOW(), NOW())`,
        conversationId, companyId, String(callId || "").slice(0, 190), number);
    }
    log.info(`inbox: call is conversation ${conversationId}`);
  });

  return {
    get conversationId() { return conversationId; },
    companyId,
    /** role: "caller" | "pitch" | "sms" (an SMS the assistant sent during the call). */
    add(role, text) {
      const body = String(text || "").trim();
      if (!body) return chain;
      return run("message", async () => {
        if (!conversationId) return;
        const isCaller = role === "caller";
        await db().$executeRawUnsafe(
          `INSERT INTO messages (id, company_id, conversation_id, sender_type, message_text, ai_generated, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, NOW())`,
          crypto.randomUUID(), companyId, conversationId, isCaller ? "customer" : "ai",
          role === "sms" ? `[SMS] ${body}` : body, !isCaller);
        await db().$executeRawUnsafe(
          `UPDATE conversations SET last_message_at = NOW(), updated_at = NOW() WHERE id = $1`, conversationId);
      });
    },
    done() { return chain; },
  };
}

module.exports = { forCall };
