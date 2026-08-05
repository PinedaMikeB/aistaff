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
