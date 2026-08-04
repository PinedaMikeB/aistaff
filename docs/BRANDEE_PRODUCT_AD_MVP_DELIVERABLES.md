# Brandee Product-Ad MVP — Deliverables Report

Date: 2026-08-04
Commit: `5caa4dc9ac80aeaa2d3dbd3a47bbe65276c63f84` on `main` (pushed to `origin/main`)

## 1–4. Git safety net

- Original branch: `main`, was clean-but-uncommitted before this task started.
- Checkpoint commit: `7a14bb30ea3df7ff87af44bb9526994ad30576e9` — "chore(brandee): preserve pre-MVP creative planner implementation" (97 files, all prior session work).
- Backup branch: `backup/brandee-pre-product-mvp-2026-08-04`, pushed to `origin`.
- No destructive git operations were used anywhere in this task (no reset --hard, no clean -fd, no force push, no rebase).

## 5–7. Files inspected / changed / created

Inspected before changing anything: the full Brandee landing page, Guided/Pro Mode flows, goal-selection UI, website analyzer/crawler, form pages, creative-plan results page, marketing/Remotion render pipeline, registration/auth (`src/auth.js`), billing (`src/payments.js`, `ensurePricingCatalog()`), Prisma schema, and admin diagnostics.

**Modified (7 files):** `.gitignore`, `public/agents/brandee/index.html`, `public/agents/brandee/create/index.html`, `public/agents/brandee/analyze/index.html`, `remotion/src/Root.tsx`, `src/brandee/crawler.js`, `src/server.js`.

**Created (26 files):** 11 backend modules under `src/brandee/` (pricing config, image templates, video styles, shared schemas, URL extractor, media validation, image renderer + SVG text utils, video teaser renderer, project store, account registration, product-ad billing, analytics events), 1 Remotion composition, 3 new pages/assets under `public/agents/brandee/` (`image/`, `video/`, `product-ad-common.js`), and 11 test files under `test/brandee/`.

Nothing was deleted. All prior advanced planning modules (deep-understanding engine, admin system, crawler, hook scoring, etc.) remain in the codebase, simply no longer the entry point from the landing page.

## 8–11. Routes

**New:** `GET /agents/brandee/image/`, `GET /agents/brandee/video/`, plus a JSON API surface under `/api/public/brandee/product-ads/*` (config, url-extract, image preview/generate, video preview/generate, register, subscribe, track) and `/api/brandee/product-ads/*` for authenticated actions.

**Redirected (deprecated):** `/agents/brandee/create/` and `/agents/brandee/analyze/` now serve a meta-refresh + JS redirect to `/agents/brandee/`, with a defensive Express fallback route registered too. Old saved plan routes were left untouched; no prior customer plans/assets were deleted.

## 12–14. Shared product form / templates / styles

Shared form (`productAdSchemas.js`) requires only: product image, name, description, main features, target customer, desired action. Optional: listing URL, price, offer, main benefit, logo, brand colors, additional images, language, notes, testimonial. No business website, business history, or phone number field exists anywhere in the schema.

8 image-ad templates implemented exactly as specified (Product Highlight through Testimonial Style), each with its own field list; Testimonial Style is programmatically gated behind a real supplied quote+attribution. 6 video-ad styles implemented (UGC Recommendation through Product Showcase) with required-input lists and suggested lengths.

## 15. Product URL extraction

`productUrlExtractor.js` fetches exactly one submitted page via the same SSRF-safe `safeFetchAny`/`assertHostResolvesToPublicIp` primitives the business analyzer already uses (loopback, private, link-local, and cloud-metadata addresses are blocked before any request is made). It never follows links found on the page. On failure it returns the exact required fallback message: "Brandee could not read this product page, so she will use the information you entered." Extracted values are merged into the form without ever overwriting a manually entered value.

## 16–17. Preview generation

**Image:** a dependency-free SVG compositor (`imageAdRenderer.js`) embeds the customer's actual uploaded product image byte-for-byte (never regenerated/altered), composed with template-driven headline/subcopy/CTA/badge text. Free preview is 720×900 with a repeated "BRANDEE PREVIEW" watermark; paid/final render is 1080×1350 with no watermark.

**Video:** `videoTeaserRenderer.js` uses the existing Remotion pipeline via a new `ProductTeaser` composition. A capability probe (`probeVideoProviderAvailability`) checks for a platform-matched compositor binary before attempting any render; if unavailable, it returns an honest `{ ok: false, reason, message }` and never fabricates a teaser. **This render path has not been executed successfully in this sandbox** (Linux arm64 vs. the deployment's macOS arm64 compositor binary) — this is a genuine environment limitation, disclosed here rather than papered over, and should be verified on the real Mac before launch.

## 18. Anonymous limits

`pricingConfig.ANONYMOUS_LIMITS` = one image preview and one video preview per anonymous session, enforced server-side via the existing rate-limiter factory regardless of client input.

## 19–20. Registration / subscription flow

Registration (`accountRegistration.js`) is the first self-serve signup path in this codebase — reuses the existing `User`/`Company` Prisma models and the existing argon2 `hashPassword` from `auth.js`; no parallel identity system. Subscription gating (`productAdBilling.js`) reuses the existing generic `Product`/`PricingPlan`/`Customer`/`Order`/`Subscription` tables (seeds a second `Product` row — "Brandee Product Ads" — at runtime), with `requireBrandeeSubscription()` returning HTTP 402 for unsubscribed users. In non-live `PAYMENT_MODE`, subscriptions activate immediately (mirrors the existing `MockPaymentProvider` test-mode pattern) so the funnel is fully testable without a live payment collector.

## 21. Pricing changes

Image and video allowances are now tracked as separate fields (`imageCreditsPerMonth` / `videoCreditsPerMonth`) — no combined "static ads or videos" wording anywhere. Three tiers (Starter/Creator/Growth), every plan explicitly marked `placeholder: true` with `PRICING_QUANTITIES_ARE_PLACEHOLDERS = true`, and no plan copy anywhere claims "unlimited."

## 22. Preserved resources

100 hook templates, 10 static-ad frameworks, proof-gating rules, goal mappings, hook scoring/safety gates, copy-quality validators, Taglish/Filipino/English support, existing auth, existing billing primitives, and admin diagnostics were all left in place and reused rather than duplicated or deleted.

## 23. Security controls implemented

Magic-byte image validation (not just claimed MIME type) with hard size (5MB) and dimension (32–6000px) limits; a path-scoped 24MB JSON body limit registered before the global 1MB default; rate limiting on preview endpoints via the existing limiter factory; anonymous preview counts tracked server-side; no credit deduction on provider failure; SSRF protections preserved end-to-end for the URL extractor.

## 24. Analytics

`analyticsEvents.js` defines an allow-list of named events and a `track()` helper wired into the client pages via `product-ad-common.js`; no raw product descriptions/images are stored in event properties.

## 25–27. Tests / build / verification

**11 new test files, 225 new tests**, all passing. Notably: `accountRegistration.test.js` and `productAdBilling.test.js` exercise the real DB-touching logic (validation, duplicate-email checks, catalog seeding, subscription activation, the 402 gate) by stubbing `require.cache` for `src/db.js` with an in-memory fake Prisma client — since this sandbox cannot load the darwin-built Prisma engine, a plain `require("../db")` would otherwise crash the process via an unhandled async rejection outside of `server.js`'s global safety net.

**Full suite:** `npm test` → 285 tests, 282 passing, 0 failing, 3 pre-existing skips (unrelated to this change). `node --check` passed on every new/modified file. Manual boot + curl smoke test confirmed all new/redirected routes return HTTP 200.

## 28–30. Commit / push

- Commit: `5caa4dc9ac80aeaa2d3dbd3a47bbe65276c63f84` — "feat(brandee): simplify landing page and add product ad previews".
- Pushed directly to `origin/main` (no branch protection blocked it) via the real Mac's git credentials: `43a5114..5caa4dc main -> main`.
- `git status` clean on both the sandbox-mounted path and the real Mac afterward; local `main` and `origin/main` match exactly.
- Diff and every new file were scanned for secret-like patterns, `.env` files, and credentials before staging — none found.

## Known limitations (disclosed, not hidden)

1. **Video rendering is unverified end-to-end.** The Remotion render path is implemented and its honest-failure behavior is fully tested, but no real render has succeeded anywhere in this session due to the sandbox/deployment platform mismatch. Verify on the real Mac before launch.
2. **Live-mode billing is unverified against a real payment provider.** `subscribeUserToPlan`'s live-mode branch (pending order + webhook activation) reuses the existing Closer checkout's provider code but has not been exercised against a live Xendit/Stripe/manual-transfer flow in this task.
3. **No live database was reachable in this sandbox.** DB-touching modules were verified via require-cache-stubbed unit tests (real logic, fake persistence) and via `node --check`, not against a live Postgres instance.

## Manual testing steps

1. **Image preview:** visit `/agents/brandee/image/`, upload a product photo, fill required fields, pick a template, click "Generate Preview" — expect a watermarked ~720×900 SVG preview and a "Save and finish your image ad" prompt.
2. **Video teaser:** visit `/agents/brandee/video/`, fill the shared form, pick a style, click "Generate 3-Second Preview" — on this sandbox, expect an honest unavailable message (not a fabricated video); on the real Mac with a matching compositor binary, expect an actual 3-second watermarked MP4.
3. **Registration:** after a preview, use the "Create account" action; verify a new `User`+`Company` row is created and the password hash is never returned to the client.
4. **Subscription:** log in, select a plan from the pricing section, subscribe in non-live `PAYMENT_MODE`; verify `GET` on a subscription-gated endpoint now succeeds instead of returning 402.
5. **Final image generation:** as a subscribed user, request the full-resolution export; verify no watermark and 1080×1350 output.
6. **Full video generation:** as a subscribed user on a machine with a matching Remotion compositor binary, request the full video; verify plan-length duration and no watermark.
