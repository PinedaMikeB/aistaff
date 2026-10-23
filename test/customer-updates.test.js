const test = require("node:test");
const assert = require("node:assert/strict");

const {
  extractVariableKeys,
  validateTemplateDraft,
  renderUtilityTemplate,
  metaBodyText,
  metaTemplateComponents,
  sendMetaUtilityMessage,
  signUtilityPreview,
  verifyUtilityPreview
} = require("../src/customer-updates");

const template = {
  bodyText: "Hello {{customer_name}}, your booking is confirmed for {{schedule}}. Ref: {{reference_number}}.",
  variableKeys: ["customer_name", "schedule", "reference_number"],
  variableExamples: {
    customer_name: "Mike",
    schedule: "October 15 at 2 PM",
    reference_number: "REF-1042"
  },
  metaTemplateName: "aistaff_schedule_confirmed_v1",
  language: "en_US"
};

test("named variables remain readable in AIStaff and become ordered Meta variables", () => {
  assert.deepEqual(extractVariableKeys(template.bodyText), template.variableKeys);
  assert.equal(metaBodyText(template), "Hello {{1}}, your booking is confirmed for {{2}}. Ref: {{3}}.");
  assert.deepEqual(metaTemplateComponents(template), [{
    type: "BODY",
    text: "Hello {{1}}, your booking is confirmed for {{2}}. Ref: {{3}}.",
    example: { body_text: [["Mike", "October 15 at 2 PM", "REF-1042"]] }
  }]);
});

test("draft validation requires a documented AI business event and examples", () => {
  assert.throws(() => validateTemplateDraft({
    displayName: "Schedule confirmed",
    bodyText: template.bodyText,
    aiUsageInstruction: "Use it",
    variableExamples: template.variableExamples
  }), /AI usage instruction/);
  assert.throws(() => validateTemplateDraft({
    displayName: "Schedule confirmed",
    bodyText: template.bodyText,
    aiUsageInstruction: "Use only after the schedule is verified.",
    variableExamples: { customer_name: "Mike" }
  }), /example value for schedule/);
});

test("render requires every verified value and produces the exact preview text", () => {
  assert.throws(() => renderUtilityTemplate(template, { customer_name: "Mike" }), /schedule is required/);
  assert.equal(renderUtilityTemplate(template, {
    customer_name: "Mike",
    schedule: "October 15 at 2 PM",
    reference_number: "REF-1042"
  }), "Hello Mike, your booking is confirmed for October 15 at 2 PM. Ref: REF-1042.");
});

test("send uses Meta's Utility messaging type and approved template payload", async () => {
  let request;
  const fetchImpl = async (url, options) => {
    request = { url: String(url), options, body: JSON.parse(options.body) };
    return { ok: true, json: async () => ({ message_id: "mid.123" }) };
  };
  const result = await sendMetaUtilityMessage({
    pageId: "page-1",
    psid: "psid-1",
    token: "page-token",
    template,
    variables: { customer_name: "Mike", schedule: "October 15 at 2 PM", reference_number: "REF-1042" },
    fetchImpl
  });
  assert.equal(result.message_id, "mid.123");
  assert.match(request.url, /v24\.0\/page-1\/messages/);
  assert.equal(request.body.messaging_type, "UTILITY");
  assert.deepEqual(request.body.recipient, { id: "psid-1" });
  assert.equal(request.body.message.template.name, template.metaTemplateName);
  assert.equal(request.body.message.template.language.code, "en_US");
  assert.deepEqual(request.body.message.template.components[0].parameters.map((item) => item.text), ["Mike", "October 15 at 2 PM", "REF-1042"]);
});

test("confirmed preview tokens are signed, scoped, and expire", () => {
  const previous = process.env.JWT_SECRET;
  process.env.JWT_SECRET = "test-only-customer-update-secret";
  const token = signUtilityPreview({ companyId: "company-1", userId: "user-1", renderedText: "Verified update" }, 60);
  const verified = verifyUtilityPreview(token);
  assert.equal(verified.companyId, "company-1");
  assert.equal(verified.userId, "user-1");
  assert.equal(verified.renderedText, "Verified update");
  assert.ok(verified.nonce);
  assert.throws(() => verifyUtilityPreview(`${token}x`), /invalid/);
  if (previous == null) delete process.env.JWT_SECRET;
  else process.env.JWT_SECRET = previous;
});
