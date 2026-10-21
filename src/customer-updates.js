const crypto = require("crypto");

const UTILITY_TEMPLATE_SUGGESTIONS = Object.freeze([
  {
    key: "schedule_confirmed",
    displayName: "Booking or schedule confirmed",
    description: "Confirms an appointment, booking, visit, delivery window, or another scheduled activity.",
    aiUsageInstruction: "Use only after the business has confirmed a real date and time for this customer's active request.",
    bodyText: "Hello {{customer_name}}, your booking is confirmed for {{schedule}}. Reference number: {{reference_number}}.",
    examples: { customer_name: "Mike", schedule: "October 15, 2026 at 2:00 PM", reference_number: "REF-1042" }
  },
  {
    key: "schedule_changed",
    displayName: "Booking or schedule changed",
    description: "Notifies a customer that a previously agreed schedule has changed.",
    aiUsageInstruction: "Use only when the business has recorded a replacement date or time for an existing booking.",
    bodyText: "Hello {{customer_name}}, your booking has been moved to {{schedule}}. Reference number: {{reference_number}}.",
    examples: { customer_name: "Mike", schedule: "October 16, 2026 at 10:00 AM", reference_number: "REF-1042" }
  },
  {
    key: "representative_assigned",
    displayName: "Representative assigned",
    description: "Identifies the technician, adviser, driver, clinician, agent, or staff member assigned.",
    aiUsageInstruction: "Use only after an identified staff member has actually been assigned to the customer's active request.",
    bodyText: "Hello {{customer_name}}, {{assigned_person}} has been assigned to assist with your request. Reference number: {{reference_number}}.",
    examples: { customer_name: "Mike", assigned_person: "Alex from our service team", reference_number: "REF-1042" }
  },
  {
    key: "reference_created",
    displayName: "Reference number created",
    description: "Acknowledges a request and provides its case, ticket, booking, job, or transaction number.",
    aiUsageInstruction: "Use only after the request and reference number exist in the business's authoritative records.",
    bodyText: "Hello {{customer_name}}, your request has been recorded. Reference number: {{reference_number}}.",
    examples: { customer_name: "Mike", reference_number: "REF-1042" }
  },
  {
    key: "status_updated",
    displayName: "Request status updated",
    description: "Shares a factual status for a service, order, application, repair, reservation, or support case.",
    aiUsageInstruction: "Use only when the new status is confirmed in the business's authoritative system.",
    bodyText: "Hello {{customer_name}}, the status of your request is now {{status}}. Reference number: {{reference_number}}.",
    examples: { customer_name: "Mike", status: "being processed", reference_number: "REF-1042" }
  },
  {
    key: "request_completed",
    displayName: "Request completed or resolved",
    description: "Confirms that the customer request, service, order, or case is complete.",
    aiUsageInstruction: "Use only after the business has marked the request completed or resolved.",
    bodyText: "Hello {{customer_name}}, your request has been completed or resolved. Reference number: {{reference_number}}.",
    examples: { customer_name: "Mike", reference_number: "REF-1042" }
  },
  {
    key: "document_ready",
    displayName: "Document ready",
    description: "Notifies a customer that a quotation, invoice, receipt, report, contract, certificate, or result is ready.",
    aiUsageInstruction: "Use only after the named document has been finalized and is available to the customer.",
    bodyText: "Hello {{customer_name}}, your {{document_type}} is ready. Reference number: {{reference_number}}.",
    examples: { customer_name: "Mike", document_type: "quotation", reference_number: "REF-1042" }
  },
  {
    key: "payment_status",
    displayName: "Payment status updated",
    description: "Shares a factual payment status without promotional content.",
    aiUsageInstruction: "Use only when the payment status is verified in the business's billing or payment records.",
    bodyText: "Hello {{customer_name}}, the payment status for reference {{reference_number}} is now {{status}}.",
    examples: { customer_name: "Mike", reference_number: "REF-1042", status: "confirmed" }
  },
  {
    key: "delivery_collection_updated",
    displayName: "Delivery or collection updated",
    description: "Provides a confirmed delivery, pickup, or collection schedule.",
    aiUsageInstruction: "Use only after the delivery, pickup, or collection schedule is confirmed.",
    bodyText: "Hello {{customer_name}}, your delivery or collection is scheduled for {{schedule}}. Reference number: {{reference_number}}.",
    examples: { customer_name: "Mike", schedule: "October 15, 2026 between 1:00 PM and 3:00 PM", reference_number: "REF-1042" }
  },
  {
    key: "customer_action_required",
    displayName: "Customer action required",
    description: "Asks the customer to contact the business about a specific active request.",
    aiUsageInstruction: "Use only when a defined customer action is genuinely required to continue an active request.",
    bodyText: "Hello {{customer_name}}, an action is required for your request. Please contact us and mention reference number {{reference_number}}.",
    examples: { customer_name: "Mike", reference_number: "REF-1042" }
  }
]);

const SUGGESTION_BY_KEY = new Map(UTILITY_TEMPLATE_SUGGESTIONS.map((template) => [template.key, template]));
const VARIABLE_PATTERN = /{{\s*([a-z][a-z0-9_]*)\s*}}/gi;

function utilityGraphVersion() {
  return String(process.env.META_UTILITY_GRAPH_VERSION || "v24.0").trim() || "v24.0";
}

function slugifyTemplateKey(value) {
  const slug = String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return slug || `customer_update_${crypto.randomBytes(4).toString("hex")}`;
}

function utilityTemplateName(key, version = 1) {
  return `aistaff_${slugifyTemplateKey(key)}_v${Math.max(1, Number(version) || 1)}`.slice(0, 128);
}

function extractVariableKeys(bodyText) {
  const keys = [];
  const seen = new Set();
  for (const match of String(bodyText || "").matchAll(VARIABLE_PATTERN)) {
    const key = match[1].toLowerCase();
    if (!seen.has(key)) {
      seen.add(key);
      keys.push(key);
    }
  }
  return keys;
}

function validateTemplateDraft({ displayName, bodyText, aiUsageInstruction, variableExamples = {} }) {
  const name = String(displayName || "").trim();
  const body = String(bodyText || "").trim();
  const instruction = String(aiUsageInstruction || "").trim();
  if (name.length < 3 || name.length > 120) throw new Error("Template name must be between 3 and 120 characters.");
  if (body.length < 20 || body.length > 1024) throw new Error("Message text must be between 20 and 1,024 characters.");
  if (instruction.length < 10 || instruction.length > 1000) throw new Error("AI usage instruction must explain the allowed business event.");
  const variableKeys = extractVariableKeys(body);
  if (variableKeys.length > 10) throw new Error("Use no more than 10 template variables.");
  if (/^{{[^}]+}}/.test(body) || /{{[^}]+}}\s*$/.test(body)) {
    throw new Error("Meta templates cannot start or end with a variable.");
  }
  const examples = {};
  for (const key of variableKeys) {
    const value = String(variableExamples[key] || "").trim();
    if (!value) throw new Error(`Add an example value for ${key.replaceAll("_", " ")}.`);
    examples[key] = value.slice(0, 500);
  }
  return { displayName: name, bodyText: body, aiUsageInstruction: instruction, variableKeys, variableExamples: examples };
}

function normalizeUtilityVariables(template, input) {
  const source = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  const keys = Array.isArray(template.variableKeys) ? template.variableKeys : extractVariableKeys(template.bodyText);
  const values = {};
  for (const key of keys) {
    const value = String(source[key] || "").trim();
    if (!value) throw new Error(`${key.replaceAll("_", " ")} is required.`);
    if (value.length > 500) throw new Error(`${key.replaceAll("_", " ")} is too long.`);
    values[key] = value;
  }
  return values;
}

function renderUtilityTemplate(template, input) {
  const values = normalizeUtilityVariables(template, input);
  return String(template.bodyText).replace(VARIABLE_PATTERN, (_, key) => values[String(key).toLowerCase()] || "");
}

function metaBodyText(template) {
  const keys = Array.isArray(template.variableKeys) ? template.variableKeys : extractVariableKeys(template.bodyText);
  const indexes = new Map(keys.map((key, index) => [key, index + 1]));
  return String(template.bodyText).replace(VARIABLE_PATTERN, (_, key) => `{{${indexes.get(String(key).toLowerCase())}}}`);
}

function templateComponents(template, variables) {
  const values = normalizeUtilityVariables(template, variables);
  return [{
    type: "body",
    parameters: template.variableKeys.map((key) => ({ type: "text", text: values[key] }))
  }];
}

function metaTemplateComponents(template) {
  const examples = template.variableExamples || {};
  const component = { type: "BODY", text: metaBodyText(template) };
  if (template.variableKeys.length) {
    component.example = { body_text: [template.variableKeys.map((key) => String(examples[key] || "Example"))] };
  }
  return [component];
}

async function metaJson(response, operation) {
  const payload = await response.json().catch(() => ({}));
  if (response.ok) return payload;
  const error = new Error(String(payload?.error?.message || `${operation} failed (HTTP ${response.status}).`));
  error.metaCode = payload?.error?.code || null;
  error.metaSubcode = payload?.error?.error_subcode || null;
  error.metaPayload = payload;
  throw error;
}

function graphUrl(pageId, path, token, query = {}) {
  const url = new URL(`https://graph.facebook.com/${utilityGraphVersion()}/${encodeURIComponent(pageId)}/${path}`);
  url.searchParams.set("access_token", token);
  Object.entries(query).forEach(([key, value]) => {
    if (value != null && value !== "") url.searchParams.set(key, String(value));
  });
  return url;
}

async function createMetaUtilityTemplate({ pageId, token, template, fetchImpl = global.fetch }) {
  const response = await fetchImpl(graphUrl(pageId, "message_templates", token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: template.metaTemplateName,
      language: template.language || "en_US",
      category: "UTILITY",
      components: metaTemplateComponents(template)
    })
  });
  return metaJson(response, "Meta Utility template creation");
}

async function getMetaUtilityTemplate({ pageId, token, name, fetchImpl = global.fetch }) {
  const response = await fetchImpl(graphUrl(pageId, "message_templates", token, { name }));
  const payload = await metaJson(response, "Meta Utility template lookup");
  return Array.isArray(payload.data) ? payload.data.find((item) => item?.name === name) || null : null;
}

async function sendMetaUtilityMessage({ pageId, psid, token, template, variables, fetchImpl = global.fetch }) {
  const response = await fetchImpl(graphUrl(pageId, "messages", token), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      recipient: { id: psid },
      messaging_type: "UTILITY",
      message: {
        template: {
          name: template.metaTemplateName,
          language: { code: template.language || "en_US" },
          components: templateComponents(template, variables)
        }
      }
    })
  });
  return metaJson(response, "Meta Utility message send");
}

function previewSecret() {
  const secret = String(process.env.JWT_SECRET || process.env.SESSION_SECRET || "");
  if (!secret) throw new Error("Customer Update preview signing is not configured.");
  return secret;
}

function signUtilityPreview(payload, ttlSeconds = 15 * 60) {
  const body = Buffer.from(JSON.stringify({ ...payload, nonce: crypto.randomUUID(), exp: Math.floor(Date.now() / 1000) + ttlSeconds })).toString("base64url");
  const signature = crypto.createHmac("sha256", previewSecret()).update(body).digest("base64url");
  return `${body}.${signature}`;
}

function verifyUtilityPreview(token) {
  const [body, supplied] = String(token || "").split(".");
  if (!body || !supplied) throw new Error("The Customer Update preview is invalid. Preview it again.");
  const expected = crypto.createHmac("sha256", previewSecret()).update(body).digest("base64url");
  const suppliedBuffer = Buffer.from(supplied);
  const expectedBuffer = Buffer.from(expected);
  if (suppliedBuffer.length !== expectedBuffer.length || !crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
    throw new Error("The Customer Update preview is invalid. Preview it again.");
  }
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  if (!payload.exp || payload.exp < Math.floor(Date.now() / 1000)) throw new Error("The Customer Update preview expired. Preview it again.");
  return payload;
}

module.exports = {
  UTILITY_TEMPLATE_SUGGESTIONS,
  SUGGESTION_BY_KEY,
  utilityGraphVersion,
  slugifyTemplateKey,
  utilityTemplateName,
  extractVariableKeys,
  validateTemplateDraft,
  normalizeUtilityVariables,
  renderUtilityTemplate,
  metaBodyText,
  templateComponents,
  metaTemplateComponents,
  createMetaUtilityTemplate,
  getMetaUtilityTemplate,
  sendMetaUtilityMessage,
  signUtilityPreview,
  verifyUtilityPreview
};
