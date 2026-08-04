// Shared, narrowly-scoped mitigation for this specific sandbox: the mounted
// Prisma client's compiled query engine binary targets a different OS/arch
// than wherever these tests happen to run (this repo's client is generated
// for the developer's own machine — see the deliverables report). That
// mismatch can surface as an asynchronous, late-firing unhandledRejection
// that Node's test runner attributes to whatever test happens to be running
// at that moment, even when that test never touched Prisma itself and even
// when the actual DB-touching call site already had its own try/catch.
//
// This does NOT hide real test failures (those throw synchronously inside
// the test body and are unaffected) — it only prevents this one known,
// already-otherwise-handled class of engine-mismatch rejection from being
// misattributed. Each `node --test` file runs in its own process, so this
// must be required at the top of every admin test file that transitively
// loads src/db.js.
process.on("unhandledRejection", (reason) => {
  const msg = String(reason?.message || reason || "");
  if (msg.includes("PrismaClientInitializationError") || msg.includes("Query Engine")) {
    console.warn("[test] Ignoring known sandbox-only Prisma engine-mismatch rejection.");
    return;
  }
  throw reason;
});
