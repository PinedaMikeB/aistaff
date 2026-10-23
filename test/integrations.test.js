const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { prisma } = require("../src/db");
const {
  IntegrationError,
  assertPublicUrl,
  discoverOpenApiActions,
  applicationNameFromHost,
  validateArguments,
  buildRequest,
  executeCompanyTool,
  testIntegrationAction
} = require("../src/integrations");
const {
  parseApiDocument,
  detectAuthentication,
  discoverApplication,
  sameOriginDocLinks
} = require("../src/integration-discovery");

const SPEC = {
  openapi: "3.0.3",
  servers: [{ url: "https://tenant.example.com/api" }],
  components: {
    schemas: {
      Ticket: {
        type: "object",
        required: ["subject", "customer_email"],
        properties: {
          subject: { type: "string", description: "Ticket subject" },
          customer_email: { type: "string", format: "email" },
          priority: { type: "string", enum: ["normal", "urgent"] }
        }
      }
    }
  },
  paths: {
    "/tickets/{ticketId}": {
      get: {
        operationId: "getTicket",
        summary: "Get ticket",
        parameters: [{ name: "ticketId", in: "path", required: true, schema: { type: "string" } }]
      }
    },
    "/tickets": {
      post: {
        operationId: "createTicket",
        summary: "Create ticket",
        requestBody: {
          required: true,
          content: { "application/json": { schema: { $ref: "#/components/schemas/Ticket" } } }
        }
      }
    }
  }
};

test("connection names are derived from the website host", () => {
  assert.equal(applicationNameFromHost("api.marga.com.ph"), "Marga");
  assert.equal(applicationNameFromHost("docs.charlotte-crm.io"), "Charlotte Crm");
});

test("OpenAPI discovery creates tenant-namespaced read and write actions", () => {
  const actions = discoverOpenApiActions(SPEC, "Charlotte CRM");
  assert.equal(actions.length, 2);
  const read = actions.find((action) => action.operation_id === "getTicket");
  const write = actions.find((action) => action.operation_id === "createTicket");
  assert.equal(read.tool_name, "custom_charlotte_crm_getticket");
  assert.equal(read.risk_level, "read");
  assert.equal(read.approval_policy, "automatic");
  assert.deepEqual(read.input_schema.required, ["ticketid"]);
  assert.equal(write.risk_level, "write");
  assert.equal(write.category, "create");
  assert.equal(write.approval_policy, "customer_confirmation");
  assert.equal(write.minimum_approval_policy, "customer_confirmation");
  assert.deepEqual(write.input_schema.required.sort(), ["customer_email", "subject"]);
  assert.equal(write.input_schema.properties.priority.enum[1], "urgent");
});

test("OpenAPI YAML is parsed with aliases bounded", () => {
  const yaml = `openapi: 3.0.3\nservers:\n  - url: https://api.example.com\npaths:\n  /health:\n    get:\n      operationId: health\n      responses:\n        '200':\n          description: ok\n`;
  const spec = parseApiDocument(yaml);
  assert.equal(spec.openapi, "3.0.3");
  assert.ok(spec.paths["/health"]);
});

test("authentication detection supports API key query, bearer, basic, and OAuth PKCE", () => {
  assert.equal(detectAuthentication({ components: { securitySchemes: { key: { type: "apiKey", in: "query", name: "access_key" } } } }).type, "api_key_query");
  assert.equal(detectAuthentication({ components: { securitySchemes: { auth: { type: "http", scheme: "bearer" } } } }).type, "bearer");
  assert.equal(detectAuthentication({ components: { securitySchemes: { auth: { type: "http", scheme: "basic" } } } }).type, "basic");
  const oauth = detectAuthentication({ components: { securitySchemes: { oauth: { type: "oauth2", flows: { authorizationCode: { authorizationUrl: "https://id.example.com/auth", tokenUrl: "https://id.example.com/token", scopes: { tickets: "Tickets" } } } } } } });
  assert.equal(oauth.type, "oauth2_pkce");
  assert.equal(oauth.config.authorizationUrl, "https://id.example.com/auth");
});

test("documentation discovery follows only same-origin public spec references", () => {
  const links = sameOriginDocLinks('<a href="/openapi.yaml">API</a><a href="https://evil.example/openapi.json">bad</a>', "https://app.example.com/docs");
  assert.deepEqual(links, ["https://app.example.com/openapi.yaml"]);
});

test("smart discovery checks known paths and reports failure without inventing endpoints", async () => {
  const attempted = [];
  const safeFetchMock = async (url) => {
    attempted.push(url);
    return new Response("not found", { status: 404, headers: { "content-type": "text/plain" } });
  };
  const result = await discoverApplication({ sourceUrl: "https://app.example.com", safeFetch: safeFetchMock, fetchImpl: safeFetchMock });
  assert.equal(result.status, "failed");
  assert.equal(result.spec, null);
  assert.ok(attempted.some((url) => url.endsWith("/openapi.json")));
  assert.match(result.message, /could not find/i);
});

test("destructive and outbound communication actions require staff approval", () => {
  const spec = {
    openapi: "3.0.3",
    paths: {
      "/customers/{id}": { delete: { operationId: "deleteCustomer", summary: "Delete customer" } },
      "/email": { post: { operationId: "sendEmail", summary: "Send email to customer" } }
    }
  };
  const actions = discoverOpenApiActions(spec, "CRM");
  assert.ok(actions.every((action) => action.is_high_impact));
  assert.ok(actions.every((action) => action.minimum_approval_policy === "staff_approval"));
});

test("dynamic action validation rejects missing and invented fields", () => {
  const write = discoverOpenApiActions(SPEC, "Charlotte CRM").find((action) => action.operation_id === "createTicket");
  assert.throws(
    () => validateArguments(write.input_schema, { subject: "Printer issue" }),
    /customer_email.*required/i
  );
  assert.throws(
    () => validateArguments(write.input_schema, { subject: "Printer issue", customer_email: "a@example.com", admin: true }),
    /admin.*not allowed/i
  );
  assert.deepEqual(
    validateArguments(write.input_schema, { subject: "Printer issue", customer_email: "a@example.com", priority: "urgent" }),
    { subject: "Printer issue", customer_email: "a@example.com", priority: "urgent" }
  );
});

test("request mapping encodes path values and builds JSON bodies", () => {
  const actions = discoverOpenApiActions(SPEC, "Charlotte CRM");
  const read = actions.find((action) => action.operation_id === "getTicket");
  const write = actions.find((action) => action.operation_id === "createTicket");
  const connection = { base_url: "https://tenant.example.com/api", auth_type: "none", auth_config: {} };
  const readRequest = buildRequest(read, connection, { ticketid: "ABC/123" });
  assert.equal(readRequest.url, "https://tenant.example.com/api/tickets/ABC%2F123");
  const writeRequest = buildRequest(write, connection, { subject: "Help", customer_email: "a@example.com" });
  assert.equal(writeRequest.options.method, "POST");
  assert.equal(writeRequest.options.headers["Content-Type"], "application/json");
  assert.equal(writeRequest.options.body, JSON.stringify({ subject: "Help", customer_email: "a@example.com" }));
});

test("connection URLs reject private network targets", async () => {
  await assert.rejects(() => assertPublicUrl("https://127.0.0.1/openapi.json"), IntegrationError);
  await assert.rejects(() => assertPublicUrl("https://192.168.1.20/api"), /private network/i);
  await assert.rejects(() => assertPublicUrl("https://localhost/api"), /local or private/i);
});

test("customer-confirmed actions create a pending request instead of executing immediately", async (t) => {
  const originalActionFind = prisma.integrationAction.findFirst;
  const originalExecutionFind = prisma.integrationExecution.findFirst;
  const originalExecutionCreate = prisma.integrationExecution.create;
  t.after(() => {
    prisma.integrationAction.findFirst = originalActionFind;
    prisma.integrationExecution.findFirst = originalExecutionFind;
    prisma.integrationExecution.create = originalExecutionCreate;
  });
  const action = {
    id: "action-1",
    company_id: "company-1",
    connection_id: "connection-1",
    tool_name: "custom_crm_create_ticket",
    display_name: "Create ticket",
    approval_policy: "customer_confirmation",
    input_schema: {
      type: "object",
      properties: { subject: { type: "string" } },
      required: ["subject"]
    },
    connection: { id: "connection-1", base_url: "https://93.184.216.34", auth_type: "none", auth_config: {} }
  };
  prisma.integrationAction.findFirst = async () => action;
  prisma.integrationExecution.findFirst = async () => null;
  prisma.integrationExecution.create = async ({ data }) => ({ id: "pending-1", ...data, created_at: new Date() });
  const result = await executeCompanyTool({
    companyId: "company-1",
    conversationId: "conversation-1",
    name: action.tool_name,
    args: { subject: "Printer is offline" },
    turnStartedAt: new Date()
  });
  assert.equal(result.executed, false);
  assert.equal(result.requires_customer_confirmation, true);
  assert.equal(result.confirmation_id, "pending-1");
});

test("manual admin action tests use the live executor and create an auditable execution", async (t) => {
  const originalActionFind = prisma.integrationAction.findFirst;
  const originalExecutionCreate = prisma.integrationExecution.create;
  const originalExecutionUpdate = prisma.integrationExecution.update;
  const originalAuditCreate = prisma.tenantAuditLog.create;
  t.after(() => {
    prisma.integrationAction.findFirst = originalActionFind;
    prisma.integrationExecution.create = originalExecutionCreate;
    prisma.integrationExecution.update = originalExecutionUpdate;
    prisma.tenantAuditLog.create = originalAuditCreate;
  });
  const action = {
    id: "action-find-machine",
    company_id: "company-1",
    connection_id: "connection-1",
    tool_name: "custom_marga_find_machine",
    display_name: "Find machine",
    description: "Find a machine by serial number",
    http_method: "GET",
    path: "/machines/search",
    enabled: true,
    approval_policy: "automatic",
    minimum_approval_policy: "automatic",
    input_schema: { type: "object", properties: { serialnumber: { type: "string" } }, required: ["serialnumber"], additionalProperties: false },
    request_config: { mappings: [{ argName: "serialnumber", apiName: "serial", location: "query" }] },
    connection: { id: "connection-1", base_url: "https://93.184.216.34", auth_type: "none", auth_config: {}, behavior_config: {} }
  };
  const created = [];
  const updates = [];
  const audits = [];
  prisma.integrationAction.findFirst = async () => action;
  prisma.integrationExecution.create = async ({ data }) => { created.push(data); return { id: "execution-1", ...data }; };
  prisma.integrationExecution.update = async ({ data }) => { updates.push(data); return { id: "execution-1", ...data }; };
  prisma.tenantAuditLog.create = async ({ data }) => { audits.push(data); return data; };

  const result = await testIntegrationAction({
    companyId: "company-1",
    actionId: action.id,
    actor: { id: "admin-1", email: "admin@example.com" },
    args: { serialnumber: "X8H5507464" },
    fetchImpl: async (url) => new Response(JSON.stringify({ serial: new URL(url).searchParams.get("serial"), model: "Test model" }), { status: 200, headers: { "content-type": "application/json" } })
  });

  assert.equal(result.ok, true);
  assert.equal(result.executionId, "execution-1");
  assert.equal(result.data.serial, "X8H5507464");
  assert.equal(created[0].requested_by, "manual_admin_test");
  assert.ok(updates.some((data) => data.status === "succeeded"));
  assert.equal(audits[0].action, "integration.action_tested");
});

test("manual admin write tests require explicit live-data confirmation", async (t) => {
  const originalActionFind = prisma.integrationAction.findFirst;
  t.after(() => { prisma.integrationAction.findFirst = originalActionFind; });
  prisma.integrationAction.findFirst = async () => ({
    id: "action-create-ticket",
    company_id: "company-1",
    connection_id: "connection-1",
    tool_name: "custom_marga_create_ticket",
    display_name: "Create ticket",
    http_method: "POST",
    path: "/tickets",
    enabled: true,
    approval_policy: "customer_confirmation",
    is_high_impact: true,
    input_schema: { type: "object", properties: { subject: { type: "string" } }, required: ["subject"], additionalProperties: false },
    request_config: { mappings: [{ argName: "subject", apiName: "subject", location: "body" }] },
    connection: { id: "connection-1", base_url: "https://93.184.216.34", auth_type: "none", auth_config: {}, behavior_config: {} }
  });
  await assert.rejects(
    () => testIntegrationAction({ companyId: "company-1", actionId: "action-create-ticket", actor: { email: "admin@example.com" }, args: { subject: "Test" } }),
    /create or change real data/i
  );
  await assert.rejects(
    () => testIntegrationAction({ companyId: "company-1", actionId: "action-create-ticket", actor: { email: "admin@example.com" }, args: { subject: "Test" }, confirmLiveWrite: true }),
    /delete data or send a real message/i
  );
});

test("the admin shell loads the tenant connections tab implementation", () => {
  const root = path.join(__dirname, "..");
  const appSource = fs.readFileSync(path.join(root, "public", "app.js"), "utf8");
  const shell = fs.readFileSync(path.join(root, "public", "index.html"), "utf8");
  const integrationUi = fs.readFileSync(path.join(root, "public", "integrations-settings.js"), "utf8");
  const integrationRoutes = fs.readFileSync(path.join(root, "src", "routes", "integrations.js"), "utf8");
  assert.match(appSource, /\["connections-actions", "Connections & Actions"\]/);
  assert.match(shell, /src="\/integrations-settings\.js(?:\?[^\"]+)?"/);
  assert.match(integrationUi, /Website or API guide/);
  assert.doesNotMatch(integrationUi, /Application name/);
  assert.match(integrationUi, /Open advanced setup/);
  assert.match(integrationUi, /Try another URL/);
  assert.match(integrationUi, /currentStepView\(connection, engineOperations\)/);
  assert.doesNotMatch(integrationUi, /discoveryStep\(connection\), authenticationStep\(connection\), testStep/);
  assert.match(integrationRoutes, /router\.post\("\/:connectionId\/discover"/);
  assert.match(integrationRoutes, /router\.post\("\/actions\/:actionId\/test"/);
  assert.match(integrationUi, /Test available actions/);
  assert.match(integrationUi, /data-action-test-form/);
  assert.match(integrationUi, /Approve &amp; run/);
});

test("a successful connection test preserves an already active connection", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "integrations.js"), "utf8");
  assert.match(source, /preserveActive = connection\.status === "active"/);
  assert.match(source, /status: preserveActive \? "active"/);
  assert.match(source, /wizard_step: preserveActive \? "activate"/);
});

test("API-key tests use the configured header and do not verify against public health endpoints", () => {
  const source = fs.readFileSync(path.join(__dirname, "..", "src", "integrations.js"), "utf8");
  assert.match(source, /config\.parameterName \|\| config\.headerName \|\| "X-API-Key"/);
  assert.match(source, /health\|status\|ping/);
  assert.match(source, /const safeAction = connection\.actions\.find/);
});
