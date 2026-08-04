const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const { createRateLimiter } = require("../../src/admin/rateLimit");

test("createRateLimiter allows up to `max` requests per key within the window, then blocks", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 3 });
  assert.equal(limiter.check("ip-a").allowed, true);
  assert.equal(limiter.check("ip-a").allowed, true);
  assert.equal(limiter.check("ip-a").allowed, true);
  const fourth = limiter.check("ip-a");
  assert.equal(fourth.allowed, false);
  assert.ok(fourth.retryAfterMs > 0);
});

test("createRateLimiter tracks keys independently (one user's usage never blocks another)", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
  assert.equal(limiter.check("user-1").allowed, true);
  assert.equal(limiter.check("user-1").allowed, false);
  assert.equal(limiter.check("user-2").allowed, true);
});

test("createRateLimiter.reset() clears a key's history", () => {
  const limiter = createRateLimiter({ windowMs: 60_000, max: 1 });
  assert.equal(limiter.check("k").allowed, true);
  assert.equal(limiter.check("k").allowed, false);
  limiter.reset("k");
  assert.equal(limiter.check("k").allowed, true);
});

// --- Brandee run log (JSON-file backed, no live DB required) ---
const runLogPath = path.join(__dirname, "..", "..", "data", "brandee-run-log.json");
let originalContents = null;

test("brandeeRunLog: setup — snapshot any existing run log so this test suite doesn't corrupt real data", () => {
  originalContents = fs.existsSync(runLogPath) ? fs.readFileSync(runLogPath, "utf8") : null;
});

test("recordRun + listRuns + getRunStats round-trip correctly for both success and failure", () => {
  delete require.cache[require.resolve("../../src/admin/brandeeRunLog")];
  const runLog = require("../../src/admin/brandeeRunLog");

  fs.mkdirSync(path.dirname(runLogPath), { recursive: true });
  fs.writeFileSync(runLogPath, "[]");

  runLog.recordRun({ status: "success", submittedUrl: "https://example.com/", selectedGoal: "messages", recommendedGoal: "messages", durationMs: 120 });
  runLog.recordRun({ status: "failed", submittedUrl: "https://unreachable.example/", selectedGoal: "purchase", failedStage: "website_fetch", safeErrorCode: "ADMIN_SERVICE_UNAVAILABLE", durationMs: 50 });

  const runs = runLog.listRuns({ limit: 10 });
  assert.equal(runs.length, 2);
  // Newest-first ordering.
  assert.equal(runs[0].status, "failed");
  assert.equal(runs[0].submittedDomain, "unreachable.example");
  assert.equal(runs[1].status, "success");
  assert.equal(runs[1].submittedDomain, "example.com");

  const stats = runLog.getRunStats();
  assert.equal(stats.totalAttempts, 2);
  assert.equal(stats.successCount, 1);
  assert.equal(stats.failedCount, 1);
  assert.equal(stats.successRate, 50);
  assert.equal(stats.lastFailedRun.safeErrorCode, "ADMIN_SERVICE_UNAVAILABLE");
  assert.equal(stats.lastSuccessfulRun.selectedGoal, "messages");
});

test("recordRun never stores raw submitted business text — only the hostname and safe fields", () => {
  delete require.cache[require.resolve("../../src/admin/brandeeRunLog")];
  const runLog = require("../../src/admin/brandeeRunLog");
  fs.writeFileSync(runLogPath, "[]");

  runLog.recordRun({ status: "success", submittedUrl: "https://marga.biz/pricing?x=1", selectedGoal: "messages" });
  const [entry] = runLog.listRuns({ limit: 1 });
  const keys = Object.keys(entry);
  assert.ok(!keys.includes("whatYouSell"));
  assert.ok(!keys.includes("idealCustomer"));
  assert.ok(!keys.includes("additionalInfo"));
  assert.equal(entry.submittedDomain, "marga.biz");
});

test("brandeeRunLog: teardown — restore the original run log contents", () => {
  if (originalContents === null) {
    if (fs.existsSync(runLogPath)) fs.writeFileSync(runLogPath, "[]");
  } else {
    fs.writeFileSync(runLogPath, originalContents);
  }
});
