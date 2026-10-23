/**
 * Integration blueprints — "map, don't rename".
 *
 * A Business Engine operation (create_service_request, create_booking, ...) is
 * standard. The FIELDS Closer fills in are the mapped API action's own fields,
 * taken from the tenant's OpenAPI document. The blueprint is tenant
 * configuration (engine_operation_mappings.workflow_config) that adds what the
 * OpenAPI document may lack: labels for coded values, notes, the order in which
 * details are usually collected, fields derived from other fields, and where
 * the reference number lives in the response.
 *
 * Everything here is pure (no database) so it can be unit tested. Code only
 * enforces platform invariants — input validation, types, idempotency, the
 * confirmation sequence. What to say to the customer stays with the model:
 * tools return facts, the model writes words.
 *
 * See docs/MASTERPLAN-integration-blueprints.md.
 */

const PLACEHOLDER_VALUE = /^(n\/?a|none|nil|null|undefined|unknown|not (provided|given|available|specified)|to be (confirmed|provided)|tbd|tba|pending|-+|\?+|customer|client)$/i;
const AUTO_HIDDEN = new Set(["dryrun", "dry_run", "idempotency_key", "idempotencykey"]);
const DEFAULT_ANCHORS = {
  reference: ["reference", "ticketReference", "ticket_reference", "referenceNumber", "reference_number", "bookingReference", "orderNumber"],
  status: ["status"],
  schedule_reference: ["scheduleReference", "schedule_reference"],
  record_id: ["recordId", "record_id", "id"]
};

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStringMap(value) {
  if (!isPlainObject(value)) return {};
  const out = {};
  for (const [key, inner] of Object.entries(value)) out[String(key)] = String(inner);
  return out;
}

/** Normalize a stored workflow_config into a complete blueprint for one action. */
function normalizeBlueprint(rawConfig, action) {
  const config = isPlainObject(rawConfig) ? rawConfig : {};
  const properties = isPlainObject(action?.input_schema?.properties) ? action.input_schema.properties : {};
  const valueLabels = {};
  for (const [field, labels] of Object.entries(isPlainObject(config.value_labels) ? config.value_labels : {})) {
    valueLabels[field] = asStringMap(labels);
  }
  const fieldNotes = asStringMap(config.field_notes);
  const derived = (Array.isArray(config.derived) ? config.derived : [])
    .filter((rule) => isPlainObject(rule) && rule.field && rule.from && isPlainObject(rule.map))
    .map((rule) => ({ field: String(rule.field), from: String(rule.from), map: asStringMap(rule.map), default: rule.default ?? null }));
  const hidden = new Set(Array.isArray(config.hidden) ? config.hidden.map(String) : []);
  for (const key of Object.keys(properties)) if (AUTO_HIDDEN.has(key)) hidden.add(key);
  const steps = (Array.isArray(config.steps) ? config.steps.map(String) : []).filter((key) => properties[key]);
  const anchors = { ...Object.fromEntries(Object.keys(DEFAULT_ANCHORS).map((key) => [key, null])), ...asStringMap(config.anchors) };
  const dryRunField = ["dryrun", "dry_run"].find((key) => properties[key]) || null;
  const idempotencyField = ["idempotency_key", "idempotencykey"].find((key) => properties[key]) || null;
  // Fields the customer must state themselves in this conversation. A value
  // the model fills in before the customer was asked is held, not used.
  const askCustomer = new Set((Array.isArray(config.ask_customer) ? config.ask_customer.map(String) : []).filter((key) => properties[key]));
  // Fields remembered on the customer's profile across requests (name and
  // number, not per-request things like machine condition).
  const remember = new Set((Array.isArray(config.remember) ? config.remember.map(String) : []).filter((key) => properties[key]));
  // Restrict a read to the customer identified in THIS conversation:
  // { "argument": "customerid" (forced input, optional), "field": "customerId" (in results) }.
  const scope = isPlainObject(config.customer_scope) ? config.customer_scope : null;
  const customerScope = scope && scope.field ? { field: String(scope.field), argument: scope.argument && properties[scope.argument] ? String(scope.argument) : null } : null;
  return { valueLabels, fieldNotes, derived, hidden, steps, anchors, dryRunField, idempotencyField, askCustomer, remember, customerScope };
}

/** Fields the server fills in itself; the model never sees or sends them. */
function serverOwnedFields(blueprint) {
  return new Set([...blueprint.hidden, ...blueprint.derived.map((rule) => rule.field)]);
}

function labelText(labels) {
  const entries = Object.entries(labels || {});
  return entries.length ? entries.map(([value, label]) => `${value} = ${label}`).join("; ") : "";
}

function baseType(schema) {
  if (!schema) return "string";
  if (Array.isArray(schema.type)) return schema.type.find((type) => type !== "null") || "string";
  return schema.type || (Array.isArray(schema.enum) && typeof schema.enum[0] === "number" ? "integer" : "string");
}

/** Describe one field for the model: API description + labels + tenant note. */
function describeField(key, schema, blueprint) {
  const parts = [];
  if (schema?.description) parts.push(String(schema.description));
  const labels = blueprint.valueLabels[key];
  if (labels && Object.keys(labels).length) parts.push(`Allowed values: ${labelText(labels)}.`);
  else if (Array.isArray(schema?.enum)) parts.push(`Allowed values: ${schema.enum.join(", ")}.`);
  if (blueprint.fieldNotes[key]) parts.push(blueprint.fieldNotes[key]);
  const type = baseType(schema);
  if (["integer", "number"].includes(type) && /id$/i.test(key) && !blueprint.fieldNotes[key]) {
    parts.push("Numeric id from a lookup result, never a name or serial number.");
  }
  return parts.join(" ").slice(0, 600);
}

/**
 * The tool schema Closer sees for a mapped operation: the API action's own
 * fields minus server-owned ones. Everything is optional here on purpose — the
 * model sends what it has, and the server answers with what is still missing.
 */
function buildBlueprintToolSchema(action, blueprint, { confirmation = false } = {}) {
  const properties = {};
  const sourceProps = isPlainObject(action?.input_schema?.properties) ? action.input_schema.properties : {};
  const owned = serverOwnedFields(blueprint);
  for (const [key, schema] of Object.entries(sourceProps)) {
    if (owned.has(key)) continue;
    const copy = { ...schema };
    delete copy.default;
    const description = describeField(key, schema, blueprint);
    if (description) copy.description = description;
    properties[key] = copy;
  }
  if (confirmation) {
    properties._confirmation_id = {
      type: "string",
      description: "Send ONLY this (no other fields) after the customer clearly confirms the summary from an earlier turn."
    };
  }
  return { type: "object", properties, required: [], additionalProperties: false };
}

function coerceValue(value, schema) {
  if (value === undefined) return { ok: false };
  const types = Array.isArray(schema?.type) ? schema.type : [schema?.type || ""];
  if (value === null) return types.includes("null") ? { ok: true, value: null } : { ok: false, reason: "a value is required" };
  if (types.includes("integer") || types.includes("number")) {
    const numeric = typeof value === "number" ? value : Number(String(value).trim().replace(/,/g, ""));
    if (String(value).trim() === "" || !Number.isFinite(numeric)) return { ok: false, reason: `expected a number but got "${String(value).slice(0, 40)}"` };
    if (types.includes("integer") && !types.includes("number") && !Number.isInteger(numeric)) return { ok: false, reason: "expected a whole number" };
    value = numeric;
  } else if (types.includes("boolean")) {
    if (typeof value !== "boolean") {
      const text = String(value).trim().toLowerCase();
      if (["true", "yes", "1"].includes(text)) value = true;
      else if (["false", "no", "0"].includes(text)) value = false;
      else return { ok: false, reason: "expected true or false" };
    }
  } else if (types.includes("string") && typeof value !== "string" && typeof value !== "object") {
    value = String(value);
  }
  if (Array.isArray(schema?.enum)) {
    const hit = schema.enum.find((option) => option === value || String(option).toLowerCase() === String(value).trim().toLowerCase());
    if (hit === undefined) return { ok: false, reason: `must be one of ${schema.enum.join(", ")}` };
    value = hit;
  }
  return { ok: true, value };
}

/**
 * Translate whatever the model sent into the API action's arguments:
 * logical engine names -> API names (field_mapping), types coerced, undeclared
 * fields dropped and reported instead of failing the whole call.
 */
function prepareArguments(action, blueprint, rawArgs, fieldMapping = {}) {
  const props = isPlainObject(action?.input_schema?.properties) ? action.input_schema.properties : {};
  const owned = serverOwnedFields(blueprint);
  const args = {};
  const ignored = [];
  const invalid = [];
  for (const [rawKey, rawValue] of Object.entries(rawArgs || {})) {
    if (rawKey === "_confirmation_id") continue;
    const key = props[rawKey] ? rawKey : (fieldMapping[rawKey] && props[fieldMapping[rawKey]] ? fieldMapping[rawKey] : null);
    if (!key || owned.has(key)) { ignored.push(rawKey); continue; }
    if (rawValue === undefined || rawValue === "") continue;
    // A model filling a required field with a placeholder ("Not provided",
    // "N/A", "unknown") is the same as not having it: keep it missing.
    if (typeof rawValue === "string" && PLACEHOLDER_VALUE.test(rawValue.trim())) { ignored.push(rawKey); continue; }
    const result = coerceValue(rawValue, props[key]);
    if (!result.ok) {
      invalid.push({ field: key, reason: result.reason || "invalid value", description: describeField(key, props[key], blueprint) });
      continue;
    }
    args[key] = result.value;
  }
  return { args, ignored, invalid };
}

/** Fill derived fields (e.g. priority from machine status). */
function applyDerived(args, blueprint, actionSchema) {
  const out = { ...args };
  const props = isPlainObject(actionSchema?.properties) ? actionSchema.properties : {};
  for (const rule of blueprint.derived) {
    const source = out[rule.from];
    let value = source === undefined || source === null ? undefined : rule.map[String(source)];
    if (value === undefined && source !== undefined && rule.default !== null) value = rule.default;
    if (value === undefined) continue;
    const coerced = coerceValue(value, props[rule.field]);
    if (coerced.ok) out[rule.field] = coerced.value;
  }
  return out;
}

/** Required API fields still missing, in blueprint step order first. */
function missingFields(action, blueprint, args) {
  const required = Array.isArray(action?.input_schema?.required) ? action.input_schema.required : [];
  const owned = serverOwnedFields(blueprint);
  // A required derived field (priority) is satisfied by asking for its source
  // (machine status) instead.
  const derivedSources = blueprint.derived.filter((rule) => required.includes(rule.field)).map((rule) => rule.from);
  const ordered = [...new Set([...blueprint.steps, ...required, ...derivedSources])].filter((key) => !owned.has(key));
  const isMissing = (key) => args[key] === undefined || args[key] === null || args[key] === "";
  return ordered.filter(isMissing);
}

function fieldFacts(action, blueprint, key) {
  const schema = action?.input_schema?.properties?.[key] || {};
  const facts = { field: key, description: describeField(key, schema, blueprint) };
  const labels = blueprint.valueLabels[key];
  if (labels && Object.keys(labels).length) facts.allowed = Object.entries(labels).map(([value, label]) => ({ value, label }));
  else if (Array.isArray(schema.enum)) facts.allowed = schema.enum.map((value) => ({ value: String(value) }));
  return facts;
}

/** Add human labels next to coded values so the model can summarize them. */
function labelArguments(args, blueprint) {
  const out = {};
  for (const [key, value] of Object.entries(args || {})) {
    const label = blueprint.valueLabels[key]?.[String(value)];
    out[key] = label ? { value, label } : value;
  }
  return out;
}

function readPath(data, path) {
  if (!path) return undefined;
  return String(path).split(".").reduce((node, part) => (node && typeof node === "object" ? node[part] : undefined), data);
}

/** Pull reference/status/etc. out of an API response using configured or common names. */
function extractAnchors(responseData, blueprint) {
  const data = isPlainObject(responseData) ? responseData : {};
  const anchors = {};
  for (const [anchor, candidates] of Object.entries(DEFAULT_ANCHORS)) {
    const configured = blueprint.anchors[anchor];
    const paths = configured ? [configured] : candidates.flatMap((name) => [name, `facts.${name}`]);
    for (const path of paths) {
      const value = readPath(data, path);
      if (value !== undefined && value !== null && value !== "") { anchors[anchor] = value; break; }
    }
  }
  return anchors;
}

/** Things an admin should fix in the blueprint or the API document. */
function blueprintWarnings(action, blueprint) {
  const warnings = [];
  const props = isPlainObject(action?.input_schema?.properties) ? action.input_schema.properties : {};
  for (const [key, schema] of Object.entries(props)) {
    if (serverOwnedFields(blueprint).has(key)) continue;
    if (Array.isArray(schema.enum) && schema.enum.some((value) => typeof value === "number") && !Object.keys(blueprint.valueLabels[key] || {}).length) {
      warnings.push(`"${key}" uses coded values (${schema.enum.join(", ")}) with no labels. Add value labels so Closer knows what each means.`);
    }
    if (!schema.description && !blueprint.fieldNotes[key] && !Array.isArray(schema.enum)) {
      warnings.push(`"${key}" has no description in the API document. Add a field note.`);
    }
  }
  if (action && !["GET", "HEAD"].includes(action.http_method) && !blueprint.dryRunField) {
    warnings.push("This write action has no dryRun option, so Closer cannot preview the result before the customer confirms.");
  }
  return warnings;
}

/** Validate a workflow_config submitted by an admin. Throws a readable message. */
function validateWorkflowConfig(config, action) {
  if (!isPlainObject(config)) throw new Error("Blueprint must be a JSON object.");
  const allowedKeys = new Set(["value_labels", "field_notes", "steps", "derived", "hidden", "anchors", "ask_customer", "remember", "customer_scope", "director"]);
  for (const key of Object.keys(config)) if (!allowedKeys.has(key)) throw new Error(`Unknown blueprint key "${key}".`);
  const props = isPlainObject(action?.input_schema?.properties) ? action.input_schema.properties : {};
  const known = (field, where) => { if (!props[field]) throw new Error(`${where}: "${field}" is not a field of the mapped API action.`); };
  for (const field of Object.keys(config.value_labels || {})) known(field, "value_labels");
  for (const field of Object.keys(config.field_notes || {})) known(field, "field_notes");
  for (const field of config.steps || []) known(field, "steps");
  for (const field of config.hidden || []) known(field, "hidden");
  for (const field of config.ask_customer || []) known(field, "ask_customer");
  for (const field of config.remember || []) known(field, "remember");
  if (config.customer_scope !== undefined) {
    if (!isPlainObject(config.customer_scope) || !config.customer_scope.field) throw new Error("customer_scope needs a field (the customer id field in results).");
    if (config.customer_scope.argument) known(config.customer_scope.argument, "customer_scope.argument");
  }
  for (const rule of config.derived || []) {
    if (!isPlainObject(rule) || !rule.field || !rule.from || !isPlainObject(rule.map)) throw new Error("Each derived rule needs field, from and map.");
    known(rule.field, "derived.field");
    known(rule.from, "derived.from");
  }
  if (JSON.stringify(config).length > 20000) throw new Error("Blueprint is too large.");
  return config;
}

/**
 * Gemini accepts a narrower schema dialect than OpenAI: no type unions, enums
 * must be strings, and several JSON-Schema keywords are rejected. An invalid
 * declaration makes Gemini answer in text instead of calling the tool.
 */
function sanitizeSchemaForGemini(schema) {
  if (Array.isArray(schema)) return schema.map(sanitizeSchemaForGemini);
  if (!isPlainObject(schema)) return schema;
  const out = {};
  let description = schema.description ? String(schema.description) : "";
  for (const [key, value] of Object.entries(schema)) {
    if (["additionalProperties", "$schema", "default", "minLength", "maxLength", "pattern", "format", "examples", "title"].includes(key)) continue;
    if (key === "description") continue;
    if (key === "type") {
      if (Array.isArray(value)) {
        out.type = value.find((type) => type !== "null") || "string";
        if (value.includes("null")) out.nullable = true;
      } else out.type = value;
      continue;
    }
    if (key === "enum") {
      if (Array.isArray(value) && value.every((option) => typeof option === "string")) out.enum = value;
      else if (Array.isArray(value) && !/Allowed values/.test(description)) description = `${description} Allowed values: ${value.join(", ")}.`.trim();
      continue;
    }
    if (key === "properties" && isPlainObject(value)) {
      out.properties = Object.fromEntries(Object.entries(value).map(([name, inner]) => [name, sanitizeSchemaForGemini(inner)]));
      continue;
    }
    out[key] = isPlainObject(value) || Array.isArray(value) ? sanitizeSchemaForGemini(value) : value;
  }
  if (out.type === "string" && out.enum) out.format = "enum";
  if (description) out.description = description;
  if (Array.isArray(out.required) && isPlainObject(out.properties)) out.required = out.required.filter((key) => out.properties[key]);
  if (Array.isArray(out.required) && !out.required.length) delete out.required;
  return out;
}

/**
 * Remove anything belonging to another customer from a read result. Returns
 * { data, removed, blocked } where blocked means the single record asked for
 * belongs to someone else.
 */
function scopeResultToCustomers(data, field, allowed) {
  let removed = 0;
  let blocked = false;
  const ok = (value) => allowed.has(String(value));
  const walk = (node, depth) => {
    if (depth > 6 || !node || typeof node !== "object") return node;
    if (Array.isArray(node)) {
      const kept = node.filter((item) => !(item && typeof item === "object" && !Array.isArray(item) && item[field] !== undefined && !ok(item[field])));
      removed += node.length - kept.length;
      return kept.map((item) => walk(item, depth + 1));
    }
    const out = {};
    for (const [key, value] of Object.entries(node)) {
      if (value && typeof value === "object" && !Array.isArray(value) && value[field] !== undefined && !ok(value[field])) { blocked = true; removed += 1; continue; }
      out[key] = walk(value, depth + 1);
    }
    return out;
  };
  const top = data && typeof data === "object" && !Array.isArray(data) && data[field] !== undefined && !ok(data[field]);
  if (top) return { data: null, removed: 1, blocked: true };
  return { data: walk(data, 0), removed, blocked };
}

module.exports = {
  scopeResultToCustomers,
  normalizeBlueprint,
  serverOwnedFields,
  describeField,
  buildBlueprintToolSchema,
  coerceValue,
  prepareArguments,
  applyDerived,
  missingFields,
  fieldFacts,
  labelArguments,
  extractAnchors,
  blueprintWarnings,
  validateWorkflowConfig,
  sanitizeSchemaForGemini
};
