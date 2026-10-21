const dns = require("dns").promises;
const net = require("net");
const crypto = require("crypto");
const { prisma } = require("./db");
const {
  parseApiDocument,
  detectAuthentication,
  discoverApplication
} = require("./integration-discovery");

const HTTP_METHODS = new Set(["get", "post", "put", "patch", "delete", "head", "options"]);
const READ_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
const AUTH_TYPES = new Set(["none", "bearer", "api_key_header", "api_key_query", "basic", "oauth2_pkce"]);
const APPROVAL_POLICIES = new Set(["automatic", "customer_confirmation", "staff_approval"]);
const APPROVAL_RANK = { automatic: 0, customer_confirmation: 1, staff_approval: 2 };
const MAX_SPEC_BYTES = 1024 * 1024;
const MAX_RESULT_CHARS = 20000;
const REQUEST_TIMEOUT_MS = 12000;
const executionWindows = new Map();

function enforceExecutionRate(connection) {
  const limit = Math.min(120, Math.max(1, Number(connection.behavior_config?.requestsPerMinute || 30)));
  const now = Date.now();
  const values = (executionWindows.get(connection.id) || []).filter((time) => now - time < 60000);
  if (values.length >= limit) throw new IntegrationError("This connection has reached its configured request limit. Try again shortly.", 429, "CONNECTION_RATE_LIMITED");
  values.push(now);
  executionWindows.set(connection.id, values);
}

class IntegrationError extends Error {
  constructor(message, statusCode = 400, code = "INTEGRATION_ERROR") {
    super(message);
    this.name = "IntegrationError";
    this.statusCode = statusCode;
    this.code = code;
  }
}

function integrationKey() {
  const secret = String(process.env.INTEGRATION_ENCRYPTION_SECRET || "");
  if (!secret) {
    throw new IntegrationError(
      "Encrypted custom-app credential storage is not configured. Contact AIStaff support.",
      503,
      "ENCRYPTION_NOT_CONFIGURED"
    );
  }
  return crypto.createHash("sha256").update(secret).digest();
}

function encryptIntegrationSecret(value) {
  if (!value) return "";
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", integrationKey(), iv);
  const encrypted = Buffer.concat([cipher.update(String(value), "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted.toString("hex")}`;
}

function decryptIntegrationSecret(payload) {
  if (!payload) return "";
  const [ivHex, tagHex, encryptedHex] = String(payload).split(":");
  const decipher = crypto.createDecipheriv("aes-256-gcm", integrationKey(), Buffer.from(ivHex, "hex"));
  decipher.setAuthTag(Buffer.from(tagHex, "hex"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedHex, "hex")),
    decipher.final()
  ]).toString("utf8");
}

function isPrivateIpv4(ip) {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part))) return true;
  const [a, b] = parts;
  return a === 0 || a === 10 || a === 127 || a >= 224
    || (a === 100 && b >= 64 && b <= 127)
    || (a === 169 && b === 254)
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 198 && (b === 18 || b === 19));
}

function isPrivateIp(ip) {
  if (net.isIP(ip) === 4) return isPrivateIpv4(ip);
  if (net.isIP(ip) === 6) {
    const value = ip.toLowerCase();
    return value === "::" || value === "::1" || value.startsWith("fc")
      || value.startsWith("fd") || value.startsWith("fe8")
      || value.startsWith("fe9") || value.startsWith("fea") || value.startsWith("feb")
      || value.startsWith("::ffff:127.") || value.startsWith("::ffff:10.")
      || value.startsWith("::ffff:192.168.");
  }
  return true;
}

function parseUrl(value, label = "URL") {
  let parsed;
  try {
    parsed = new URL(String(value || "").trim());
  } catch {
    throw new IntegrationError(`${label} must be a complete HTTPS URL.`);
  }
  if (parsed.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && parsed.protocol === "http:")) {
    throw new IntegrationError(`${label} must use HTTPS.`);
  }
  if (parsed.username || parsed.password) {
    throw new IntegrationError(`${label} must not include credentials. Use the authentication fields instead.`);
  }
  parsed.hash = "";
  return parsed;
}

async function assertPublicUrl(value, label = "URL") {
  const parsed = parseUrl(value, label);
  const host = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host === "metadata.google.internal") {
    throw new IntegrationError(`${label} cannot point to a local or private service.`);
  }
  if (net.isIP(host)) {
    if (isPrivateIp(host)) throw new IntegrationError(`${label} cannot point to a private network address.`);
    return parsed;
  }
  let addresses;
  try {
    addresses = await dns.lookup(host, { all: true, verbatim: true });
  } catch {
    throw new IntegrationError(`${label} hostname could not be resolved.`);
  }
  if (!addresses.length || addresses.some((entry) => isPrivateIp(entry.address))) {
    throw new IntegrationError(`${label} resolves to a private network address.`);
  }
  return parsed;
}

async function safeFetch(url, options = {}, fetchImpl = fetch) {
  let target = String(url);
  for (let redirects = 0; redirects <= 3; redirects += 1) {
    const parsed = await assertPublicUrl(target, "API URL");
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), options.timeoutMs || REQUEST_TIMEOUT_MS);
    let response;
    try {
      response = await fetchImpl(parsed.toString(), {
        ...options,
        timeoutMs: undefined,
        redirect: "manual",
        signal: controller.signal
      });
    } catch (error) {
      if (error.name === "AbortError") throw new IntegrationError("The API request timed out.", 504, "TIMEOUT");
      throw new IntegrationError(`The API could not be reached: ${error.message}`, 502, "UNREACHABLE");
    } finally {
      clearTimeout(timeout);
    }
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get("location");
    if (!location || redirects === 3) throw new IntegrationError("The API redirected too many times.", 502);
    target = new URL(location, parsed).toString();
  }
  throw new IntegrationError("The API redirected too many times.", 502);
}

async function readResponseText(response, maxChars = MAX_RESULT_CHARS) {
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > maxChars * 4) throw new IntegrationError("The API response is too large.", 502, "RESPONSE_TOO_LARGE");
  if (!response.body?.getReader) {
    const text = await response.text();
    if (text.length > maxChars) throw new IntegrationError("The API response is too large.", 502, "RESPONSE_TOO_LARGE");
    return text;
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
    if (text.length > maxChars) {
      await reader.cancel();
      throw new IntegrationError("The API response is too large.", 502, "RESPONSE_TOO_LARGE");
    }
  }
  return text + decoder.decode();
}

async function loadOpenApiDocument({ specText, specUrl, fetchImpl = fetch }) {
  let raw = String(specText || "").trim();
  if (!raw && specUrl) {
    const response = await safeFetch(specUrl, {
      method: "GET",
      headers: { Accept: "application/json, application/yaml, text/yaml, application/vnd.oai.openapi+json" }
    }, fetchImpl);
    if (!response.ok) throw new IntegrationError(`OpenAPI document returned HTTP ${response.status}.`, 400);
    raw = await readResponseText(response, MAX_SPEC_BYTES);
  }
  if (!raw) throw new IntegrationError("Paste an OpenAPI JSON document or provide its HTTPS URL.");
  if (Buffer.byteLength(raw, "utf8") > MAX_SPEC_BYTES) {
    throw new IntegrationError("OpenAPI document must be 1 MB or smaller.");
  }
  try {
    return parseApiDocument(raw);
  } catch (error) {
    throw new IntegrationError(error.message);
  }
}

function resolveLocalRef(spec, ref, depth = 0) {
  if (!ref || typeof ref !== "string" || !ref.startsWith("#/") || depth > 12) return {};
  let value = spec;
  for (const part of ref.slice(2).split("/")) {
    const key = part.replace(/~1/g, "/").replace(/~0/g, "~");
    value = value && value[key];
  }
  return value && typeof value === "object" ? value : {};
}

function normalizeSchema(schema, spec, depth = 0) {
  if (!schema || typeof schema !== "object" || depth > 10) return { type: "string" };
  const source = schema.$ref ? { ...resolveLocalRef(spec, schema.$ref, depth + 1), ...schema, $ref: undefined } : schema;
  const allowed = ["type", "description", "enum", "format", "minimum", "maximum", "minLength", "maxLength", "pattern", "default"];
  const output = {};
  for (const key of allowed) {
    if (source[key] !== undefined) output[key] = source[key];
  }
  if (!output.type) {
    if (source.properties) output.type = "object";
    else if (source.items) output.type = "array";
    else output.type = "string";
  }
  if (source.properties && typeof source.properties === "object") {
    output.properties = Object.fromEntries(Object.entries(source.properties).map(([key, value]) => [
      key,
      normalizeSchema(value, spec, depth + 1)
    ]));
  }
  if (Array.isArray(source.required)) output.required = source.required.filter((key) => output.properties?.[key]);
  if (source.items) output.items = normalizeSchema(source.items, spec, depth + 1);
  return output;
}

function slug(value, fallback = "action") {
  const clean = String(value || "").toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "");
  return clean || fallback;
}

function titleFromOperation(value) {
  return String(value || "Action")
    .replace(/[_-]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function classifyAction({ operationId, displayName, description, method, path }) {
  const text = `${operationId} ${displayName} ${description} ${path}`.toLowerCase();
  let category = READ_METHODS.has(method) ? "read"
    : method === "DELETE" ? "delete"
      : method === "POST" ? "create"
        : ["PUT", "PATCH"].includes(method) ? "update" : "other";
  if (/email|message|sms|notify|notification|send|reply|communication/.test(text)) category = "communication";
  const highImpact = method === "DELETE" || /refund|payment|charge|invoice|terminate|close account|remove user|cancel|send email|send message|notify customer/.test(text);
  const minimumPolicy = READ_METHODS.has(method) ? "automatic" : highImpact ? "staff_approval" : "customer_confirmation";
  return { category, highImpact, minimumPolicy };
}

function uniqueToolName(connectionName, operationId, used) {
  const prefix = `custom_${slug(connectionName, "app").slice(0, 18)}_`;
  const stem = `${prefix}${slug(operationId)}`.slice(0, 60).replace(/_+$/g, "");
  let candidate = stem;
  let counter = 2;
  while (used.has(candidate)) {
    candidate = `${stem.slice(0, 61 - String(counter).length)}_${counter}`;
    counter += 1;
  }
  used.add(candidate);
  return candidate;
}

function discoverOpenApiActions(spec, connectionName) {
  const actions = [];
  const usedNames = new Set();
  for (const [path, pathItem] of Object.entries(spec.paths || {})) {
    if (!pathItem || typeof pathItem !== "object") continue;
    for (const [methodKey, operation] of Object.entries(pathItem)) {
      if (!HTTP_METHODS.has(methodKey.toLowerCase()) || !operation || typeof operation !== "object") continue;
      const httpMethod = methodKey.toUpperCase();
      const operationId = String(operation.operationId || `${methodKey}_${path}`).trim();
      const properties = {};
      const required = [];
      const mappings = [];
      const parameters = [...(Array.isArray(pathItem.parameters) ? pathItem.parameters : []), ...(Array.isArray(operation.parameters) ? operation.parameters : [])];
      for (const rawParameter of parameters) {
        const parameter = rawParameter?.$ref ? { ...resolveLocalRef(spec, rawParameter.$ref), ...rawParameter } : rawParameter;
        if (!parameter?.name || !["path", "query", "header"].includes(parameter.in)) continue;
        const argName = slug(parameter.name, "value");
        properties[argName] = normalizeSchema(parameter.schema || { type: parameter.type || "string" }, spec);
        if (parameter.description && !properties[argName].description) properties[argName].description = parameter.description;
        if (parameter.required || parameter.in === "path") required.push(argName);
        mappings.push({ argName, apiName: parameter.name, location: parameter.in });
      }

      const media = operation.requestBody?.content?.["application/json"]
        || operation.requestBody?.content?.["application/*+json"];
      const bodySchema = media?.schema ? normalizeSchema(media.schema, spec) : null;
      if (bodySchema?.type === "object" && bodySchema.properties) {
        for (const [bodyName, bodyProperty] of Object.entries(bodySchema.properties)) {
          let argName = slug(bodyName, "field");
          if (properties[argName]) argName = `body_${argName}`;
          properties[argName] = bodyProperty;
          if ((bodySchema.required || []).includes(bodyName)) required.push(argName);
          mappings.push({ argName, apiName: bodyName, location: "body" });
        }
      } else if (bodySchema) {
        properties.body = bodySchema;
        if (operation.requestBody?.required) required.push("body");
        mappings.push({ argName: "body", apiName: "body", location: "body_raw" });
      }

      const riskLevel = READ_METHODS.has(httpMethod) ? "read" : "write";
      const displayName = String(operation.summary || titleFromOperation(operationId)).slice(0, 120);
      const description = String(operation.description || operation.summary || `Call ${httpMethod} ${path}`).slice(0, 1000);
      const classification = classifyAction({ operationId, displayName, description, method: httpMethod, path });
      actions.push({
        operation_id: operationId.slice(0, 180),
        tool_name: uniqueToolName(connectionName, operationId, usedNames),
        display_name: displayName,
        description,
        http_method: httpMethod,
        path: path.slice(0, 1000),
        input_schema: {
          type: "object",
          properties,
          required: [...new Set(required)],
          additionalProperties: false
        },
        request_config: { mappings },
        response_schema: normalizeSchema(operation.responses?.["200"]?.content?.["application/json"]?.schema || {}, spec),
        category: classification.category,
        risk_level: riskLevel,
        approval_policy: classification.minimumPolicy,
        minimum_approval_policy: classification.minimumPolicy,
        is_high_impact: classification.highImpact,
        source: "openapi",
        validated: true
      });
    }
  }
  if (!actions.length) throw new IntegrationError("No callable operations were found in this OpenAPI document.");
  if (actions.length > 100) throw new IntegrationError("This API exposes more than 100 operations. Use a smaller Closer-specific OpenAPI document.");
  return actions;
}

function baseUrlFromSpec(spec) {
  const candidate = spec.servers?.[0]?.url;
  if (candidate) return candidate;
  if (spec.swagger === "2.0" && spec.host) {
    return `${spec.schemes?.[0] || "https"}://${spec.host}${spec.basePath || ""}`;
  }
  return "";
}

function authHeaders(connection) {
  const config = connection.auth_config && typeof connection.auth_config === "object" ? connection.auth_config : {};
  const encrypted = decryptIntegrationSecret(connection.auth_secret_encrypted || "");
  let secret = encrypted;
  try {
    const envelope = JSON.parse(encrypted);
    secret = envelope.accessToken || envelope.secret || "";
  } catch { /* legacy encrypted scalar */ }
  if (["bearer", "oauth2_pkce"].includes(connection.auth_type) && secret) return { Authorization: `Bearer ${secret}` };
  if (connection.auth_type === "api_key_header" && secret) {
    return { [config.parameterName || config.headerName || "X-API-Key"]: secret };
  }
  if (connection.auth_type === "basic" && secret) {
    return { Authorization: `Basic ${Buffer.from(`${config.username || ""}:${secret}`).toString("base64")}` };
  }
  return {};
}

function addQueryAuthentication(url, connection) {
  if (connection.auth_type !== "api_key_query") return url;
  const config = connection.auth_config && typeof connection.auth_config === "object" ? connection.auth_config : {};
  const secret = decryptIntegrationSecret(connection.auth_secret_encrypted || "");
  if (secret) url.searchParams.set(config.parameterName || "api_key", secret);
  return url;
}

function validateValue(value, schema, label) {
  if (value === undefined || value === null) return;
  const type = schema?.type;
  if (type === "string" && typeof value !== "string") throw new IntegrationError(`${label} must be text.`);
  if (type === "number" && typeof value !== "number") throw new IntegrationError(`${label} must be a number.`);
  if (type === "integer" && (!Number.isInteger(value))) throw new IntegrationError(`${label} must be a whole number.`);
  if (type === "boolean" && typeof value !== "boolean") throw new IntegrationError(`${label} must be true or false.`);
  if (type === "array" && !Array.isArray(value)) throw new IntegrationError(`${label} must be a list.`);
  if (type === "object" && (typeof value !== "object" || Array.isArray(value))) throw new IntegrationError(`${label} must be an object.`);
  if (Array.isArray(schema?.enum) && !schema.enum.includes(value)) throw new IntegrationError(`${label} is not an allowed value.`);
}

function validateArguments(schema, args) {
  const input = args && typeof args === "object" && !Array.isArray(args) ? args : {};
  for (const name of schema.required || []) {
    if (input[name] === undefined || input[name] === null || input[name] === "") {
      throw new IntegrationError(`Action field "${name}" is required.`);
    }
  }
  for (const [name, value] of Object.entries(input)) {
    if (name === "_confirmation_id") continue;
    if (!schema.properties?.[name]) throw new IntegrationError(`Action field "${name}" is not allowed.`);
    validateValue(value, schema.properties[name], name);
  }
  return Object.fromEntries(Object.entries(input).filter(([key]) => key !== "_confirmation_id"));
}

function canonicalJson(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function buildRequest(action, connection, args) {
  let requestPath = action.path;
  const query = new URLSearchParams();
  const headers = { Accept: "application/json", ...authHeaders(connection) };
  let body;
  const bodyObject = {};
  for (const mapping of action.request_config?.mappings || []) {
    const value = args[mapping.argName];
    if (value === undefined || value === null) continue;
    if (mapping.location === "path") requestPath = requestPath.replace(`{${mapping.apiName}}`, encodeURIComponent(String(value)));
    if (mapping.location === "query") query.append(mapping.apiName, typeof value === "object" ? JSON.stringify(value) : String(value));
    if (mapping.location === "header") headers[mapping.apiName] = String(value);
    if (mapping.location === "body") bodyObject[mapping.apiName] = value;
    if (mapping.location === "body_raw") body = value;
  }
  if (Object.keys(bodyObject).length) body = bodyObject;
  const base = connection.base_url.endsWith("/") ? connection.base_url : `${connection.base_url}/`;
  const url = addQueryAuthentication(new URL(requestPath.replace(/^\//, ""), base), connection);
  for (const [key, value] of query) url.searchParams.append(key, value);
  const options = { method: action.http_method, headers };
  if (body !== undefined && !READ_METHODS.has(action.http_method)) {
    headers["Content-Type"] = "application/json";
    options.body = JSON.stringify(body);
  }
  return { url: url.toString(), options };
}

async function createConnection({ companyId, actorEmail, name, baseUrl, specUrl, specText, authType, authConfig, authSecret, fetchImpl = fetch }) {
  const cleanName = String(name || "").trim();
  if (!cleanName) throw new IntegrationError("Connection name is required.");
  if (!AUTH_TYPES.has(authType)) throw new IntegrationError("Choose a supported authentication method.");
  if (authType !== "none" && !process.env.INTEGRATION_ENCRYPTION_SECRET) {
    throw new IntegrationError("Encrypted credential storage is not configured. Contact AIStaff support.", 503, "ENCRYPTION_NOT_CONFIGURED");
  }
  const spec = await loadOpenApiDocument({ specText, specUrl, fetchImpl });
  const resolvedBase = String(baseUrl || baseUrlFromSpec(spec)).trim();
  const parsedBase = await assertPublicUrl(resolvedBase, "API base URL");
  const actions = discoverOpenApiActions(spec, cleanName);
  const existing = await prisma.integrationConnection.findFirst({ where: { company_id: companyId, name: cleanName } });
  if (existing) throw new IntegrationError("A connection with this name already exists.", 409, "DUPLICATE_CONNECTION");
  return prisma.integrationConnection.create({
    data: {
      company_id: companyId,
      name: cleanName.slice(0, 120),
      base_url: parsedBase.toString().replace(/\/$/, ""),
      source_url: specUrl ? String(specUrl).trim() : parsedBase.toString(),
      spec_source_url: specUrl ? String(specUrl).trim() : null,
      openapi_spec: spec,
      discovery_status: "succeeded",
      discovery_message: "OpenAPI document imported from Advanced Settings.",
      discovery_metadata: { importedManually: true },
      wizard_step: authType === "none" ? "test" : "authenticate",
      auth_type: authType,
      auth_config: authConfig || {},
      auth_secret_encrypted: authSecret ? encryptIntegrationSecret(String(authSecret)) : null,
      credential_status: authType === "none" ? "not_required" : authSecret ? "unverified" : "missing",
      credential_updated_at: authSecret ? new Date() : null,
      status: "draft",
      created_by: actorEmail || null,
      actions: { create: actions.map((action) => ({ ...action, company_id: companyId })) }
    },
    include: { actions: { orderBy: [{ risk_level: "asc" }, { display_name: "asc" }] } }
  });
}

function safeAuditMetadata(metadata) {
  const blocked = /secret|token|password|credential|authorization|api.?key/i;
  const walk = (value, depth = 0) => {
    if (depth > 5) return "[truncated]";
    if (Array.isArray(value)) return value.slice(0, 100).map((item) => walk(item, depth + 1));
    if (!value || typeof value !== "object") return typeof value === "string" ? value.slice(0, 1000) : value;
    return Object.fromEntries(Object.entries(value).filter(([key]) => !blocked.test(key)).map(([key, item]) => [key, walk(item, depth + 1)]));
  };
  return walk(metadata || {});
}

async function auditTenantChange({ companyId, actor, action, targetType, targetId, metadata }) {
  await prisma.tenantAuditLog.create({
    data: {
      company_id: companyId,
      actor_id: actor?.id || null,
      actor_email: actor?.email || null,
      action,
      target_type: targetType,
      target_id: targetId || null,
      metadata: safeAuditMetadata(metadata)
    }
  });
}

function applicationNameFromHost(hostname) {
  const ignored = new Set(["www", "api", "app", "apps", "docs", "developer", "developers", "com", "net", "org", "io", "co", "ph"]);
  const label = String(hostname || "application").toLowerCase().split(".").find((part) => part && !ignored.has(part)) || "application";
  return label.replace(/[-_]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase()).slice(0, 120);
}

async function discoverConnection({ companyId, actor, name, sourceUrl, fetchImpl = fetch }) {
  const parsedSource = await assertPublicUrl(sourceUrl, "Website or API documentation URL");
  const requestedName = String(name || "").trim();
  const baseName = requestedName || applicationNameFromHost(parsedSource.hostname);
  const sameSource = await prisma.integrationConnection.findFirst({ where: { company_id: companyId, source_url: parsedSource.toString() } });
  if (sameSource) throw new IntegrationError("This website is already connected.", 409, "DUPLICATE_CONNECTION");
  const matchingNames = await prisma.integrationConnection.findMany({
    where: { company_id: companyId, name: { startsWith: baseName } },
    select: { name: true }
  });
  const usedNames = new Set(matchingNames.map((row) => row.name));
  let cleanName = baseName;
  for (let suffix = 2; usedNames.has(cleanName); suffix += 1) cleanName = `${baseName} ${suffix}`;
  const discovery = await discoverApplication({ sourceUrl: parsedSource.toString(), safeFetch, fetchImpl });
  let actions = [];
  if (discovery.spec) actions = discoverOpenApiActions(discovery.spec, cleanName);
  if (discovery.baseUrl) await assertPublicUrl(discovery.baseUrl, "Discovered API base URL");
  const authType = AUTH_TYPES.has(discovery.auth.type) ? discovery.auth.type : "unsupported";
  const credentialStatus = discovery.auth.required ? "missing" : "not_required";
  const connection = await prisma.integrationConnection.create({
    data: {
      company_id: companyId,
      name: cleanName.slice(0, 120),
      source_url: parsedSource.toString(),
      base_url: discovery.baseUrl || parsedSource.origin,
      spec_source_url: discovery.specUrl,
      openapi_spec: discovery.spec || {},
      connection_type: discovery.spec ? "rest_openapi" : "unknown",
      discovery_status: discovery.status,
      discovery_message: discovery.message,
      discovery_metadata: {
        attemptedCount: discovery.attempted.length,
        authenticationLabel: discovery.auth.label,
        authenticationRequired: discovery.auth.required
      },
      wizard_step: discovery.spec ? (discovery.auth.required ? "authenticate" : "test") : "discover",
      auth_type: authType,
      auth_config: discovery.auth.config || {},
      credential_status: credentialStatus,
      status: discovery.spec ? "draft" : "discovery_failed",
      created_by: actor?.email || null,
      actions: { create: actions.map((action) => ({ ...action, company_id: companyId })) }
    },
    include: { actions: true }
  });
  await auditTenantChange({ companyId, actor, action: "integration.discovered", targetType: "integration_connection", targetId: connection.id, metadata: { status: discovery.status, actionCount: actions.length, sourceHost: parsedSource.hostname } });
  return connection;
}

async function retryConnectionDiscovery({ companyId, connectionId, actor, sourceUrl, fetchImpl = fetch }) {
  const connection = await prisma.integrationConnection.findFirst({
    where: { id: connectionId, company_id: companyId },
    include: { actions: true }
  });
  if (!connection) throw new IntegrationError("Connection not found.", 404);
  if (connection.actions.length) {
    throw new IntegrationError("This connection already has available actions.", 409, "CONNECTION_ALREADY_DISCOVERED");
  }
  const parsedSource = await assertPublicUrl(sourceUrl, "Website or API documentation URL");
  const discovery = await discoverApplication({ sourceUrl: parsedSource.toString(), safeFetch, fetchImpl });
  let actions = [];
  if (discovery.spec) actions = discoverOpenApiActions(discovery.spec, connection.name);
  if (discovery.baseUrl) await assertPublicUrl(discovery.baseUrl, "Discovered API base URL");
  const authType = AUTH_TYPES.has(discovery.auth.type) ? discovery.auth.type : "unsupported";
  const credentialStatus = discovery.auth.required ? "missing" : "not_required";
  const updated = await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: {
      source_url: parsedSource.toString(),
      base_url: discovery.baseUrl || parsedSource.origin,
      spec_source_url: discovery.specUrl,
      openapi_spec: discovery.spec || {},
      connection_type: discovery.spec ? "rest_openapi" : "unknown",
      discovery_status: discovery.status,
      discovery_message: discovery.message,
      discovery_metadata: {
        attemptedCount: discovery.attempted.length,
        authenticationLabel: discovery.auth.label,
        authenticationRequired: discovery.auth.required
      },
      wizard_step: discovery.spec ? (discovery.auth.required ? "authenticate" : "test") : "discover",
      auth_type: authType,
      auth_config: discovery.auth.config || {},
      credential_status: credentialStatus,
      status: discovery.spec ? "draft" : "discovery_failed",
      actions: { create: actions.map((action) => ({ ...action, company_id: companyId })) }
    },
    include: { actions: true }
  });
  await auditTenantChange({
    companyId,
    actor,
    action: "integration.discovery_retried",
    targetType: "integration_connection",
    targetId: connection.id,
    metadata: { status: discovery.status, actionCount: actions.length, sourceHost: parsedSource.hostname }
  });
  return updated;
}

async function updateConnectionAuth({ companyId, connectionId, actor, authType, authConfig, authSecret }) {
  const connection = await prisma.integrationConnection.findFirst({ where: { id: connectionId, company_id: companyId } });
  if (!connection) throw new IntegrationError("Connection not found.", 404);
  if (!AUTH_TYPES.has(authType)) throw new IntegrationError("Choose a supported authentication method.");
  if (authType !== "none" && authType !== "oauth2_pkce" && !authSecret) throw new IntegrationError("Enter the required credential.");
  if (authType !== "none" && !process.env.INTEGRATION_ENCRYPTION_SECRET) throw new IntegrationError("Encrypted credential storage is not configured.", 503, "ENCRYPTION_NOT_CONFIGURED");
  const config = { ...(connection.auth_config || {}), ...(authConfig || {}) };
  if (authType === "api_key_header" && !config.parameterName) config.parameterName = "X-API-Key";
  if (authType === "api_key_query" && !config.parameterName) config.parameterName = "api_key";
  const data = {
    auth_type: authType,
    auth_config: config,
    credential_status: authType === "none" ? "not_required" : authType === "oauth2_pkce" ? "missing" : "unverified",
    credential_updated_at: authSecret ? new Date() : connection.credential_updated_at,
    wizard_step: "test"
  };
  if (authType === "none") data.auth_secret_encrypted = null;
  else if (authSecret) data.auth_secret_encrypted = encryptIntegrationSecret(String(authSecret));
  const updated = await prisma.integrationConnection.update({ where: { id: connection.id }, data });
  await auditTenantChange({ companyId, actor, action: "integration.authentication_updated", targetType: "integration_connection", targetId: connection.id, metadata: { authType } });
  return updated;
}

function oauthRedirectUri() {
  return `${String(process.env.PUBLIC_URL || "https://aistaff.click").replace(/\/$/, "")}/api/integrations/oauth/callback`;
}

async function startOAuth({ companyId, connectionId, actor, clientId, scopes = [] }) {
  const connection = await prisma.integrationConnection.findFirst({ where: { id: connectionId, company_id: companyId } });
  if (!connection || connection.auth_type !== "oauth2_pkce") throw new IntegrationError("OAuth connection not found.", 404);
  const config = connection.auth_config || {};
  const authorizationUrl = await assertPublicUrl(config.authorizationUrl, "OAuth authorization URL");
  await assertPublicUrl(config.tokenUrl, "OAuth token URL");
  const verifier = crypto.randomBytes(48).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  const state = crypto.randomBytes(32).toString("base64url");
  const requestedScopes = scopes.length ? scopes : Object.keys(config.availableScopes || {});
  authorizationUrl.searchParams.set("response_type", "code");
  authorizationUrl.searchParams.set("client_id", clientId);
  authorizationUrl.searchParams.set("redirect_uri", oauthRedirectUri());
  authorizationUrl.searchParams.set("state", state);
  authorizationUrl.searchParams.set("code_challenge", challenge);
  authorizationUrl.searchParams.set("code_challenge_method", "S256");
  if (requestedScopes.length) authorizationUrl.searchParams.set("scope", requestedScopes.join(" "));
  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: {
      auth_config: { ...config, clientId, scopes: requestedScopes },
      oauth_state_hash: crypto.createHash("sha256").update(state).digest("hex"),
      oauth_pkce_encrypted: encryptIntegrationSecret(verifier),
      oauth_state_expires_at: new Date(Date.now() + 10 * 60 * 1000)
    }
  });
  await auditTenantChange({ companyId, actor, action: "integration.oauth_started", targetType: "integration_connection", targetId: connection.id, metadata: { scopeCount: requestedScopes.length } });
  return { authorizationUrl: authorizationUrl.toString(), state };
}

async function completeOAuth({ companyId, state, code, fetchImpl = fetch }) {
  const stateHash = crypto.createHash("sha256").update(String(state || "")).digest("hex");
  const connection = await prisma.integrationConnection.findFirst({ where: { company_id: companyId, oauth_state_hash: stateHash, oauth_state_expires_at: { gt: new Date() } } });
  if (!connection || !code) throw new IntegrationError("OAuth authorization expired or is invalid.", 400, "OAUTH_STATE_INVALID");
  const config = connection.auth_config || {};
  const tokenUrl = await assertPublicUrl(config.tokenUrl, "OAuth token URL");
  const verifier = decryptIntegrationSecret(connection.oauth_pkce_encrypted || "");
  const body = new URLSearchParams({ grant_type: "authorization_code", code: String(code), redirect_uri: oauthRedirectUri(), client_id: String(config.clientId || ""), code_verifier: verifier });
  const response = await safeFetch(tokenUrl.toString(), { method: "POST", headers: { Accept: "application/json", "Content-Type": "application/x-www-form-urlencoded" }, body: body.toString() }, fetchImpl);
  const raw = await readResponseText(response, 20000);
  let payload = {};
  try { payload = JSON.parse(raw); } catch { throw new IntegrationError("OAuth provider returned an unreadable token response.", 502); }
  if (!response.ok || !payload.access_token) throw new IntegrationError("OAuth provider did not authorize this connection.", 400, "OAUTH_EXCHANGE_FAILED");
  const envelope = { accessToken: payload.access_token, refreshToken: payload.refresh_token || null, tokenType: payload.token_type || "Bearer", expiresAt: payload.expires_in ? Date.now() + Number(payload.expires_in) * 1000 : null };
  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: { auth_secret_encrypted: encryptIntegrationSecret(JSON.stringify(envelope)), credential_status: "unverified", credential_updated_at: new Date(), oauth_state_hash: null, oauth_pkce_encrypted: null, oauth_state_expires_at: null, wizard_step: "test" }
  });
  return connection;
}

function publicConnection(connection) {
  const enabledCount = (connection.actions || []).filter((action) => action.enabled).length;
  return {
    id: connection.id,
    name: connection.name,
    baseUrl: connection.base_url,
    sourceUrl: connection.source_url,
    specSourceUrl: connection.spec_source_url,
    connectionType: connection.connection_type,
    discoveryStatus: connection.discovery_status,
    discoveryMessage: connection.discovery_message,
    discoveryMetadata: connection.discovery_metadata || {},
    wizardStep: connection.wizard_step,
    authType: connection.auth_type,
    authConfig: connection.auth_config || {},
    hasSecret: Boolean(connection.auth_secret_encrypted),
    credentialStatus: connection.credential_status,
    status: connection.status,
    lastTestedAt: connection.last_tested_at,
    lastTestStatus: connection.last_test_status,
    lastTestMessage: connection.last_test_message,
    lastSuccessAt: connection.last_success_at,
    disabledAt: connection.disabled_at,
    behaviorConfig: connection.behavior_config || {},
    apiVersion: connection.api_version,
    approvedActions: enabledCount,
    createdAt: connection.created_at,
    updatedAt: connection.updated_at,
    actions: (connection.actions || []).map((action) => ({
      id: action.id,
      operationId: action.operation_id,
      toolName: action.tool_name,
      displayName: action.display_name,
      description: action.description,
      method: action.http_method,
      path: action.path,
      inputSchema: action.input_schema,
      enabled: action.enabled,
      category: action.category,
      riskLevel: action.risk_level,
      approvalPolicy: action.approval_policy,
      minimumApprovalPolicy: action.minimum_approval_policy,
      highImpact: action.is_high_impact,
      source: action.source,
      validated: action.validated,
      assignments: (action.engine_mappings || []).map((mapping) => ({
        id: mapping.id,
        tenantOperationId: mapping.tenant_engine_operation_id,
        engineName: mapping.tenant_operation?.tenant_engine?.engine?.name || "Business Engine",
        operationName: mapping.tenant_operation?.definition?.name || "Operation"
      }))
    }))
  };
}

async function listConnections(companyId) {
  const rows = await prisma.integrationConnection.findMany({
    where: { company_id: companyId },
    include: { actions: { include: { engine_mappings: { include: { tenant_operation: { include: { definition: true, tenant_engine: { include: { engine: true } } } } } } }, orderBy: [{ category: "asc" }, { display_name: "asc" }] } },
    orderBy: { created_at: "desc" }
  });
  return rows.map(publicConnection);
}

async function updateAction({ companyId, actionId, enabled, approvalPolicy, acknowledgeHighImpact = false, actor = null }) {
  if (!APPROVAL_POLICIES.has(approvalPolicy)) throw new IntegrationError("Choose a valid approval policy.");
  const action = await prisma.integrationAction.findFirst({ where: { id: actionId, company_id: companyId } });
  if (!action) throw new IntegrationError("Action not found.", 404);
  if (APPROVAL_RANK[approvalPolicy] < APPROVAL_RANK[action.minimum_approval_policy || "automatic"]) {
    throw new IntegrationError(`This action requires at least ${String(action.minimum_approval_policy).replaceAll("_", " ")}.`);
  }
  if (enabled && action.is_high_impact && !acknowledgeHighImpact) {
    throw new IntegrationError("Confirm that you understand this high-impact action before enabling it.", 409, "HIGH_IMPACT_CONFIRMATION_REQUIRED");
  }
  const updated = await prisma.integrationAction.update({
    where: { id: action.id },
    data: { enabled: Boolean(enabled), approval_policy: approvalPolicy }
  });
  const enabledCount = await prisma.integrationAction.count({ where: { connection_id: action.connection_id, enabled: true } });
  await prisma.integrationConnection.update({
    where: { id: action.connection_id },
    data: { status: enabledCount ? "active" : "ready_review", wizard_step: enabledCount ? "activate" : "review", disabled_at: null }
  });
  await auditTenantChange({ companyId, actor, action: "integration.action_updated", targetType: "integration_action", targetId: action.id, metadata: { enabled: Boolean(enabled), approvalPolicy, highImpact: action.is_high_impact } });
  return updated;
}

async function testConnection({ companyId, connectionId, fetchImpl = fetch }) {
  const connection = await prisma.integrationConnection.findFirst({ where: { id: connectionId, company_id: companyId }, include: { actions: true } });
  if (!connection) throw new IntegrationError("Connection not found.", 404);
  let status = "unverified";
  let credentialStatus = connection.auth_type === "none" ? "not_required" : "unverified";
  let message = "The API host is reachable, but authentication could not be safely verified.";
  try {
    const safeAction = connection.actions.find((action) => {
      if (!READ_METHODS.has(action.http_method) || (action.input_schema?.required || []).length) return false;
      const identity = `${action.operation_id} ${action.display_name} ${action.path}`;
      return !/(^|[^a-z])(health|status|ping)([^a-z]|$)/i.test(identity);
    });
    let target = addQueryAuthentication(new URL(connection.base_url), connection).toString();
    let options = { method: "HEAD", headers: authHeaders(connection) };
    if (safeAction) {
      const request = buildRequest(safeAction, connection, {});
      target = request.url;
      options = request.options;
    }
    const response = await safeFetch(target, options, fetchImpl);
    if (response.status === 401 || response.status === 403) {
      status = "failed";
      credentialStatus = "invalid";
      message = `Credentials were rejected (HTTP ${response.status}).`;
    } else if (response.status === 429) {
      status = "attention_required";
      message = "The API rate limit blocked the test. Try again later.";
    } else if (response.status >= 500) {
      status = "failed";
      message = `API returned HTTP ${response.status}.`;
    } else if (safeAction && response.ok) {
      status = "passed";
      credentialStatus = connection.auth_type === "none" ? "not_required" : "verified";
      message = `A safe read-only function succeeded (HTTP ${response.status}).`;
    } else {
      message = `The API host responded with HTTP ${response.status}. No read-only operation without required inputs was available, so authentication remains unverified.`;
    }
  } catch (error) {
    status = "failed";
    message = error.message;
  }
  const preserveActive = connection.status === "active" && ["passed", "unverified"].includes(status);
  const updated = await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: {
      last_tested_at: new Date(),
      last_test_status: status,
      last_test_message: message,
      credential_status: credentialStatus,
      last_success_at: status === "passed" ? new Date() : connection.last_success_at,
      wizard_step: preserveActive ? "activate" : status === "passed" || status === "unverified" ? "review" : "test",
      status: preserveActive ? "active" : status === "passed" || status === "unverified" ? "ready_review" : "attention_required"
    }
  });
  return { status, credentialStatus, message, testedAt: updated.last_tested_at };
}

async function markManualVerification({ companyId, connectionId, actor, reason }) {
  const connection = await prisma.integrationConnection.findFirst({ where: { id: connectionId, company_id: companyId } });
  if (!connection) throw new IntegrationError("Connection not found.", 404);
  const message = `Manually verified by a tenant administrator: ${String(reason).trim().slice(0, 300)}`;
  await prisma.integrationConnection.update({ where: { id: connection.id }, data: { credential_status: "manually_verified", last_test_status: "manually_verified", last_test_message: message, last_tested_at: new Date(), wizard_step: "review", status: "ready_review" } });
  await auditTenantChange({ companyId, actor, action: "integration.manual_verification", targetType: "integration_connection", targetId: connection.id, metadata: { reason: String(reason).trim().slice(0, 300) } });
  return { status: "manually_verified", message };
}

async function updateConnectionAdvanced({ companyId, connectionId, actor, baseUrl, apiVersion, behaviorConfig }) {
  const connection = await prisma.integrationConnection.findFirst({ where: { id: connectionId, company_id: companyId } });
  if (!connection) throw new IntegrationError("Connection not found.", 404);
  const parsed = await assertPublicUrl(baseUrl || connection.base_url, "API base URL");
  const input = behaviorConfig || {};
  const behavior = {
    timeoutMs: Math.min(30000, Math.max(1000, Number(input.timeoutMs || 12000))),
    requestsPerMinute: Math.min(120, Math.max(1, Number(input.requestsPerMinute || 30))),
    maxResponseChars: Math.min(100000, Math.max(1000, Number(input.maxResponseChars || MAX_RESULT_CHARS))),
    retryReads: Math.min(2, Math.max(0, Number(input.retryReads || 0)))
  };
  const updated = await prisma.integrationConnection.update({ where: { id: connection.id }, data: { base_url: parsed.toString().replace(/\/$/, ""), api_version: apiVersion || null, behavior_config: behavior } });
  await auditTenantChange({ companyId, actor, action: "integration.advanced_updated", targetType: "integration_connection", targetId: connection.id, metadata: { apiVersion: apiVersion || null, behavior } });
  return updated;
}

async function importConnectionSpec({ companyId, connectionId, actor, baseUrl, specUrl, specText, fetchImpl = fetch }) {
  const connection = await prisma.integrationConnection.findFirst({ where: { id: connectionId, company_id: companyId }, include: { actions: true } });
  if (!connection) throw new IntegrationError("Connection not found.", 404);
  if (connection.actions.length) throw new IntegrationError("This connection already has discovered actions. Create a separate connection before replacing an active definition.", 409);
  const spec = await loadOpenApiDocument({ specUrl, specText, fetchImpl });
  const resolvedBase = String(baseUrl || baseUrlFromSpec(spec)).trim();
  const parsedBase = await assertPublicUrl(resolvedBase, "API base URL");
  const actions = discoverOpenApiActions(spec, connection.name);
  const detected = detectAuthentication(spec);
  const detectedType = AUTH_TYPES.has(detected.type) ? detected.type : "unsupported";
  await prisma.integrationConnection.update({
    where: { id: connection.id },
    data: {
      base_url: parsedBase.toString().replace(/\/$/, ""),
      spec_source_url: specUrl || null,
      openapi_spec: spec,
      connection_type: "rest_openapi",
      discovery_status: detectedType === "unsupported" ? "partial" : "succeeded",
      discovery_message: "OpenAPI definition imported from Advanced Settings.",
      discovery_metadata: { importedManually: true, authenticationLabel: detected.label, authenticationRequired: detected.required },
      auth_type: detectedType,
      auth_config: detected.config || {},
      credential_status: detected.required ? "missing" : "not_required",
      wizard_step: detected.required ? "authenticate" : "test",
      status: "draft",
      actions: { create: actions.map((action) => ({ ...action, company_id: companyId })) }
    }
  });
  await auditTenantChange({ companyId, actor, action: "integration.spec_imported", targetType: "integration_connection", targetId: connection.id, metadata: { actionCount: actions.length } });
  return { actionCount: actions.length, authType: detectedType };
}

/**
 * Refresh an existing connection from its (updated) OpenAPI document without
 * losing setup: actions matched by operation_id keep their id, tool name,
 * enabled flag, Business Engine mappings and blueprints, and get the new
 * fields, descriptions and request mapping. New operations arrive disabled.
 * Operations no longer in the document are disabled, never deleted.
 */
async function refreshConnectionSpec({ companyId, connectionId, actor, specUrl, specText, fetchImpl = fetch }) {
  const connection = await prisma.integrationConnection.findFirst({ where: { id: connectionId, company_id: companyId }, include: { actions: true } });
  if (!connection) throw new IntegrationError("Connection not found.", 404);
  const sourceUrl = String(specUrl || connection.spec_source_url || "").trim();
  if (!sourceUrl && !String(specText || "").trim()) throw new IntegrationError("This connection has no saved OpenAPI URL. Provide the URL or paste the document.");
  const spec = await loadOpenApiDocument({ specUrl: specText ? "" : sourceUrl, specText, fetchImpl });
  const discovered = discoverOpenApiActions(spec, connection.name);
  const byOperation = new Map(connection.actions.map((action) => [action.operation_id, action]));
  const summary = { updated: [], added: [], disabled: [] };
  await prisma.$transaction(async (tx) => {
    for (const action of discovered) {
      const existing = byOperation.get(action.operation_id);
      if (existing) {
        const policy = APPROVAL_RANK[existing.approval_policy] >= APPROVAL_RANK[action.minimum_approval_policy] ? existing.approval_policy : action.minimum_approval_policy;
        await tx.integrationAction.update({
          where: { id: existing.id },
          data: {
            display_name: action.display_name,
            description: action.description,
            http_method: action.http_method,
            path: action.path,
            input_schema: action.input_schema,
            request_config: action.request_config,
            response_schema: action.response_schema === undefined ? existing.response_schema : action.response_schema,
            category: action.category,
            risk_level: action.risk_level,
            minimum_approval_policy: action.minimum_approval_policy,
            approval_policy: policy,
            is_high_impact: action.is_high_impact
          }
        });
        summary.updated.push(action.operation_id);
        byOperation.delete(action.operation_id);
      } else {
        await tx.integrationAction.create({ data: { ...action, company_id: companyId, connection_id: connection.id, enabled: false } });
        summary.added.push(action.operation_id);
      }
    }
    for (const leftover of byOperation.values()) {
      if (leftover.source === "manual") continue;
      await tx.integrationAction.update({ where: { id: leftover.id }, data: { enabled: false } });
      summary.disabled.push(leftover.operation_id);
    }
    await tx.integrationConnection.update({
      where: { id: connection.id },
      data: { openapi_spec: spec, spec_source_url: specText ? connection.spec_source_url : sourceUrl, discovery_message: `OpenAPI definition refreshed ${new Date().toISOString()}.` }
    });
  });
  await auditTenantChange({ companyId, actor, action: "integration.spec_refreshed", targetType: "integration_connection", targetId: connection.id, metadata: summary });
  return summary;
}

async function createManualAction({ companyId, connectionId, actor, operationId, displayName, description, method, path, inputSchema, approvalPolicy }) {
  const connection = await prisma.integrationConnection.findFirst({ where: { id: connectionId, company_id: companyId } });
  if (!connection) throw new IntegrationError("Connection not found.", 404);
  if (!HTTP_METHODS.has(String(method).toLowerCase())) throw new IntegrationError("Choose a supported HTTP method.");
  if (!String(path).startsWith("/") || String(path).startsWith("//")) throw new IntegrationError("Endpoint path must start with one slash and cannot be a full URL.");
  const safeOperationId = slug(operationId || `${method}_${path}`);
  const classification = classifyAction({ operationId: safeOperationId, displayName, description, method: String(method).toUpperCase(), path });
  if (APPROVAL_RANK[approvalPolicy] < APPROVAL_RANK[classification.minimumPolicy]) throw new IntegrationError("The selected approval policy is too permissive for this operation.");
  const schema = inputSchema && typeof inputSchema === "object" ? inputSchema : { type: "object", properties: {}, required: [], additionalProperties: false };
  if (schema.type !== "object" || schema.additionalProperties !== false) throw new IntegrationError("Manual action input must be an object schema with additionalProperties set to false.");
  const action = await prisma.integrationAction.create({ data: {
    company_id: companyId,
    connection_id: connection.id,
    operation_id: safeOperationId.slice(0, 180),
    tool_name: `custom_${slug(connection.name).slice(0, 18)}_${safeOperationId}`.slice(0, 64),
    display_name: String(displayName).trim().slice(0, 120),
    description: String(description || `Call ${method} ${path}`).trim().slice(0, 1000),
    http_method: String(method).toUpperCase(),
    path: String(path).slice(0, 1000),
    input_schema: schema,
    request_config: { mappings: [] },
    enabled: false,
    category: classification.category,
    risk_level: READ_METHODS.has(String(method).toUpperCase()) ? "read" : "write",
    approval_policy: approvalPolicy,
    minimum_approval_policy: classification.minimumPolicy,
    is_high_impact: classification.highImpact,
    source: "manual",
    validated: false
  } });
  await auditTenantChange({ companyId, actor, action: "integration.manual_action_created", targetType: "integration_action", targetId: action.id, metadata: { method: action.http_method, path: action.path } });
  return action;
}

async function setConnectionStatus({ companyId, connectionId, actor, operation }) {
  const connection = await prisma.integrationConnection.findFirst({ where: { id: connectionId, company_id: companyId }, include: { actions: true } });
  if (!connection) throw new IntegrationError("Connection not found.", 404);
  const data = {};
  if (operation === "disable") Object.assign(data, { status: "disabled", disabled_at: new Date() });
  else if (operation === "enable") Object.assign(data, { status: connection.actions.some((action) => action.enabled) ? "active" : "ready_review", disabled_at: null });
  else if (operation === "revoke") Object.assign(data, { status: "attention_required", auth_secret_encrypted: null, credential_status: "missing", credential_updated_at: new Date(), disabled_at: new Date() });
  else throw new IntegrationError("Unsupported connection operation.");
  await prisma.integrationConnection.update({ where: { id: connection.id }, data });
  await auditTenantChange({ companyId, actor, action: `integration.${operation}`, targetType: "integration_connection", targetId: connection.id, metadata: {} });
  return { ok: true };
}

async function listAssignableEngineOperations(companyId) {
  const rows = await prisma.tenantEngineOperation.findMany({
    where: { company_id: companyId, enabled: true, tenant_engine: { enabled: true } },
    include: { definition: true, tenant_engine: { include: { engine: true } }, mapping: true },
    orderBy: { definition: { display_order: "asc" } }
  });
  return rows.map((row) => ({ id: row.id, engineName: row.tenant_engine.engine.name, operationName: row.definition.name, mappedActionId: row.mapping?.integration_action_id || null }));
}

async function assignAction({ companyId, actionId, tenantOperationIds, actor }) {
  const action = await prisma.integrationAction.findFirst({ where: { id: actionId, company_id: companyId, enabled: true } });
  if (!action) throw new IntegrationError("Enable the action before assigning it to a Business Engine.", 409);
  const desired = [...new Set(tenantOperationIds || [])];
  const operations = await prisma.tenantEngineOperation.findMany({ where: { id: { in: desired }, company_id: companyId, enabled: true, tenant_engine: { enabled: true } } });
  if (operations.length !== desired.length) throw new IntegrationError("One or more Business Engine operations are unavailable for this tenant.");
  await prisma.$transaction(async (tx) => {
    await tx.engineOperationMapping.deleteMany({ where: { company_id: companyId, integration_action_id: action.id, tenant_engine_operation_id: { notIn: desired.length ? desired : ["__none__"] } } });
    for (const operation of operations) {
      await tx.engineOperationMapping.upsert({
        where: { tenant_engine_operation_id: operation.id },
        create: { company_id: companyId, tenant_engine_operation_id: operation.id, integration_action_id: action.id, status: "mapped" },
        update: { integration_action_id: action.id, status: "mapped" }
      });
    }
  });
  await auditTenantChange({ companyId, actor, action: "integration.action_assignments_updated", targetType: "integration_action", targetId: action.id, metadata: { assignmentCount: desired.length } });
  return { ok: true };
}

function toolDefinition(action) {
  const policyText = action.approval_policy === "automatic"
    ? "This action runs immediately when called."
    : action.approval_policy === "customer_confirmation"
      ? "First call prepares it. Ask the customer to confirm, then on a later customer turn call it again with the returned _confirmation_id."
      : "This action creates a staff approval request and does not run immediately.";
  const schema = JSON.parse(JSON.stringify(action.input_schema || { type: "object", properties: {} }));
  if (action.approval_policy === "customer_confirmation") {
    schema.properties = schema.properties || {};
    schema.properties._confirmation_id = {
      type: "string",
      description: "Use only after the customer explicitly confirms a pending action from an earlier turn."
    };
  }
  return {
    name: action.tool_name,
    description: `${action.description} ${policyText}`.slice(0, 1200),
    parameters: schema
  };
}

async function toolsForCompany(companyId) {
  const actions = await prisma.integrationAction.findMany({
    where: {
      company_id: companyId,
      enabled: true,
      connection: { status: "active" },
      // Engine-mapped actions are exposed only through their stable logical
      // operation names. This prevents Closer from bypassing engine policy by
      // calling the raw OpenAPI operation directly.
      engine_mappings: { none: {} }
    },
    orderBy: { display_name: "asc" }
  });
  return actions.map(toolDefinition);
}

async function createPendingExecution(action, args, context, status, approvalPolicy = action.approval_policy) {
  const existing = await prisma.integrationExecution.findFirst({
    where: {
      company_id: context.companyId,
      action_id: action.id,
      conversation_id: context.conversationId || null,
      status
    },
    orderBy: { created_at: "desc" }
  });
  if (existing && canonicalJson(existing.requested_arguments) === canonicalJson(args)) return existing;
  return prisma.integrationExecution.create({
    data: {
      company_id: context.companyId,
      connection_id: action.connection_id,
      action_id: action.id,
      conversation_id: context.conversationId || null,
      status,
      approval_policy: approvalPolicy,
      requested_arguments: args,
      requested_by: context.requestedBy || "closer"
    }
  });
}

async function runExecution(execution, action, connection, fetchImpl = fetch) {
  await prisma.integrationExecution.update({ where: { id: execution.id }, data: { status: "running", started_at: new Date() } });
  try {
    enforceExecutionRate(connection);
    const request = buildRequest(action, connection, execution.requested_arguments);
    const behavior = connection.behavior_config || {};
    const attempts = READ_METHODS.has(action.http_method) ? Math.min(3, 1 + Number(behavior.retryReads || 0)) : 1;
    let response;
    let lastError;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      try {
        response = await safeFetch(request.url, { ...request.options, timeoutMs: Math.min(30000, Math.max(1000, Number(behavior.timeoutMs || REQUEST_TIMEOUT_MS))) }, fetchImpl);
        if (response.status < 500 || attempt === attempts - 1) break;
      } catch (error) {
        lastError = error;
        if (attempt === attempts - 1) throw error;
      }
    }
    if (!response) throw lastError || new IntegrationError("The API did not return a response.", 502);
    const raw = await readResponseText(response, Math.min(100000, Math.max(1000, Number(behavior.maxResponseChars || MAX_RESULT_CHARS))));
    let payload = raw;
    try { payload = raw ? JSON.parse(raw) : null; } catch { /* retain text */ }
    const facts = {
      ok: response.ok,
      http_status: response.status,
      action: action.tool_name,
      data: payload
    };
    await prisma.integrationExecution.update({
      where: { id: execution.id },
      data: {
        status: response.ok ? "succeeded" : "failed",
        result: facts,
        error_message: response.ok ? null : `API returned HTTP ${response.status}`,
        completed_at: new Date()
      }
    });
    return facts;
  } catch (error) {
    await prisma.integrationExecution.update({
      where: { id: execution.id },
      data: { status: "failed", error_message: String(error.message).slice(0, 1000), completed_at: new Date() }
    });
    return { ok: false, action: action.tool_name, error: "request_failed", detail: error.message };
  }
}

async function executeCompanyTool({ companyId, conversationId, name, args, turnStartedAt = new Date(), requestedBy = "closer", approvalPolicyOverride = null, fetchImpl = fetch }) {
  const action = await prisma.integrationAction.findFirst({
    where: { company_id: companyId, tool_name: name, enabled: true, connection: { status: "active" } },
    include: { connection: true }
  });
  if (!action) return { ok: false, error: "tool_not_available", tool: name };
  let approvalPolicy = approvalPolicyOverride || action.approval_policy;
  if (APPROVAL_RANK[approvalPolicy] < APPROVAL_RANK[action.minimum_approval_policy || "automatic"]) approvalPolicy = action.minimum_approval_policy;
  if (!APPROVAL_POLICIES.has(approvalPolicy)) return { ok: false, error: "approval_policy_not_executable", tool: name };
  let cleanArgs;
  try {
    cleanArgs = validateArguments(action.input_schema, await require("./scheduling-rules").applyToArgs({ companyId, action, args: args || {} }));
  } catch (error) {
    return { ok: false, error: "invalid_arguments", detail: error.message };
  }

  if (approvalPolicy === "staff_approval") {
    const execution = await createPendingExecution(action, cleanArgs, { companyId, conversationId, requestedBy }, "pending_staff_approval", approvalPolicy);
    return { ok: true, executed: false, requires_staff_approval: true, approval_request_id: execution.id, action: action.display_name };
  }

  if (approvalPolicy === "customer_confirmation") {
    const confirmationId = String(args?._confirmation_id || "").trim();
    if (!confirmationId) {
      const execution = await createPendingExecution(action, cleanArgs, { companyId, conversationId, requestedBy }, "pending_customer_confirmation", approvalPolicy);
      return { ok: true, executed: false, requires_customer_confirmation: true, confirmation_id: execution.id, action: action.display_name, arguments: cleanArgs };
    }
    const pending = await prisma.integrationExecution.findFirst({
      where: {
        id: confirmationId,
        company_id: companyId,
        action_id: action.id,
        conversation_id: conversationId || null,
        status: "pending_customer_confirmation",
        created_at: { lt: turnStartedAt }
      }
    });
    if (!pending || canonicalJson(pending.requested_arguments) !== canonicalJson(cleanArgs)) {
      return { ok: false, executed: false, error: "confirmation_not_valid", detail: "Prepare the action first, then wait for customer confirmation on a later turn." };
    }
    return runExecution(pending, action, action.connection, fetchImpl);
  }

  const execution = await prisma.integrationExecution.create({
    data: {
      company_id: companyId,
      connection_id: action.connection_id,
      action_id: action.id,
      conversation_id: conversationId || null,
      status: "queued",
      approval_policy: approvalPolicy,
      requested_arguments: cleanArgs,
      requested_by: requestedBy
    }
  });
  return runExecution(execution, action, action.connection, fetchImpl);
}

/**
 * Blueprint write sequence (see src/engine-blueprint.js). These bypass the
 * per-call policy check ONLY in two platform-safe ways:
 *  - a dry run, which the API contract defines as side-effect free; and
 *  - committing a pending execution the customer confirmed on a later turn.
 * The committed arguments are the ones stored at confirmation time, so the
 * model cannot change them between the summary and the commit.
 */
async function runBlueprintDryRun({ companyId, conversationId, action, args, dryRunField, requestedBy = "closer" }) {
  const scheduledArgs = await require("./scheduling-rules").applyToArgs({ companyId, action, args });
  const dryArgs = validateArguments(action.input_schema, { ...scheduledArgs, [dryRunField]: true });
  const execution = await prisma.integrationExecution.create({
    data: {
      company_id: companyId,
      connection_id: action.connection_id,
      action_id: action.id,
      conversation_id: conversationId || null,
      status: "queued",
      approval_policy: "automatic",
      requested_arguments: dryArgs,
      requested_by: `${requestedBy}:dry_run`
    }
  });
  return runExecution(execution, action, action.connection);
}

async function prepareBlueprintConfirmation({ companyId, conversationId, action, args, idempotencyField, requestedBy = "closer" }) {
  const commitArgs = { ...(await require("./scheduling-rules").applyToArgs({ companyId, action, args })) };
  if (idempotencyField) commitArgs[idempotencyField] = `aistaff-${crypto.randomUUID()}`;
  const clean = validateArguments(action.input_schema, commitArgs);
  await prisma.integrationExecution.updateMany({
    where: { company_id: companyId, action_id: action.id, conversation_id: conversationId || null, status: "pending_customer_confirmation" },
    data: { status: "superseded", completed_at: new Date() }
  });
  return prisma.integrationExecution.create({
    data: {
      company_id: companyId,
      connection_id: action.connection_id,
      action_id: action.id,
      conversation_id: conversationId || null,
      status: "pending_customer_confirmation",
      approval_policy: "customer_confirmation",
      requested_arguments: clean,
      requested_by: requestedBy
    }
  });
}

/** Staff resolve loop: staff confirmed the collected details are right and asked to save again. */
async function runStaffCommit({ companyId, conversationId, action, args, idempotencyField, actor }) {
  const commitArgs = { ...(await require("./scheduling-rules").applyToArgs({ companyId, action, args })) };
  if (idempotencyField) commitArgs[idempotencyField] = `aistaff-${crypto.randomUUID()}`;
  const clean = validateArguments(action.input_schema, commitArgs);
  const execution = await prisma.integrationExecution.create({
    data: {
      company_id: companyId,
      connection_id: action.connection_id,
      action_id: action.id,
      conversation_id: conversationId || null,
      status: "queued",
      approval_policy: "staff_approval",
      requested_arguments: clean,
      requested_by: `staff_retry:${String(actor || "staff").slice(0, 120)}`
    }
  });
  return runExecution(execution, action, action.connection);
}

async function commitBlueprintConfirmation({ companyId, conversationId, action, confirmationId, turnStartedAt = new Date() }) {
  const pending = await prisma.integrationExecution.findFirst({
    where: {
      id: String(confirmationId || ""),
      company_id: companyId,
      action_id: action.id,
      conversation_id: conversationId || null,
      status: "pending_customer_confirmation",
      created_at: { lt: turnStartedAt }
    }
  });
  if (!pending) return { ok: false, executed: false, error: "confirmation_not_valid", detail: "No matching summary is waiting for this customer confirmation, or it was prepared in this same turn. Prepare the request again and wait for the customer to confirm on their next message." };
  return runExecution(pending, action, action.connection);
}

async function testIntegrationAction({ companyId, actionId, actor, args, confirmLiveWrite = false, acknowledgeHighImpact = false, fetchImpl = fetch }) {
  const action = await prisma.integrationAction.findFirst({
    where: {
      id: actionId,
      company_id: companyId,
      enabled: true,
      connection: { status: "active" }
    },
    include: { connection: true }
  });
  if (!action) throw new IntegrationError("This action is not available for testing.", 404, "ACTION_NOT_AVAILABLE");

  const cleanArgs = validateArguments(action.input_schema, args || {});
  const changesData = !READ_METHODS.has(action.http_method);
  if (changesData && !confirmLiveWrite) {
    throw new IntegrationError(
      "Confirm that this test will create or change real data before running it.",
      409,
      "LIVE_WRITE_CONFIRMATION_REQUIRED"
    );
  }
  if (action.is_high_impact && !acknowledgeHighImpact) {
    throw new IntegrationError(
      "Confirm that this high-impact test may delete data or send a real message before running it.",
      409,
      "HIGH_IMPACT_TEST_CONFIRMATION_REQUIRED"
    );
  }

  const execution = await prisma.integrationExecution.create({
    data: {
      company_id: companyId,
      connection_id: action.connection_id,
      action_id: action.id,
      conversation_id: null,
      status: "queued",
      approval_policy: action.approval_policy,
      requested_arguments: cleanArgs,
      requested_by: "manual_admin_test",
      approved_by: changesData ? actor?.email || null : null,
      approved_at: changesData ? new Date() : null
    }
  });
  const result = await runExecution(execution, action, action.connection, fetchImpl);
  try {
    await auditTenantChange({
      companyId,
      actor,
      action: "integration.action_tested",
      targetType: "integration_action",
      targetId: action.id,
      metadata: {
        executionId: execution.id,
        method: action.http_method,
        changedData: changesData,
        ok: Boolean(result.ok),
        httpStatus: result.http_status || null
      }
    });
  } catch (error) {
    console.error("[integrations] manual action test audit failed", error.message);
  }
  return { ...result, executionId: execution.id, requestedBy: "manual_admin_test" };
}

async function pendingContext(companyId, conversationId) {
  if (!conversationId) return [];
  const rows = await prisma.integrationExecution.findMany({
    where: {
      company_id: companyId,
      conversation_id: conversationId,
      status: { in: ["pending_customer_confirmation", "pending_staff_approval"] }
    },
    include: { action: { select: { tool_name: true, display_name: true } } },
    orderBy: { created_at: "desc" },
    take: 10
  });
  return rows.map((row) => ({
    id: row.id,
    status: row.status,
    toolName: row.action.tool_name,
    action: row.action.display_name,
    arguments: row.requested_arguments,
    createdAt: row.created_at
  }));
}

async function listExecutions(companyId, take = 40) {
  const rows = await prisma.integrationExecution.findMany({
    where: { company_id: companyId },
    include: {
      action: { select: { display_name: true, tool_name: true, http_method: true, path: true } },
      connection: { select: { name: true } }
    },
    orderBy: { created_at: "desc" },
    take
  });
  return rows.map((row) => ({
    id: row.id,
    connectionName: row.connection.name,
    actionName: row.action.display_name,
    toolName: row.action.tool_name,
    method: row.action.http_method,
    path: row.action.path,
    status: row.status,
    approvalPolicy: row.approval_policy,
    argumentFields: Object.keys(row.requested_arguments || {}),
    resultSummary: row.result && typeof row.result === "object" ? { ok: row.result.ok, httpStatus: row.result.http_status } : null,
    error: row.error_message ? String(row.error_message).slice(0, 240) : null,
    requestedBy: row.requested_by,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    completedAt: row.completed_at
  }));
}

function maskedExecutionValue(value, key = "") {
  if (/email/i.test(key) && typeof value === "string") return value.replace(/^(.{1,2}).*(@.*)$/, "$1***$2");
  if (/phone|mobile|contact/i.test(key) && typeof value === "string") return value.length > 4 ? `***${value.slice(-4)}` : "***";
  if (/secret|token|password|authorization|api.?key/i.test(key)) return "[redacted]";
  if (Array.isArray(value)) return value.slice(0, 20).map((item) => maskedExecutionValue(item));
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).slice(0, 50).map(([childKey, child]) => [childKey, maskedExecutionValue(child, childKey)]));
  if (typeof value === "string") return value.length > 200 ? `${value.slice(0, 200)}…` : value;
  return value;
}

async function getExecutionDetail(companyId, executionId) {
  const row = await prisma.integrationExecution.findFirst({
    where: { id: executionId, company_id: companyId },
    include: { action: { select: { display_name: true, http_method: true, path: true } }, connection: { select: { name: true } } }
  });
  if (!row) throw new IntegrationError("Action history item not found.", 404);
  return {
    id: row.id,
    connectionName: row.connection.name,
    actionName: row.action.display_name,
    method: row.action.http_method,
    path: row.action.path,
    status: row.status,
    approvalPolicy: row.approval_policy,
    arguments: maskedExecutionValue(row.requested_arguments),
    result: maskedExecutionValue(row.result),
    error: row.error_message ? String(row.error_message).slice(0, 1000) : null,
    requestedBy: row.requested_by,
    approvedBy: row.approved_by,
    createdAt: row.created_at,
    completedAt: row.completed_at
  };
}

async function approveExecution({ companyId, executionId, actorEmail, fetchImpl = fetch }) {
  const execution = await prisma.integrationExecution.findFirst({
    where: { id: executionId, company_id: companyId, status: "pending_staff_approval" },
    include: { action: true, connection: true }
  });
  if (!execution) throw new IntegrationError("Pending approval request not found.", 404);
  await prisma.integrationExecution.update({
    where: { id: execution.id },
    data: { approved_by: actorEmail || null, approved_at: new Date() }
  });
  return runExecution(execution, execution.action, execution.connection, fetchImpl);
}

module.exports = {
  runStaffCommit,
  AUTH_TYPES,
  APPROVAL_POLICIES,
  IntegrationError,
  assertPublicUrl,
  safeFetch,
  loadOpenApiDocument,
  discoverOpenApiActions,
  applicationNameFromHost,
  createConnection,
  listConnections,
  updateAction,
  testConnection,
  toolsForCompany,
  executeCompanyTool,
  testIntegrationAction,
  pendingContext,
  listExecutions,
  approveExecution,
  discoverConnection,
  retryConnectionDiscovery,
  updateConnectionAuth,
  startOAuth,
  completeOAuth,
  markManualVerification,
  updateConnectionAdvanced,
  importConnectionSpec,
  createManualAction,
  setConnectionStatus,
  listAssignableEngineOperations,
  assignAction,
  getExecutionDetail,
  auditTenantChange,
  publicConnection,
  validateArguments,
  buildRequest,
  refreshConnectionSpec,
  runBlueprintDryRun,
  prepareBlueprintConfirmation,
  commitBlueprintConfirmation
};
