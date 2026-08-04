# Brandee Template Workflows & Pricing — Deliverables Report

Date: 2026-08-04
Commit: `afba6ab` (pushed to `origin/main`)
Starting checkpoint: `84e449b` (previous session's "docs(brandee): add product-ad MVP deliverables report")
Branch: no separate backup/feature branch was needed — `origin/main` had not diverged from local `main` at fetch time, so the commit was pushed directly to `main` per the task's "push to main when safe" instruction. No force-push was used.

## 1. Super Admin — what already existed, reused as-is

A full platform-role admin system already existed and was **not replaced**:
`User.platform_role` (`null | "SUPERADMIN" | "SUPPORT_ADMIN"`) is a second, tenant-independent permission axis, enforced server-side in `src/adminAuth.js` (`requireSuperAdminApi` / `requireSuperAdminPage`), re-read from Postgres on every request (never trusted from a JWT or client input). TOTP-based MFA (`src/admin/totp.js`), encrypted secrets, hashed backup codes, and an append-only `AdminAuditLog` (`src/admin/auditLog.js`) were already in place. This session only **added routes and UI inside that same system** — no parallel admin was built.

- **Real login URL:** `/superadmin/login` (verified with a live `curl` against a locally booted instance — returns `200`).
- **Real assignment command:** `node scripts/assign-superadmin.js` — an **interactive**, local-only CLI script. It does **not** accept `--email=` or any flags; it prompts for the target email, optionally creates the account, prompts for `SUPERADMIN` / `SUPPORT_ADMIN` / `NONE`, and requires re-typing the email as an explicit confirmation before writing anything. It refuses to demote the last active `SUPERADMIN`. No secrets are ever printed back.
- **MFA behavior:** not yet enforced as a hard gate — `requireMfaIfEnabled` allows the request through with `req.mfaWarning` set if the operator hasn't turned MFA on yet. This is a pre-existing, documented bootstrap trade-off, unchanged by this session.

See Section 10 for the exact manual login walkthrough.

## 2. Pricing — central config, exact figures

`src/brandee/pricingConfig.js` is the **single source of truth**; nothing else hard-codes a price or allowance. It exports `PLANS` (exactly `image_starter`, `video_starter`, `brandee_combo`), `DEFAULT_TAX_CONFIG` (`NON_VAT`, `pricesAreTaxInclusive: true`, `vatRatePercent: 12`), `computeTaxBreakdown()`, and `computeComboSavings()`.

| Plan | Price/mo (PHP) | Image allowance | Video allowance | Brand kits | Products | Notes |
|---|---|---|---|---|---|---|
| Image Starter | 599 | 10 final images/cycle, low-res previews, 1080p export | — | 1 | 5 | English/Filipino/Taglish |
| Video Starter | 1,199 | — | 60 finished seconds/cycle (2×30s / 4×15s / 1×60s), 3s teaser | 1 | 5 | 1080p when supported |
| Brandee Combo | 2,999 | 20 images/cycle | 120 seconds/cycle | 3 | 20 | Multiple aspect ratios, priority rendering |

Combo savings: 2×599 + 2×1,199 = 3,596 vs 2,999 → **save ₱597 (≈16.6%)**, wording "Save ₱597 compared with equivalent Starter allowances" — present verbatim on the landing page and asserted by a test.

Tax disclosure: the landing page states the company is non-VAT registered and that "no 12% VAT is added to these prices" — never "VAT included," never a silent 12% addition, and the internal 3% percentage-tax reserve is never exposed as a customer-facing charge. `computeTaxBreakdown()` already produces the exact VAT-inclusive breakdown figures for a future `VAT` mode switch — flipping `taxMode` will not change any published price.

Billing wiring: `productAdBilling.js`'s `ensureBrandeeProductAdsCatalog()` seeds one `Product` + one `PricingPlan` row per plan into the **existing** generic commerce schema (`Product` → `PricingPlan` → `Subscription`) — no new billing tables.

## 3. Data model additions (Prisma)

Four new models, one new relation, no destructive changes to existing tables:

- `StaticAdTemplate` — slug, name, description, category, bestUse, requiredFields, proofRequirement, overlaySchema (normalized 0–1 bounding boxes per editable region), supportedAspectRatios, renderingMode (`COMPOSITE_TEMPLATE` | `AI_GENERATED_LAYOUT`), status (`DRAFT|ACTIVE|INACTIVE|ARCHIVED`), version, parentTemplateId, publishedAt.
- `UgcTemplate` — the video/UGC equivalent: storyboardSchema, sceneSchema, creator/voice/script requirements, supportedDurations, supportedAspectRatios, languages, providerConfiguration (validated to contain no secret-like values), same status/versioning shape.
- `BrandeePricingConfig` — taxMode, pricesAreTaxInclusive, vatRatePercent, plans (JSON snapshot), status (`draft|published|archived`), publishedAt.
- `BrandeeEntitlementEvent` — append-only ledger: customer_id, subscription_id, unit (`IMAGE_FINAL|VIDEO_SECONDS`), eventType (`RESERVE|CONSUME|RELEASE|REFUND`), amount, projectId, idempotencyKey, reason, createdAt.
- `Customer.brandee_entitlement_events` back-relation added.

### Migrations (hand-authored, matching the project's existing migration file convention)

1. `prisma/migrations/20260804120000_add_brandee_templates_pricing_entitlements/migration.sql` — creates all four tables.
2. `prisma/migrations/20260804130000_fix_entitlement_event_idempotency_uniqueness/migration.sql` — see Section 8; narrows the entitlement ledger's uniqueness constraint from `idempotencyKey` alone to `(idempotencyKey, eventType)`.

Both migrations have been **applied to the real local Postgres database** via `npx prisma migrate deploy` (confirmed via `_prisma_migrations` and `pg_indexes`/`pg_constraint` inspection) and the Prisma client was regenerated (`npx prisma generate`).

**Exact production migration commands** (run from the repo root, with `DATABASE_URL` pointing at production):

```
npx prisma migrate deploy
npx prisma generate
node prisma/seed.js
```

`migrate deploy` only applies pending migrations in order and never resets or drops data. `prisma/seed.js`'s new `seedBrandeeTemplatesAndPricing()` step is idempotent — it checks for an existing row by slug (or an existing published pricing config) before creating anything, so it is safe to run against a database that already has data, including a database that already ran an earlier version of this seed.

## 4. Image Ad workflow (`/agents/brandee/image/`)

Step 1 (product form) now has structured price/offer fields — `regularPrice`, `promoPrice`, `discountText`, `offerExpirationDate`, `offerDetails` — replacing the old single "Offer or discount" free-text field, validated by `productAdSchemas.js`'s extended `SharedProductFormSchema`. No discounts, deadlines, testimonials, or guarantees are ever invented; a testimonial-style template is hard-blocked without a real testimonial (`hasRealTestimonial`).

Step 2 (template selection) now pulls from `templateCatalog.js`, which reads live `ACTIVE` `StaticAdTemplate` rows from Postgres and falls back to the code-level `imageAdTemplates.js` array only if the database is unreachable (graceful degradation, not a silent swap). All 10 required templates exist and are seeded ACTIVE: Product Highlight, Feature and Benefit, Offer or Promo, Problem and Solution, Question Ad, Comparison, Minimal Ecommerce, Testimonial Style, Before and After, Bold Claim — mapped onto the existing static-ad frameworks (Bold Claim, iPhone Notes, Features & Benefits, Before & After, Offer, Testimonial, Question, Us vs Them, Reasons Why, Sticky Notes).

Step 3 (preview) and Step 4 (Save & Finish) are wired through `entitlements.withReservedEntitlement()` on the `/image/final` route: one `IMAGE_FINAL` unit is reserved before generation, consumed only on success, and released (never charged) on failure. Previews never touch the entitlement ledger. Anonymous users hit a hard 402/registration gate before final generation; anonymous projects are claimable after registration without allowing cross-user hijacking (ownership is checked against the authenticated user's id, not merely presence of a project id).

## 5. Video Ad workflow (`/agents/brandee/video/`)

Reuses the same shared product-form schema and data model — no duplicated product model. `videoAdStyles.js` now has all 8 required styles (added Founder or Expert Style and Voiceover Product Ad to the original 6). `templateCatalog.js` provides the same DB-backed/code-fallback pattern for `UgcTemplate` rows. The 3-second teaser (`PREVIEW_DURATION_SECONDS = 3`) is a real generated, watermarked, low-resolution asset attempt — when the configured video provider is unavailable, generation fails honestly (`generateVideoTeaser`/`generateFinalVideo` never fabricate a result); this is disclosed rather than hidden, since no video-generation API key exists in this environment. Final-video entitlement accounting is **seconds-based** (`VIDEO_SECONDS`), not "per video."

**Known, disclosed gap:** `public/agents/brandee/video/index.html` still does not have the same structured price/offer fields as the image flow's Step 1 (it shares the same underlying schema and validation, but the video page's own form markup wasn't rebuilt to expose those fields in this session). Functionally the video flow still works because the shared schema treats those fields as optional; this is a real, disclosed scope gap for a follow-up.

## 6. Super Admin: templates and pricing

New routes (all under the existing `/superadmin` shell, `SUPERADMIN`-only for writes):

- `/superadmin/brandee/templates` — hub linking to static and UGC lists.
- `/superadmin/brandee/templates/static`, `/superadmin/brandee/templates/static/new` — list/search/filter by status, create, edit (creates a new version if the template is already published), duplicate, activate/deactivate/archive, and a test-preview action.
- `/superadmin/brandee/templates/ugc`, `/superadmin/brandee/templates/ugc/new` — same capabilities for UGC/video styles.
- `/superadmin/brandee/pricing` — draft/publish workflow: edit a draft, publish it (archives the previously published config inside one transaction), view history. No retroactive changes are made to already-paid billing periods — publishing only affects the config used for *new* balance calculations going forward; past `BrandeeEntitlementEvent` rows are never rewritten.

The template editor exposes **normalized-coordinate bounding-box fields** (x/y/width/height, 0–1) per overlay region — this satisfies the spec's "at minimum" bar for editable areas; a full drag-and-drop visual editor was not built in this session (disclosed scope reduction).

## 7. Audit logging, storage, versioning

- `src/admin/auditLog.js` gained ~15 new `AUDIT_ACTIONS` entries covering template create/update/status-change/duplicate and pricing draft/publish actions. Metadata is scrubbed of secret-like keys before persistence, and raw customer product data is never logged — only template/pricing identifiers and actor.
- Template asset storage continues to use the project's existing validated, path-traversal-safe file storage; no new upload path deletes an asset that an existing customer project still references.
- Versioning (`src/admin/brandeeTemplates.js`'s `updateTemplate()`): editing a `DRAFT` template mutates it in place (safe — no project could reference it yet); editing an `ACTIVE`/`INACTIVE`/`ARCHIVED` template creates a **new row** with `version + 1` and `parentTemplateId` pointing at the old row, leaving the original completely untouched. Verified by a real database integration test (`test/admin/brandeeTemplatesAndPricing.test.js`).

## 8. The entitlement-ledger bug found and fixed this session

While running the full test suite against a **real** local Postgres database (not a mock — the sandbox environment cannot reach any database, so this required the desktop-side Node/Postgres setup), two integration tests failed with `PrismaClientKnownRequestError: Unique constraint failed on the fields: (idempotencyKey)`.

Root cause: `entitlements.js`'s `release()` intentionally writes a `RELEASE` event using the **same** `idempotencyKey` as its originating `RESERVE` event, so the pure `computeRemaining()` function can group them by key and net a released reservation back out of the balance. The original migration declared `idempotencyKey` bare-`@unique`, which made that second, intentional write fail.

Fix: narrowed the database constraint to `@@unique([idempotencyKey, eventType])` (a duplicate `RESERVE`, or a duplicate `RELEASE`/`CONSUME`, of the same event is still rejected — only the legitimate RESERVE+RELEASE/CONSUME pair is now allowed), updated `reserve()`/`consume()`/`release()` in `src/brandee/entitlements.js` to look up reservations via the new composite key, wrote and applied migration `20260804130000_fix_entitlement_event_idempotency_uniqueness` (verified against `pg_indexes` before and after), and re-ran the full suite.

## 9. Tests and build

- `npm test` (Node's built-in test runner, the project's existing framework): **339 passed, 0 failed, 0 skipped** — run against the real local Postgres database, so every DB-backed test (template lifecycle, versioning, pricing draft/publish, entitlement reserve/consume/release) ran for real rather than self-skipping.
- Production-mode boot smoke test: no bundler build step exists in this project (`package.json` has no `build` script — it's a plain Express server plus static HTML). Verified instead by booting `node src/server.js` with `NODE_ENV=production` on a scratch port (the repo's normal port 3000 was already occupied by a running instance, which was left untouched) and confirming `200` responses from `/agents/brandee/`, `/agents/brandee/image/`, `/agents/brandee/video/`, `/superadmin/login`, and `/api/public/brandee/product-ads/config` (its JSON payload was inspected and matches the exact plan prices/entitlements/copy above, confirmed as served from the live database, not the code fallback). `node --check` passed on every file under `src/`.

## 10. Manual Super Admin login guide (verified, not guessed)

1. From the repo root, run: `node scripts/assign-superadmin.js`
2. Enter the target account's email when prompted. If no account exists yet, answer `yes` to create one and provide a name and temporary password (8+ characters).
3. When asked to set the platform role, type `SUPERADMIN`.
4. Re-type the same email exactly when asked to confirm — this is the only thing that commits the change.
5. Go to `/superadmin/login` in a browser and sign in with that account's email/password.
6. Immediately visit `/superadmin/security` and enable MFA (soft-allowed but not yet enforced if skipped).
7. Brandee-specific management is under `/superadmin/brandee/templates` (static + UGC template CRUD) and `/superadmin/brandee/pricing` (draft/publish pricing).

## 11. Remaining limitations (disclosed)

- No drag-and-drop visual template editor — numeric normalized bounding-box fields instead (meets the spec's stated minimum).
- `AI_GENERATED_LAYOUT` exists only as a schema enum value; there is no GPT-Image-style integration in this codebase to back it, so only `COMPOSITE_TEMPLATE` rendering is functional.
- Video Ad Step 1 form does not yet expose the same structured price/offer fields as the Image Ad flow (shared schema supports it; the video page's markup wasn't rebuilt).
- No dedicated "Generation Runs" admin view separate from the existing "Plan Runs" log was built — the nav label was deliberately left as-is rather than mislabeled.
- MFA is not a hard gate for Super Admin actions yet (pre-existing bootstrap trade-off, unchanged).
- An untracked `Assets/Static Ads Template/` folder of reference images was found in the working directory during this session (appears to be source material for the static-ad frameworks). It was left untouched and was not committed, since it wasn't part of this task's scope.
