// Shared in-memory sliding-window rate limiter.
//
// This extracts the pattern already used twice in src/server.js
// (checkSiteChatRateLimit, checkBrandeeRateLimit) into one reusable factory
// instead of a third copy-paste. Same tradeoffs apply: per-process memory,
// resets on restart, fine for a single-instance deployment (this app's
// current deployment model per docs/), not safe for a multi-instance
// deployment without moving to a shared store (e.g. Redis) — noted so this
// doesn't get mistaken for a distributed-safe limiter later.

function createRateLimiter({ windowMs, max }) {
  const store = new Map();

  function check(key) {
    const now = Date.now();
    const entry = store.get(key) || [];
    const recent = entry.filter((t) => now - t < windowMs);
    if (recent.length >= max) {
      return { allowed: false, retryAfterMs: windowMs - (now - recent[0]) };
    }
    recent.push(now);
    store.set(key, recent);
    return { allowed: true, retryAfterMs: 0 };
  }

  function reset(key) {
    store.delete(key);
  }

  return { check, reset };
}

module.exports = { createRateLimiter };
