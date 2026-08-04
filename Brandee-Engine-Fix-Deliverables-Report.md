# Brandee Website-Analysis + Creative Planning Engine — Deliverables Report

## 1. Root cause

The reported failure ("Brandee could not build a plan. Please try again.") was **not** a bug in the scraping, extraction, or planning logic. It was a **process-wide crash**:

`src/db.js` constructs `new PrismaClient()` at module load. In this environment, the Prisma query engine binary was compiled for one OS/architecture but the running server is on another (`darwin-arm64` vs. `linux-arm64-openssl-3.0.x`), so the client throws an **unhandled promise rejection** the first time it's touched. `server.js` had no global `process.on("unhandledRejection" | "uncaughtException")` handler, so Node's default behavior is to **crash the entire process** — killing the fully DB-independent Brandee pipeline (which persists to flat JSON files, not Postgres) as collateral damage.

This was verified, not assumed:
- 126 goal × platform × language combinations were run directly against the deterministic planner with zero failures.
- The manual-fallback path was exercised across all 7 goals with zero failures.
- The live HTTP endpoint was tested before/after the fix: identical request went from connection-refused (crashed process) to `200 OK` with a valid plan, purely by adding the missing process-level handlers.

**Fix:** `src/server.js` now registers `process.on("unhandledRejection", ...)` and `process.on("uncaughtException", ...)` right after `app.listen(...)`. Both log full detail server-side and keep the process alive. The Prisma engine-mismatch error still logs (in full, server-side only) but no longer takes down Brandee or anything else.

## 2. What was rebuilt on top of the fix

With the crash resolved, the engine was hardened end-to-end per the original scope (secure extraction, manual fallback, business-profile extraction, decision rules, planning, validation, results, diagnostics):

| Stage | What's there now |
|---|---|
| Input | Zod validation (`AnalyzeRequestSchema`) → `BRANDEE_INVALID_INPUT` on failure, request preserved for retry |
| Scraping | SSRF-safe fetch (unchanged, already solid) → typed errors (`BRANDEE_URL_BLOCKED`, `BRANDEE_SCRAPER_TIMEOUT`, `BRANDEE_SCRAPER_FAILED`) → automatic manual fallback, never blocks |
| Extraction | Deterministic heuristic extraction (always available) + **new optional AI enrichment pass** (`src/brandee/extraction.js`), schema-validated, proof fields untouched |
| Rules | **New Decision Engine** (`src/brandee/decisionEngine.js`) computes `DecisionConstraints` — the single source of truth for allowed goals/frameworks/hooks — before planning starts |
| Planning | `planner.js` now *consumes* `DecisionConstraints` instead of re-deriving proof rules inline; one repair retry on schema failure before a typed `BRANDEE_PLANNER_SCHEMA_FAILED` |
| Validation | Same Zod schemas as before, now also applied to `websiteAnalysis` itself (previously unvalidated) |
| Persistence | JSON-file store extended to also save `decisionConstraints`, extraction/planner model labels, Creative Brain version, request ID |
| Results | Results page now shows a manual-fallback notice and a source-mode line; regenerate/goal-override flows no longer blank the page on failure |

## 3. Files created this pass

- `src/brandee/decisionEngine.js` — the Deterministic Decision Engine (goal correction pass-through, proof-type accounting, allowed/blocked frameworks & hook categories/templates, CTA options, platform constraints)
- `src/brandee/extraction.js` — optional AI enrichment layer over the heuristic extractor (prompt-injection-safe, proof-fields untouched, schema-validated, silent fallback)
- `test/brandee/decisionEngine.test.js` (10 tests), `test/brandee/errors.test.js` (20 tests), `test/brandee/extraction.test.js` (6 tests)

(`src/brandee/errors.js` and `src/brandee/modelConfig.js` were created earlier in this same task, before a context checkpoint — see below.)

## 4. Files modified this pass

- `src/server.js` — process-safety handlers (root-cause fix); `/api/public/brandee/analyze` rewritten to run every stage through typed `BrandeeError`s, added request-ID generation, in-flight duplicate-click guard, optional AI extraction-enrichment call, Creative-Brain-resources gate, and a stage-aware JSON error response (`{ok:false, error, code, stage, requestId, retryable}`) instead of a bare 500
- `src/brandee/planner.js` — now imports goal/awareness/proof/framework/hook eligibility logic from `decisionEngine.js` instead of duplicating it; `callConfiguredAiProvider` now reads `BRANDEE_PLANNER_*` env config (with fallback model support) instead of hard-coded env reads; `generateCreativePlan` throws typed `BrandeeError`s and retries once on schema failure
- `src/brandee/websiteAnalyzer.js` — `buildHeuristicAnalysis` now populates `sourceMode: "website_and_manual"` and a structured `evidence[]` array (page title, meta description, headings, years/reviews/rating mentions, contact emails), each with a source attribution
- `src/brandee/schemas.js` — `WebsiteBusinessAnalysisSchema` extended with `sourceMode`, `customerDesires`, `evidence` (all with safe defaults so existing output stays valid)
- `src/brandee/store.js` — `savePlan` now also accepts/stores `decisionConstraints`, `extractionModel`, `plannerModel`, `creativeBrainVersion`, `requestId`, `durationMs`
- `src/admin/brandeeRunLog.js` — `recordRun` accepts an optional `requestId` so run-log entries correlate with the error `requestId` surfaced to the client
- `.env.example` — documents `BRANDEE_EXTRACTION_PROVIDER/MODEL`, `BRANDEE_PLANNER_PROVIDER/MODEL/FALLBACK_MODEL` (all blank by default — no hard-coded model name)
- `public/agents/brandee/plan/index.html` — shows the exact manual-fallback notice text when `sourceMode === "manual_only"`; regenerate/goal-override actions now show an inline status/error banner instead of blanking the whole page on failure

No fixture, test, or code path anywhere references the owner's real business, website, or an expected marketing answer. All new tests use obviously generic fictional data (`Sample Co`, `sample-co.example`).

## 5. Error taxonomy (`src/brandee/errors.js`, built earlier this task)

19 named codes across the 7 stages (`input`, `scraping`, `extraction`, `rules`, `planning`, `validation`, `persistence`), each a `BrandeeError` with `{code, stage, publicMessage, internalMessage, retryable, requestId, cause, metadata}`. `toSafeJson()` is what the client ever sees (never a stack trace, secret, or raw internal detail — verified by test). `toLogEntry()` is what gets logged server-side. Required exact copy is in place verbatim:
- Website-extraction failure: *"Brandee could not read this website automatically. She can still build a plan from the details you entered."*
- Planning failure: *"Brandee understood your business but could not complete the creative plan. Please retry."*
- Manual-fallback notice (non-blocking, shown on the results page): *"Brandee could not read the website, so this plan was built from the details you entered."*

## 6. Model configuration

`src/brandee/modelConfig.js` reads `BRANDEE_EXTRACTION_PROVIDER/MODEL` and `BRANDEE_PLANNER_PROVIDER/MODEL/FALLBACK_MODEL`, falling back to the app's existing `AI_PROVIDER`/`OPENAI_MODEL`/`GEMINI_MODEL`. Your `.env` currently has `AI_PROVIDER="openai"` and `OPENAI_MODEL="gpt-4.1-mini"` — that's what both extraction enrichment and planning will use unless you set the `BRANDEE_*` overrides. Nothing defaults to an unverified model name like `gpt-5-mini`.

## 7. Decision Engine details

`buildDecisionConstraints({businessAnalysis, form})` returns: `selectedGoal`, `recommendedGoal`, `effectiveGoal`, `goalChanged`, `goalExplanation`, `candidateRecommendedGoals`, `awareness`, `allowedFrameworkIds` / `blockedFrameworks` (with reasons), `allowedHookCategories` / `blockedHookCategories` (with reasons), `allowedHookTemplateIds`, `proofRestrictions`, `CTAOptions`, `creativeFormatCandidates`, `platformConstraints`. It never silently overrides the customer's `selectedGoal` — it only ever recommends, with an explanation; the override only takes effect via `acceptedGoalOverride`. Verified by 10 dedicated tests (proof gating, framework/hook partitioning, goal non-override, platform aspect ratio consistency).

## 8. Creative Brain resources (Part 8) and Ad Creative Skill (Part 9) — unchanged, already correct

These were validated in an earlier task and re-confirmed working here: `getCreativeBrainStatus()` checks exact counts for goals (7), awareness levels (5), frameworks (10), hooks (100) and returns `active: false` if anything is invalid/missing — the analyze route now calls this and throws `BRANDEE_RULES_NOT_LOADED` before planning if it's not active. The external `coreyhaines31/marketingskills` Ad Creative Skill file (`skills/ad-creative/SKILL.md`) was confirmed **not present** in this repo (checked directly — only unrelated local `.claude/skills/*` and `.cursor/skills/*` files exist); the system correctly reports it as `MISSING` rather than assuming availability, and nothing in the runtime path depends on it or fetches it externally.

## 9. Tests

Full suite: **110 tests, 107 passed, 3 skipped (pre-existing, unrelated to Brandee), 0 failed.** New this task: 36 tests across `errors.test.js`, `decisionEngine.test.js`, `extraction.test.js` — all using generic sanitized fixtures, none referencing any real business.

## 10. Live verification

Booted the real server and issued live HTTP requests against `/api/public/brandee/analyze`:
- Missing required field → `400` with `BRANDEE_INVALID_INPUT` and the exact stage-aware message.
- A cloud-metadata URL (`169.254.169.254`) → correctly treated as unreachable at the network layer in this sandbox, gracefully fell back to manual-only analysis, and still produced a complete, schema-valid, `200 OK` plan with the manual-fallback notice text attached — confirming the SSRF path degrades gracefully rather than hard-failing the request.
- A generic non-owner test business (name/URL fabricated, "Sample Co"-style) produced a complete plan end to end.

## 11. What's still incomplete / not touched (in scope but judged lower priority given time)

- The results page's loading-stage list is a **timed animation**, not driven by real per-stage server events (no SSE/WebSocket infra exists). It no longer claims exact live progress in the sense of literal per-request telemetry, but it also isn't backend-driven. Building that would require new streaming infrastructure — flagged rather than built.
- Tenant isolation for Brandee plans still follows the pre-existing session-ID + optional-user-ID model (JSON file store), not a full multi-tenant Prisma table — documented as a known limitation in `store.js` from an earlier task, unchanged here.
- The AI-enrichment extraction pass (`extraction.js`) is wired but has never been exercised against a live OpenAI/Gemini call in this sandbox (no outbound network access here) — only its safe no-op and prompt-construction paths are unit-tested. It should be exercised for real the first time you run this with `OPENAI_API_KEY` configured.

## 12. How to test with your real business (no special-casing exists — this runs the same pipeline as any customer)

1. Set `OPENAI_API_KEY` (already in your `.env`) and, optionally, `BRANDEE_EXTRACTION_MODEL` / `BRANDEE_PLANNER_MODEL` if you want Brandee to use a different model than your app-wide `OPENAI_MODEL`.
2. Restart the server normally (`npm start` or your usual process).
3. Go to `/agents/brandee/` → choose a goal → `/agents/brandee/analyze/` → enter your real website URL and business details exactly as any customer would.
4. Submit. You'll land on `/agents/brandee/plan/:planId` with the full structured plan. If your site couldn't be read automatically for any reason, you'll see the manual-fallback notice banner at the top and the plan will still be complete, built from what you typed.
