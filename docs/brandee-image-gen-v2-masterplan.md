# Brandee Image Generation v2 — Masterplan

Owner decision (2026-08-07): the template artwork is NOT fed to GPT Image 2.
Instead, each template carries its own image-generation prompt stored in the
database. GPT-5.6 Sol merges that prompt with the customer's field answers
into one final prompt, and GPT Image 2 generates the ENTIRE ad image from it
(not just a cleaned product photo).

## Target flow

1. Customer picks a template (e.g. Features & Benefits) and fills the fields.
2. Server loads the template's `imageGenPrompt` from the database.
3. GPT-5.6 Sol receives: imageGenPrompt + all field values + product photo
   description → composes ONE final generation prompt (truthful, no invented
   claims — same honesty rules as productAnalysisService).
4. GPT Image 2 (`images/edits`) is called with the final prompt + the
   customer's product photo as reference image → returns the complete ad.
5. Preview shown (watermarked, low-res). Below it: a revision prompt box.
6. Revision: customer types a change → Sol turns it into an edit instruction
   → GPT Image 2 edit call using the CURRENT generated image as reference
   (editPreviewImage in imageGenProvider.js already does exactly this).
   Every revision is a new appended row — v1 is never overwritten and stays
   previewable/downloadable after register + pay (existing gate).

## What already exists (reuse, don't rebuild)

| Piece | File | Status |
|---|---|---|
| GPT Image 2 generate + edit calls | src/brandee/imageGenProvider.js | Working (verified live 08-07) |
| Sol prompt-composition machinery | src/brandee/creativePlanner.js, productAnalysisService.js callResearchModel | Working |
| Append-only revisions in Postgres | productAdProjectStore.addRevision | Working |
| Register/pay gate for final image | server.js /image/final + requireBrandeeSubscription | Working |
| Revision UI (instruction box) | workspace index.html #revisionCard | Working, currently wired to SVG-plan revisions |

## Build steps

### Phase 1 — template prompts in the database
- [ ] Add `imageGenPrompt TEXT` to the product-ad template model
      (prisma/schema.prisma) + migration.
- [ ] IMPORTANT pre-existing gap: templateCatalog currently falls back to
      code-level defaults because the templates table has NO ACTIVE rows
      (see aistaff-api.launchd.err.log warning). Seed all templates into
      the DB first, then add prompts. Superadmin edit screen optional later.
- [ ] Write one imageGenPrompt per template family. Structure each prompt:
      layout description (columns, badge, CTA placement), mood/colors,
      photography style, and placeholders like {feature}, {customerBenefit},
      {cta}, {productName} that Sol fills from field values.

### Phase 2 — Sol composes the final prompt
- [ ] New composeImagePrompt() in creativePlanner.js: input = template
      imageGenPrompt + form + templateFields; output = single final prompt
      string. Reuse callResearchModel (reasoning_effort handling included).
- [ ] Honesty rules: never invent specs/prices/testimonials; keep visible
      text SHORT (image models render long text poorly) — headline <= 6
      words, CTA <= 4 words; everything longer stays out of the image.

### Phase 3 — wire the preview endpoint
- [ ] /image/preview: replace "clean the background" prompt with
      composeImagePrompt() output; generated image IS the ad. Keep the SVG
      compositor as the honest fallback when generation fails (existing
      degrade posture), plus watermark overlay on top of the generated PNG.
- [ ] /image/revise: branch — if latest revision is a generated image,
      route the instruction through Sol → editPreviewImage(current image).
      SVG-plan revision path stays for fallback previews.
- [ ] Save generated PNGs via imageAssetStore (files on disk, URL in DB) —
      do NOT stuff multi-MB base64 into the revisions table.
- [ ] Quality check on text rendering per template before enabling; add
      per-template flag `generationMode: "image" | "svg"` so weak templates
      can stay on the SVG path.

### Phase 4 — verify
- [ ] Fresh anon: generate → revise twice → v1/v2/v3 all previewable.
- [ ] Register + subscribe → final clean download of ANY version.
- [ ] Kill OPENAI_API_KEY locally → SVG fallback still works.

## Login / accounts plan

Fixed today (commit 64186d4): public Brandee routes now recognize the
session cookie via attachUserIfPresent — logged-in users are no longer
treated as anonymous, so the free-preview limit correctly stops applying.

Remaining decisions:
- [ ] Persistence: JWT + cookie currently expire after 8h (auth.js). For
      customers, extend to 30 days with sliding renewal (re-issue cookie on
      any authenticated request older than 24h). Superadmin can stay at 8h.
- [ ] Home page entry point: aistaff.click header has no Log in link. Add
      "Log in" (goes to /login page, reuse workspace login card styling)
      and show "My account" when the session cookie is valid.
- [ ] Workspace should detect an existing session on load (call a light
      /api/auth/whoami built on attachUserIfPresent, NOT requireAuth which
      401s) and show "Logged in as …" immediately instead of only after a
      manual login this tab.
- [ ] One account system for everyone: users table + platform_role
      (SUPERADMIN vs customer). Customers keep the register-at-the-gate
      flow; no separate Brandee login.
