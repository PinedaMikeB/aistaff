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
  assert.match(approachesHtml, /const AUTOPLAY_MS = 7000/);
  assert.match(approachesHtml, /mouseenter/);
  assert.match(approachesHtml, /visibilitychange/);
  assert.match(approachesHtml, /matchMedia\?\.\("\(prefers-reduced-motion: reduce\)"\)/);
  assert.match(approachesHtml, /data-carousel-toggle/);
  assert.match(approachesHtml, /aria-pressed/);
  assert.match(approachesHtml, /setImagePaused/);
  assert.match(approachesHtml, /data-approach-use/);
  assert.match(approachesHtml, /approach-use-button/);
  assert.doesNotMatch(approachesHtml, /<span class="framework">/);
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
