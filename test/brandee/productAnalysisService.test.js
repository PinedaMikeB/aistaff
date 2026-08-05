// Tests for productAnalysisService.js — the "Analyze Product" research +
// field-suggestion generator behind the Brandee Image Ad Workspace's
// AI-assisted analysis. Deliberately network-free (uses the same
// fetchHtmlPage dependency-injection pattern as productUrlExtractor's own
// tests) so this suite runs deterministically with no AI provider
// configured, matching this environment's real, disclosed default state.

const test = require("node:test");
const assert = require("node:assert/strict");

const {
  analyzeProduct,
  claimStatusFromEvidence,
  claimFromEvidence,
  deterministicAnalysis,
  generateFieldAssist,
  FIELD_ASSIST_ACTIONS,
  describeResearchError,
  clampAiAnalysisArrays,
  AiAnalysisResponseSchema
} = require("../../src/brandee/productAnalysisService");
const { makeEvidence } = require("../../src/brandee/evidenceModel");

const COMPARISON_TEMPLATE = {
  id: "comparison",
  name: "Comparison",
  frameworkKey: "us_vs_them",
  fields: [
    { key: "comparisonSubject", label: "Comparison subject", type: "text", required: true },
    { key: "comparisonPoints", label: "Defensible comparison points", type: "textarea", required: true },
    { key: "cta", label: "Call to action", type: "text", required: true }
  ]
};

const PRODUCT_PAGE_HTML = `<!doctype html><html><head>
  <title>Bamboo Travel Mug — Sample Shop</title>
  <meta property="og:title" content="Bamboo Travel Mug" />
  <meta property="og:description" content="A leak-proof travel mug made from sustainable bamboo fiber." />
  <script type="application/ld+json">
  {"@context":"https://schema.org","@type":"Product","name":"Bamboo Travel Mug","description":"Leak-proof, keeps drinks hot for 6 hours.","offers":{"@type":"Offer","price":"899","availability":"https://schema.org/InStock"}}
  </script>
</head><body><h1>Bamboo Travel Mug</h1><p>Price: PHP 899</p></body></html>`;

test("claimStatusFromEvidence maps evidenceModel's sourceTypes to the spec's three claim statuses", () => {
  assert.equal(claimStatusFromEvidence(makeEvidence({ statement: "x", sourceType: "website" })), "verified");
  assert.equal(claimStatusFromEvidence(makeEvidence({ statement: "x", sourceType: "linked_subdomain" })), "verified");
  assert.equal(claimStatusFromEvidence(makeEvidence({ statement: "x", sourceType: "linked_external" })), "verified");
  assert.equal(claimStatusFromEvidence(makeEvidence({ statement: "x", sourceType: "user" })), "owner_confirmed");
  assert.equal(claimStatusFromEvidence(makeEvidence({ statement: "x", sourceType: "inference" })), "needs_confirmation");
});

test("claimFromEvidence carries requiresConfirmation only for inferred evidence", () => {
  const verified = claimFromEvidence(makeEvidence({ statement: "A3 printing", sourceType: "website", sourceUrl: "https://example.com" }));
  assert.equal(verified.status, "verified");
  assert.equal(verified.requiresConfirmation, false);
  assert.deepEqual(verified.sourceIds, ["https://example.com"]);

  const inferred = claimFromEvidence(makeEvidence({ statement: "Fast shipping", sourceType: "inference" }));
  assert.equal(inferred.status, "needs_confirmation");
  assert.equal(inferred.requiresConfirmation, true);
});

test("analyzeProduct with no input at all never throws, and returns an honest warning instead of inventing anything", async () => {
  const result = await analyzeProduct({ productUrl: null, businessWebsite: null, productName: null, productDescription: null, template: COMPARISON_TEMPLATE, existingFields: {} });
  assert.equal(result.status, "completed");
  assert.equal(result.aiUsed, false);
  assert.deepEqual(result.fieldSuggestions, {});
  assert.equal(result.suggestedFieldCount, 0);
  assert.deepEqual(result.claims, []);
  assert.ok(result.warnings.some((w) => /product link|business website|name|description/i.test(w)));
});

test("analyzeProduct with a typed name/description but no URL/AI configured returns zero fabricated suggestions", async () => {
  const result = await analyzeProduct({
    productUrl: null, businessWebsite: null,
    productName: "Portable Mini Fan", productDescription: "A small rechargeable fan.",
    template: COMPARISON_TEMPLATE, existingFields: {}
  });
  assert.equal(result.aiUsed, false);
  // Nothing was actually extracted (no URL, no AI), so there is genuinely
  // nothing safe to suggest — an empty object is correct, not a bug.
  assert.deepEqual(result.fieldSuggestions, {});
  assert.equal(result.detectedProduct.name, "Portable Mini Fan");
  assert.equal(result.detectedProduct.confidence, "low");
});

test("analyzeProduct with a product URL (no AI configured) surfaces the extracted data as verified suggestions with real source attribution", async () => {
  let fetchCount = 0;
  const fetchHtmlPage = async (url) => { fetchCount += 1; return { html: PRODUCT_PAGE_HTML, finalUrl: url }; };

  const result = await analyzeProduct({
    productUrl: "https://sample-shop.example/products/bamboo-mug",
    businessWebsite: null, productName: null, productDescription: null,
    template: COMPARISON_TEMPLATE, existingFields: {}, fetchHtmlPage
  });

  assert.equal(fetchCount, 1, "must fetch exactly the one product page, never crawl further");
  assert.equal(result.aiUsed, false);
  assert.equal(result.detectedProduct.name, "Bamboo Travel Mug");
  assert.equal(result.detectedProduct.confidence, "medium");

  assert.ok(result.fieldSuggestions.productName?.length, "should suggest the extracted name");
  assert.equal(result.fieldSuggestions.productName[0].status, "verified");
  assert.deepEqual(result.fieldSuggestions.productName[0].sourceIds, ["https://sample-shop.example/products/bamboo-mug"]);
  assert.ok(result.fieldSuggestions.productDescription?.length, "should suggest the extracted description");

  // Claims built from real page evidence must be marked verified, not
  // merely owner-confirmed or needs-confirmation.
  assert.ok(result.claims.some((c) => c.status === "verified" && c.text === "Bamboo Travel Mug"));
  assert.ok(result.sources.some((s) => s.id === "https://sample-shop.example/products/bamboo-mug"));
});

test("analyzeProduct with an unreadable product URL fails gracefully — warning, no throw, no fabricated data", async () => {
  const fetchHtmlPage = async () => { throw new Error("network unreachable"); };
  const result = await analyzeProduct({
    productUrl: "https://unreachable-shop.example/products/x",
    businessWebsite: null, productName: null, productDescription: null,
    template: COMPARISON_TEMPLATE, existingFields: {}, fetchHtmlPage
  });
  assert.equal(result.status, "completed");
  assert.deepEqual(result.fieldSuggestions, {});
  assert.ok(result.warnings.length > 0);
  assert.equal(result.detectedProduct.name, null);
});

test("deterministicAnalysis only ever echoes real extracted text, never invents copy", () => {
  const withData = deterministicAnalysis({
    extracted: { productName: "Bamboo Travel Mug", description: "Leak-proof, keeps drinks hot for 6 hours." },
    businessProfile: null
  });
  assert.equal(withData.fields.productName[0].text, "Bamboo Travel Mug");
  // normalizeRawPhrase (reused from copyQuality.js) fixes stray-comma
  // grammar — it does not echo verbatim, so assert on content, not
  // byte-for-byte identity.
  assert.match(withData.fields.productDescription[0].text, /Leak-proof.*keeps drinks hot for 6 hours/);
  assert.equal(withData.fields.mainBenefit, undefined);

  const withNothing = deterministicAnalysis({ extracted: null, businessProfile: null });
  assert.deepEqual(withNothing.fields, {});
  assert.deepEqual(withNothing.productCapabilities, []);
  assert.deepEqual(withNothing.serviceBenefits, []);
});

test("generateFieldAssist('suggest_from_research') reuses the existing analysis suggestions with zero extra AI calls", async () => {
  const existing = [{ id: "sugg_1", fieldKey: "productDescription", text: "Existing suggestion", status: "verified" }];
  const result = await generateFieldAssist({
    fieldKey: "productDescription", fieldLabel: "Product description", action: "suggest_from_research",
    template: COMPARISON_TEMPLATE, existingAnalysisSuggestions: existing
  });
  assert.equal(result.aiUsed, false);
  assert.deepEqual(result.suggestions, existing);
});

test("generateFieldAssist returns unavailable:true (not a crash, not fabricated copy) when no AI provider is configured", async () => {
  const result = await generateFieldAssist({
    fieldKey: "mainBenefit", fieldLabel: "Main benefit", action: "more_persuasive", mode: "improve",
    currentValue: "It is fast.", template: COMPARISON_TEMPLATE
  });
  assert.equal(result.unavailable, true);
  assert.deepEqual(result.suggestions, []);
});

test("every action in FIELD_ASSIST_ACTIONS has a real, non-empty instruction — none are stubs", () => {
  for (const [action, instruction] of Object.entries(FIELD_ASSIST_ACTIONS)) {
    assert.ok(instruction && instruction.length > 10, `action "${action}" has a missing/too-short instruction`);
  }
  // Spot-check the spec's exact required action sets are all present.
  for (const id of ["improve", "benefit_focused", "more_persuasive", "shorter", "clearer", "for_target_customer", "alternatives", "translate_en", "translate_fil", "tone_professional", "tone_conversational"]) {
    assert.ok(FIELD_ASSIST_ACTIONS[id], `missing general action: ${id}`);
  }
  for (const id of ["compare_product", "compare_service", "defensible_points", "remove_risky", "verified_only"]) {
    assert.ok(FIELD_ASSIST_ACTIONS[id], `missing comparison action: ${id}`);
  }
  for (const id of ["cta_message", "cta_quotation", "cta_booking", "cta_purchase", "cta_store_visit"]) {
    assert.ok(FIELD_ASSIST_ACTIONS[id], `missing CTA action: ${id}`);
  }
});

test("describeResearchError distinguishes credit exhaustion, auth, model-not-found, and true timeouts", () => {
  assert.match(describeResearchError({ status: 429, providerBody: JSON.stringify({ error: { message: "You have no credits remaining.", code: "credit_balance_exhausted" } }) }), /no billing credits remaining/);
  assert.match(describeResearchError({ status: 401, providerBody: JSON.stringify({ error: { code: "invalid_api_key" } }) }), /API key was rejected/);
  assert.match(describeResearchError({ status: 404, providerBody: JSON.stringify({ error: { code: "model_not_found" } }) }), /model name isn't available/);
  assert.match(describeResearchError({ message: "Research model timed out" }), /didn't respond in time/);
  assert.match(describeResearchError({ status: 500, providerBody: "" }), /returned an error/);
});

test("clampAiAnalysisArrays trims oversized arrays instead of letting them invalidate the whole response", () => {
  const oversized = {
    detectedCategory: "Backpack",
    productCapabilities: Array.from({ length: 10 }, (_, i) => `cap ${i}`),
    serviceBenefits: Array.from({ length: 9 }, (_, i) => `benefit ${i}`),
    advertisingAngles: Array.from({ length: 6 }, (_, i) => `angle ${i}`),
    fields: {
      productName: Array.from({ length: 5 }, (_, i) => ({ text: `name ${i}` })),
      productDescription: [{ text: "a normal one" }]
    }
  };
  const clamped = clampAiAnalysisArrays(oversized);
  assert.equal(clamped.productCapabilities.length, 8);
  assert.equal(clamped.serviceBenefits.length, 8);
  assert.equal(clamped.advertisingAngles.length, 4);
  assert.equal(clamped.fields.productName.length, 4);
  assert.equal(clamped.fields.productDescription.length, 1);
  // Now the whole thing actually validates — this is the real bug: before
  // clamping, one oversized array (confirmed live: advertisingAngles
  // returning 5-6 items against schema max 4) rejected the ENTIRE response
  // and discarded good suggestions for every other field.
  assert.equal(AiAnalysisResponseSchema.safeParse(clamped).success, true);
  assert.equal(AiAnalysisResponseSchema.safeParse(oversized).success, false);
});

test("clampAiAnalysisArrays never throws on null/non-object input", () => {
  assert.equal(clampAiAnalysisArrays(null), null);
  assert.equal(clampAiAnalysisArrays(undefined), undefined);
  assert.deepEqual(clampAiAnalysisArrays({}), {});
});
