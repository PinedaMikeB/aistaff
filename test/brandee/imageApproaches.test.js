const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..", "..");
const approachesPath = path.join(root, "public", "agents", "brandee", "image", "approaches", "index.html");
const workspacePath = path.join(root, "public", "agents", "brandee", "image", "workspace", "index.html");
const approachesHtml = fs.readFileSync(approachesPath, "utf8");
const workspaceHtml = fs.readFileSync(workspacePath, "utf8");

test("Image Creative Approaches and workspace pages exist", () => {
  assert.ok(fs.existsSync(approachesPath));
  assert.ok(fs.existsSync(workspacePath));
});

test("approaches page uses customer-facing names and preserves framework labels", () => {
  for (const name of ["Compare the Difference", "Show Features & Benefits", "Give Them Reasons", "Show the Transformation", "Lead With a Strong Message", "Personal Note Style", "Promote an Offer", "Open With a Question", "Sticky Note Style", "Customer Story"]) {
    assert.match(approachesHtml, new RegExp(name.replace(/[&]/g, "\\&")));
  }
  assert.match(approachesHtml, /framework/);
  assert.match(approachesHtml, /Needs a real offer/);
  assert.match(approachesHtml, /Needs a real customer quote/);
});

test("approaches page selects an exact template and persists it for the workspace", () => {
  assert.match(approachesHtml, /sessionStorage\.setItem\("brandeeSelectedTemplate"/);
  assert.match(approachesHtml, /templateId=\$\{encodeURIComponent\(selected\.id\)\}/);
  assert.match(approachesHtml, /Create With This Template/);
  assert.match(approachesHtml, /touchstart/);
  assert.match(approachesHtml, /data-prev/);
  assert.match(approachesHtml, /data-next/);
  assert.match(approachesHtml, /Use This Template/);
  assert.match(approachesHtml, /use_this_template_clicked/);
  assert.doesNotMatch(approachesHtml, /data-approach-focus/);
  assert.doesNotMatch(approachesHtml, />View Templates</);
});

test("approaches page overrides shared modern-home carousel rules and keeps document scrolling", () => {
  assert.match(approachesHtml, /body\.approaches-page[^}]*overflow-y:auto/);
  assert.match(approachesHtml, /\.modern-home\.approaches-page \{ overflow:visible; \}/);
  assert.match(approachesHtml, /\.modern-home\.approaches-page \.carousel-track[^}]*height:auto/);
  assert.match(approachesHtml, /\.modern-home\.approaches-page \.template-image-shell img[^}]*object-fit:contain/);
  assert.match(approachesHtml, /\.modern-home\.approaches-page \.template-image-shell img[^}]*opacity:1/);
  assert.doesNotMatch(approachesHtml, /approaches-page[^}]*position:\s*(fixed|sticky)/);
  assert.match(approachesHtml, /\.approach-jump-wrap \{ position:sticky/);
});

test("approaches page resolves public template URLs and provides loading/failure states", () => {
  assert.match(approachesHtml, /function resolveTemplatePreviewUrl\(template\)/);
  assert.match(approachesHtml, /thumbnailUrl, template\.thumbnail, template\.previewUrl, template\.previewImageUrl, template\.sourceAssetUrl/);
  assert.match(approachesHtml, /FALLBACK_PREVIEW_URL/);
  assert.match(approachesHtml, /template-image-skeleton/);
  assert.match(approachesHtml, /template-image-fallback/);
  assert.match(approachesHtml, /template_image_load_failed/);
  assert.match(approachesHtml, /const imported=matches\.filter\(\(t\) => \/\\\/imported\\\//);
  assert.doesNotMatch(approachesHtml, /\/Volumes\//);
  assert.doesNotMatch(approachesHtml, /file:\/\//);
});

test("approaches page presents portrait examples with accessible motion and active navigation", () => {
  assert.match(approachesHtml, /aspect-ratio:4\/5/);
  assert.match(approachesHtml, /loading="\$\{index === 0 \? "eager" : "lazy"\}"/);
  assert.match(approachesHtml, /ArrowLeft/);
  assert.match(approachesHtml, /ArrowRight/);
  assert.match(approachesHtml, /aria-current/);
  assert.match(approachesHtml, /IntersectionObserver/);
  assert.match(approachesHtml, /prefers-reduced-motion:reduce/);
  assert.match(approachesHtml, /Create With This Template/);
  assert.match(approachesHtml, /create_with_template_clicked/);
  assert.match(approachesHtml, /const AUTOPLAY_MS = 2500/);
  assert.match(approachesHtml, /mouseenter/);
  assert.match(approachesHtml, /visibilitychange/);
  assert.match(approachesHtml, /matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(approachesHtml, /data-carousel-toggle/);
  assert.match(approachesHtml, /aria-pressed/);
  assert.match(approachesHtml, /setImagePaused/);
  assert.doesNotMatch(approachesHtml, /<span class="framework">/);
});

test("approach carousel autoplay interval is fast but not jarring, and slide count no longer shows a redundant audience label", () => {
  const match = approachesHtml.match(/const AUTOPLAY_MS = (\d+)/);
  assert.ok(match, "AUTOPLAY_MS constant not found");
  const interval = Number(match[1]);
  assert.ok(interval >= 2500 && interval <= 4500, `AUTOPLAY_MS (${interval}) is outside the sane 2500-4500ms range`);
  // Slide transition itself stays a smooth 300-450ms range — only the wait
  // between slides should have changed.
  assert.match(approachesHtml, /transition:transform \.4s cubic-bezier/);
  // "Service example" / "Product example" label removed from under the
  // template name — only the name and the Use This Template button remain.
  assert.doesNotMatch(approachesHtml, /Service example/);
  assert.doesNotMatch(approachesHtml, /Product example/);
  assert.doesNotMatch(approachesHtml, /\.slide-meta small/);
});

test("each slide renders exactly one interactive Use This Template CTA (duplicate removed)", () => {
  // The old dead decorative text link (a non-interactive <em>, never wired
  // to a click handler) must be gone, along with its now-unused CSS.
  assert.doesNotMatch(approachesHtml, /template-select-action/);
  assert.doesNotMatch(approachesHtml, /USE THIS TEMPLATE →/i);
  // The section-level button duplicated the per-slide button's exact
  // behavior (both resolved to the currently visible slide's template and
  // called selectTemplate()+openWorkspace() on it) — confirmed by reading
  // wireCarousel's onSlideChange wiring before removal. It must be gone.
  assert.doesNotMatch(approachesHtml, /data-approach-use/);
  assert.doesNotMatch(approachesHtml, /approach-use-button/);
  // The retained per-slide button keeps its original handler, wired via
  // event delegation on [data-template-id] inside wireCarousel — untouched.
  assert.match(approachesHtml, /template-select-button/);
  assert.match(approachesHtml, /data-template-id="\$\{esc\(t\.id\)\}"/);
  assert.match(approachesHtml, /selected = true; selectTemplate\(t\); clearTimer\(\); setTimeout\(\(\) => openWorkspace\(t\), 180\)/);
});

test("all template thumbnails preload into cache as soon as config loads, ahead of scroll", () => {
  assert.match(approachesHtml, /function preloadAllTemplateImages\(\)/);
  assert.match(approachesHtml, /new Image\(\)/);
  // Called right alongside render(), not gated behind any scroll/visibility
  // check — every carousel's images start warming immediately, not just the
  // first one on screen.
  assert.match(approachesHtml, /config=body;render\(\);preloadAllTemplateImages\(\);/);
});

test("approach heading uses the site's shared Motion.js letter-reveal, replaying on every scroll direction", () => {
  assert.match(approachesHtml, /cdn\.jsdelivr\.net\/npm\/motion@11\/dist\/motion\.js/);
  assert.match(approachesHtml, /function wireHeadingReveal\(h2\)/);
  assert.match(approachesHtml, /window\.Motion/);
  assert.match(approachesHtml, /inView\(h2, \(\) => \{/);
  // The reveal callback returns a cleanup that re-hides the letters — this
  // is what makes it replay every time the heading re-enters the viewport
  // in either scroll direction, instead of a one-shot animation.
  assert.match(approachesHtml, /return setHidden;/);
  assert.match(approachesHtml, /rotateX/);
  assert.match(approachesHtml, /stagger\(/);
  // Falls back to a fully visible, static heading for reduced-motion users
  // or if Motion failed to load — same safety net as the rest of the site.
  assert.match(approachesHtml, /reduceMotion \|\| typeof window\.Motion === "undefined"/);
  assert.match(approachesHtml, /\.approach-copy h2 \.letter \{ opacity:1; \}/);
  // Matches the exact CSS class pattern already used site-wide (word-group
  // wrapper prevents mid-word line breaks) rather than inventing a new one.
  assert.match(approachesHtml, /\.approach-copy h2 \.word-group \{ display:inline-block; white-space:nowrap; \}/);
  assert.match(approachesHtml, /wireHeadingReveal\(\$\("h2",section\)\)/);
});

test("workspace preserves normal document scrolling and customer-facing template labels", () => {
  assert.match(workspaceHtml, /body\.workspace-page[^}]*overflow-y:auto/);
  assert.match(workspaceHtml, /\.modern-home\.workspace-page \{ overflow:visible; \}/);
  assert.match(workspaceHtml, /\.workspace-layout[^}]*height:auto[^}]*overflow:visible/);
  assert.match(workspaceHtml, /function customerTemplateName\(template\)/);
  assert.match(workspaceHtml, /Creative layout/);
  assert.match(workspaceHtml, /\$\("#stageFramework"\)\.textContent=label\[framework\(state\.template\)\]\|\|"Creative layout"/);
});

test("workspace reuses image preview, revision, registration, and final routes", () => {
  for (const route of ["/api/public/brandee/product-ads/image/preview", "/api/public/brandee/product-ads/image/revise", "/api/auth/register", "/api/brandee/product-ads/subscribe", "/api/brandee/product-ads/image/final"]) {
    assert.match(workspaceHtml, new RegExp(route.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  }
  assert.match(workspaceHtml, /Create My Preview/);
  assert.match(workspaceHtml, /Your design is ready/);
});

test("workspace keeps the template stage visible and adapts approach fields", () => {
  assert.match(workspaceHtml, /stageSurface/);
  assert.match(workspaceHtml, /templateFields/);
  assert.match(workspaceHtml, /state\.template\.fields/);
  assert.match(workspaceHtml, /Change Template/);
});

test("workspace replaces 'Fill from link' with 'Analyze Product' and the AI-assisted workflow never auto-applies suggestions", () => {
  assert.doesNotMatch(workspaceHtml, /Fill from link/);
  assert.match(workspaceHtml, />Analyze Product</);
  assert.match(workspaceHtml, /Brandee will study the page, identify the product, extract verifiable details, and prepare advertising recommendations\./);
  // The old blind url-extract autofill call must be gone from the button's
  // own handler — analysis now goes through the new endpoint instead.
  assert.match(workspaceHtml, /"#extractBtn"\)\.addEventListener\("click", runAnalysis\)/);
  assert.match(workspaceHtml, /\/api\/public\/brandee\/product-ads\/image\/analyze/);
  // Calm, non-blocking status component (spec: "not an oversized modal",
  // "user should be able to continue editing while analysis is running") —
  // this is a status element among the form fields, not a fixed/modal
  // overlay that would block interaction with the rest of the page.
  assert.match(workspaceHtml, /class="analysis-status"/);
  const analysisStatusRule = workspaceHtml.match(/\.analysis-status\s*\{[^}]*\}/)?.[0] || "";
  assert.doesNotMatch(analysisStatusRule, /position:\s*fixed/);
  assert.match(workspaceHtml, /Identifying the product/);
  assert.match(workspaceHtml, /Checking official specifications/);
  assert.match(workspaceHtml, /Understanding your offer/);
  assert.match(workspaceHtml, /Preparing advertising suggestions/);
});

test("workspace never overwrites an existing owner answer without an explicit compare-and-replace step", () => {
  assert.match(workspaceHtml, /function applySuggestion\(card, suggestion\)/);
  // A non-empty, different current value must trigger the compare UI
  // (current vs suggested + explicit Replace action) rather than silently
  // overwriting.
  assert.match(workspaceHtml, /if \(input\.value\.trim\(\) && input\.value\.trim\(\) !== suggestion\.text\)/);
  assert.match(workspaceHtml, /suggestion-compare/);
  assert.match(workspaceHtml, /Replace my answer/);
  assert.match(workspaceHtml, /Your current answer/);
});

test("workspace suggestion cards show claim-status badges and let the owner accept or dismiss each one individually", () => {
  assert.match(workspaceHtml, /function renderSuggestionPanel\(\)/);
  assert.match(workspaceHtml, /claim-badge \$\{esc\(s\.status\)\}/);
  assert.match(workspaceHtml, />Use This</);
  assert.match(workspaceHtml, />Dismiss</);
  assert.match(workspaceHtml, /data-use/);
  assert.match(workspaceHtml, /data-dismiss/);
  // Dismissing/accepting persists the owner's decision server-side so it
  // survives reopening the workspace, rather than only living in memory.
  assert.match(workspaceHtml, /suggestion-decision/);
  assert.match(workspaceHtml, /recordSuggestionDecision/);
  // Sources and claims-to-confirm are surfaced in the same review panel.
  assert.match(workspaceHtml, /Claims to confirm/);
  assert.match(workspaceHtml, /id="sourcesSection"/);
});


test("Phase 3: every writing field gets a keyboard-accessible sparkle 'Ask Brandee' icon; technical inputs never do", () => {
  assert.match(workspaceHtml, /function wireAssistIcon\(fieldKey, input\)/);
  assert.match(workspaceHtml, /aria-label","Ask Brandee"/);
  assert.match(workspaceHtml, /title = "Ask Brandee"/);
  assert.match(workspaceHtml, /aria-haspopup","true"/);
  // Wired onto the 5 free-text core fields...
  assert.match(workspaceHtml, /for\(const key of Object\.keys\(CORE_FIELD_IDS\)\)wireAssistIcon\(key,\$\(CORE_FIELD_IDS\[key\]\)\)/);
  assert.match(workspaceHtml, /CORE_FIELD_IDS = \{ productName:.*targetCustomer:.*productDescription:.*mainFeatures:.*mainBenefit:/);
  // ...and dynamically onto per-template text/textarea fields only — never
  // onto select/date/file/color/template-selector inputs.
  assert.match(workspaceHtml, /if\(f\.type==="text"\|\|f\.type==="textarea"\)wireAssistIcon\(f\.key,\$\(`#\$\{id\}`\)\)/);
  assert.doesNotMatch(workspaceHtml, /productImage.*wireAssistIcon/);
  assert.doesNotMatch(workspaceHtml, /"#logo"\).*wireAssistIcon/);
});

test("Phase 3: the assist popover shows only the actions relevant to the field, not every option at once", () => {
  assert.match(workspaceHtml, /function actionsForField\(key\)/);
  assert.match(workspaceHtml, /key==="comparisonSubject"\|\|key==="comparisonPoints"/);
  assert.match(workspaceHtml, /key==="cta"/);
  // General actions present.
  for (const label of ["Suggest from product research", "Improve my answer", "Make it benefit-focused", "Make it more persuasive", "Make it shorter", "Make it clearer", "Write for my target customer", "Generate alternatives", "Translate to English", "Translate to Filipino", "Use a professional tone", "Use a conversational tone"]) {
    assert.ok(workspaceHtml.includes(label), `missing general action label: ${label}`);
  }
  // Comparison-only actions present, gated to comparison fields by actionsForField.
  for (const label of ["Compare product capabilities", "Compare service models", "Create defensible comparison points", "Remove risky claims", "Show only verified claims"]) {
    assert.ok(workspaceHtml.includes(label), `missing comparison action label: ${label}`);
  }
  // CTA-only actions present.
  for (const label of ["Generate message-based CTA", "Generate quotation CTA", "Generate booking CTA", "Generate purchase CTA", "Generate store-visit CTA"]) {
    assert.ok(workspaceHtml.includes(label), `missing CTA action label: ${label}`);
  }
});

test("Phase 3: popover clearly shows which suggestion mode is active", () => {
  assert.match(workspaceHtml, /function actionMode\(action, hasValue\)/);
  assert.match(workspaceHtml, /assist-mode-label/);
  assert.match(workspaceHtml, /Mode: \$\{mode==="improve"\?"Improve":mode==="generate_again"\?"Generate Again":"Suggest"\}/);
});

test("Phase 3: popover suggestions reuse the same never-overwrite Use/Edit flow and claim badges as the review panel", () => {
  assert.match(workspaceHtml, /function runFieldAssist\(fieldKey, fieldLabel, action, anchorEl\)/);
  assert.match(workspaceHtml, />Use Suggestion</);
  assert.match(workspaceHtml, />Edit Before Applying</);
  assert.match(workspaceHtml, /applySuggestion\(card, suggestion\)/);
  assert.match(workspaceHtml, /\/api\/public\/brandee\/product-ads\/image\/field-assist/);
});

test("Phase 3: popover is keyboard/focus accessible — closes on Escape, outside click, and returns focus to the trigger", () => {
  assert.match(workspaceHtml, /e\.key==="Escape"/);
  assert.match(workspaceHtml, /assistFocusReturn = anchorEl/);
  assert.match(workspaceHtml, /assistFocusReturn\.focus\(\)/);
  assert.match(workspaceHtml, /role="dialog"/);
});

test("Phase 3: suggestion-count indicator sits next to the field label without dominating it", () => {
  assert.match(workspaceHtml, /field-suggestion-count/);
  assert.match(workspaceHtml, /function refreshSuggestionCounts\(\)/);
  assert.match(workspaceHtml, /refreshSuggestionCounts\(\);/);
  // Small text sitting beside the label, not a loud badge — count span
  // lives inside the same lightweight label row as the label itself.
  assert.match(workspaceHtml, /field-label-row \{ display:flex/);
});

test("Phase 4: analysis shows a real animated progress percentage, not a fake instant bar", () => {
  assert.match(workspaceHtml, /id="analysisProgressBar"/);
  assert.match(workspaceHtml, /id="analysisProgressPct"/);
  assert.match(workspaceHtml, /function startProgressAnimation\(\)/);
  assert.match(workspaceHtml, /function finishProgressAnimation\(\)/);
  // Climbs toward 92% while running, eased over the measured real duration
  // — never claims 100% until the actual response has arrived.
  assert.match(workspaceHtml, /Math\.min\(92, Math\.round\(92 \* \(1 - Math\.exp/);
  assert.match(workspaceHtml, /ANALYSIS_ESTIMATED_MS = 40000/);
  assert.match(workspaceHtml, /startProgressAnimation\(\);/);
  assert.match(workspaceHtml, /finishProgressAnimation\(\);/);
  assert.match(workspaceHtml, /analysisProgressBar"\)\.style\.width = "100%"/);
});

test("Phase 4: analysis auto-fills only currently-blank fields, never overwrites an owner-typed answer", () => {
  assert.match(workspaceHtml, /function autoPopulateFromAnalysis\(\)/);
  assert.match(workspaceHtml, /if \(!input \|\| \(input\.value && input\.value\.trim\(\)\)\) continue;/);
  assert.match(workspaceHtml, /const autoFilledCount = autoPopulateFromAnalysis\(\);/);
  // Every auto-filled field still records a real acceptance decision, same
  // as a manual "Use This" click — not a silent, untracked overwrite.
  assert.match(workspaceHtml, /recordSuggestionDecision\(list\[0\]\.id, "accepted"\);/);
});

test("Phase 4: Create My Preview starts disabled and enables once required fields are actually complete", () => {
  assert.match(workspaceHtml, /id="generateBtn" type="submit" disabled/);
  assert.match(workspaceHtml, /id="generateHint"/);
  assert.match(workspaceHtml, /function updateGenerateButtonState\(\)/);
  // Reuses the exact same validate()/collect() the submit handler already
  // uses — one single definition of "ready," not a second parallel check.
  assert.match(workspaceHtml, /const err = validate\(collect\(\)\);/);
  assert.match(workspaceHtml, /btn\.disabled = Boolean\(err\);/);
  // Wired to fire on manual typing (delegated form input/change), on file
  // upload, after analysis auto-fill, and after accepting any suggestion —
  // not just once at page load.
  assert.match(workspaceHtml, /\$\("#workspaceForm"\)\.addEventListener\("input",updateGenerateButtonState\);/);
  assert.match(workspaceHtml, /\$\("#workspaceForm"\)\.addEventListener\("change",updateGenerateButtonState\);/);
  assert.match(workspaceHtml, /state\.productImage=await fileData\("#productImage"\);updateGenerateButtonState\(\);/);
  assert.match(workspaceHtml, /helpers\.track\("suggestion_applied", \{ fieldKey: suggestion\.fieldKey \}\); updateGenerateButtonState\(\); \}/);
});
