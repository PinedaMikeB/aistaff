const YAML = require("yaml");

const MAX_SPEC_BYTES = 1024 * 1024;
const MAX_HTML_BYTES = 512 * 1024;
const MAX_CANDIDATES = 14;
const WELL_KNOWN_PATHS = [
  "/.well-known/openapi.json",
  "/openapi.json",
  "/openapi.yaml",
  "/openapi.yml",
  "/swagger.json",
  "/swagger/v1/swagger.json",
  "/api/openapi.json",
  "/v3/api-docs",
  "/api-docs"
];

function isOpenApi(value) {
  return Boolean(value && typeof value === "object" && (value.openapi || value.swagger) && value.paths && typeof value.paths === "object");
}

function parseApiDocument(raw, contentType = "") {
  if (Buffer.byteLength(raw, "utf8") > MAX_SPEC_BYTES) throw new Error("API document must be 1 MB or smaller.");
  let document;
  try {
    document = JSON.parse(raw);
  } catch {
    try {
      document = YAML.parse(raw, { maxAliasCount: 20, prettyErrors: false });
    } catch {
      throw new Error("The document is not valid OpenAPI JSON or YAML.");
    }
  }
  if (!isOpenApi(document)) throw new Error("The document does not contain a usable OpenAPI definition.");
  return document;
}

async function boundedText(response, limit) {
  const length = Number(response.headers.get("content-length") || 0);
  if (length > limit) throw new Error("The discovery response is too large.");
  const raw = await response.text();
  if (Buffer.byteLength(raw, "utf8") > limit) throw new Error("The discovery response is too large.");
  return raw;
}

function sameOriginDocLinks(html, baseUrl) {
  const origin = new URL(baseUrl).origin;
  const links = new Set();
  const patterns = [
    /(?:href|src)\s*=\s*["']([^"']+)["']/gi,
    /(?:url|spec|definition|openapi|swagger)["']?\s*[:=]\s*["']([^"']+)["']/gi
  ];
  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html)) && links.size < 5) {
      if (!/(openapi|swagger|api-docs|v3\/api)/i.test(match[1])) continue;
      try {
        const candidate = new URL(match[1], baseUrl);
        if (candidate.origin === origin && candidate.protocol === "https:") links.add(candidate.toString());
      } catch { /* ignore malformed public documentation references */ }
    }
  }
  return [...links];
}

function securitySchemes(spec) {
  return spec.components?.securitySchemes || spec.securityDefinitions || {};
}

function detectAuthentication(spec) {
  const schemes = securitySchemes(spec);
  const entries = Object.entries(schemes);
  if (!entries.length) return { type: "none", label: "No authentication documented", required: false, config: {} };
  for (const [name, scheme] of entries) {
    if (scheme?.type === "apiKey") {
      return {
        type: scheme.in === "query" ? "api_key_query" : "api_key_header",
        label: scheme.in === "query" ? "API key in query parameter" : "API key",
        required: true,
        config: { schemeName: name, parameterName: scheme.name || (scheme.in === "query" ? "api_key" : "X-API-Key") }
      };
    }
    if (scheme?.type === "http" && String(scheme.scheme).toLowerCase() === "bearer") {
      return { type: "bearer", label: "Bearer token", required: true, config: { schemeName: name } };
    }
    if (scheme?.type === "http" && String(scheme.scheme).toLowerCase() === "basic") {
      return { type: "basic", label: "Username and password", required: true, config: { schemeName: name } };
    }
    if (scheme?.type === "oauth2") {
      const flow = scheme.flows?.authorizationCode;
      if (flow?.authorizationUrl && flow?.tokenUrl) {
        return {
          type: "oauth2_pkce",
          label: "OAuth 2.0 authorization",
          required: true,
          config: {
            schemeName: name,
            authorizationUrl: flow.authorizationUrl,
            tokenUrl: flow.tokenUrl,
            availableScopes: flow.scopes || {}
          }
        };
      }
      return { type: "unsupported", label: "OAuth 2.0 (unsupported flow)", required: true, config: { schemeName: name } };
    }
  }
  return { type: "unsupported", label: "Authentication needs manual setup", required: true, config: {} };
}

function serverUrl(spec, sourceUrl) {
  const raw = spec.servers?.[0]?.url
    || (spec.swagger === "2.0" && spec.host ? `${spec.schemes?.[0] || "https"}://${spec.host}${spec.basePath || ""}` : "")
    || new URL(sourceUrl).origin;
  return new URL(raw, sourceUrl).toString().replace(/\/$/, "");
}

async function attemptDocument(url, safeFetch, fetchImpl) {
  const response = await safeFetch(url, {
    method: "GET",
    headers: { Accept: "application/json, application/yaml, text/yaml, application/vnd.oai.openapi+json, text/html;q=0.5" }
  }, fetchImpl);
  if (!response.ok) return { kind: "miss", status: response.status };
  const contentType = String(response.headers.get("content-type") || "").toLowerCase();
  if (contentType.includes("text/html")) {
    return { kind: "html", html: await boundedText(response, MAX_HTML_BYTES), finalUrl: response.url || url };
  }
  if (contentType && !/(json|yaml|yml|text\/plain|octet-stream)/i.test(contentType)) {
    return { kind: "miss", status: response.status };
  }
  const raw = await boundedText(response, MAX_SPEC_BYTES);
  try {
    return { kind: "spec", spec: parseApiDocument(raw, contentType), finalUrl: response.url || url };
  } catch {
    return { kind: "miss", status: response.status };
  }
}

async function discoverApplication({ sourceUrl, safeFetch, fetchImpl }) {
  const submitted = new URL(sourceUrl);
  const candidates = [submitted.toString()];
  const attempted = [];
  let htmlResult = null;
  for (const path of WELL_KNOWN_PATHS) candidates.push(new URL(path, submitted.origin).toString());
  for (let index = 0; index < candidates.length && attempted.length < MAX_CANDIDATES; index += 1) {
    const candidate = candidates[index];
    if (attempted.includes(candidate)) continue;
    attempted.push(candidate);
    try {
      const result = await attemptDocument(candidate, safeFetch, fetchImpl);
      if (result.kind === "spec") {
        const auth = detectAuthentication(result.spec);
        return {
          status: auth.type === "unsupported" ? "partial" : "succeeded",
          message: auth.type === "unsupported"
            ? "The API was found, but its authentication method needs Advanced Settings."
            : "API documentation and available functions were found.",
          spec: result.spec,
          specUrl: result.finalUrl || candidate,
          baseUrl: serverUrl(result.spec, result.finalUrl || candidate),
          auth,
          attempted
        };
      }
      if (result.kind === "html" && !htmlResult) htmlResult = result;
    } catch { /* a missing candidate is expected; continue within the safe origin */ }
  }
  if (htmlResult) {
    for (const candidate of sameOriginDocLinks(htmlResult.html, htmlResult.finalUrl).slice(0, 5)) {
      if (attempted.includes(candidate) || attempted.length >= MAX_CANDIDATES) continue;
      attempted.push(candidate);
      try {
        const result = await attemptDocument(candidate, safeFetch, fetchImpl);
        if (result.kind === "spec") {
          const auth = detectAuthentication(result.spec);
          return {
            status: auth.type === "unsupported" ? "partial" : "succeeded",
            message: "API documentation was found from the application's public documentation page.",
            spec: result.spec,
            specUrl: result.finalUrl || candidate,
            baseUrl: serverUrl(result.spec, result.finalUrl || candidate),
            auth,
            attempted
          };
        }
      } catch { /* continue */ }
    }
  }
  return {
    status: "failed",
    message: "AIStaff could not find a public OpenAPI document. The application may not offer an API, may require sign-in, or may need manual setup in Advanced Settings.",
    spec: null,
    specUrl: null,
    baseUrl: submitted.origin,
    auth: { type: "none", label: "Not detected", required: false, config: {} },
    attempted
  };
}

module.exports = {
  MAX_SPEC_BYTES,
  parseApiDocument,
  detectAuthentication,
  discoverApplication,
  sameOriginDocLinks,
  serverUrl
};
