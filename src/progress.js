/**
 * Live progress of a reply being prepared (added 2026-10-20). Website chat shows it under the
 * customer's message ("Looking up your machine in our records…") so they see we are working.
 * In memory only: short-lived, per conversation, gone after a few minutes or when the reply is sent.
 */
const steps = new Map();
const TTL_MS = 5 * 60 * 1000;

function step(conversationId, text) {
  if (!conversationId || !text) return;
  steps.set(String(conversationId), { text: String(text).slice(0, 120), at: Date.now() });
}
function clear(conversationId) {
  if (conversationId) steps.delete(String(conversationId));
}
function get(conversationId) {
  const item = conversationId ? steps.get(String(conversationId)) : null;
  if (!item) return null;
  if (Date.now() - item.at > TTL_MS) { steps.delete(String(conversationId)); return null; }
  return item;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of steps) if (now - v.at > TTL_MS) steps.delete(k); }, 60 * 1000).unref();

module.exports = { step, clear, get };
