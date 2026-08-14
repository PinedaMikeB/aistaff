// Shared in-memory sliding-window rate limiter.
//
// This extracts the pattern already used twice in src/server.js
// (checkSiteChatRateLimit, checkBrandeeRateLimit) into one reusable factory
// instead of a third copy-paste. Same tradeoffs apply: per-process memory,
// resets on restart, fine for a single-instance deployment (this app's
// current deployment model per docs/), not safe for a multi-instance
// deployment without moving to a shared store (e.g. Redis) — noted so this
// doesn't get mistaken for a distributed-safe limiter later.
//
// SCALE (2026-08-12): `store` previously grew without bound — a key was only
// ever removed by an explicit reset(). One entry per distinct key (per IP, per
// email) meant a long-running process accumulated every key it had ever seen.
// At thousands of users, and especially on auth routes where the key space is
// attacker-controlled, that is a slow memory leak. A periodic sweep now drops
// entries whose timestamps have all aged out. The sweep is unref()'d so it
// never holds the process open.

const DEFAULT_SWEEP_MS = 60 * 1000;

function createRateLimiter({ windowMs, max, sweepMs }) {
  const store = new Map();

  /** Drop timestamps older than the window; returns what remains. */
  function prune(entry, now) {
    return entry.filter((t) => now - t < windowMs);
  }

  function check(key) {
    const now = Date.now();
    const entry = store.get(key) || [];
    const recent = prune(entry, now);
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

  /** Evict keys with no timestamps left inside the window. */
  function sweep() {
    const now = Date.now();
    for (const [key, entry] of store) {
      const recent = prune(entry, now);
      if (recent.length === 0) store.delete(key);
      else if (recent.length !== entry.length) store.set(key, recent);
    }
  }

  const timer = setInterval(sweep, Math.max(1000, sweepMs || DEFAULT_SWEEP_MS));
  if (typeof timer.unref === "function") timer.unref();

  return { check, reset, sweep, size: () => store.size };
}

module.exports = { createRateLimiter };
