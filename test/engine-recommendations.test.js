const test = require("node:test");
const assert = require("node:assert/strict");
const { recommendEngineSetup, suggestFieldMapping } = require("../src/engine-recommendations");

function action(overrides) {
  return {
    id: overrides.operationId,
    displayName: overrides.displayName,
    operationId: overrides.operationId,
    description: overrides.description || overrides.displayName,
    method: overrides.method || "GET",
    path: overrides.path || "/",
    category: overrides.category || "read",
    approvalPolicy: overrides.approvalPolicy || "automatic",
    minimumPolicy: overrides.minimumPolicy || "automatic",
    inputSchema: overrides.inputSchema || { type: "object", properties: {}, required: [], additionalProperties: false }
  };
}

const engine = {
  key: "customer_service",
  fields: [
    { key: "customer_id", label: "Customer ID", enabled: true },
    { key: "customer_name", label: "Customer name", enabled: true },
    { key: "machine_id", label: "Machine ID", enabled: true },
    { key: "serial_number", label: "Serial number", enabled: true },
    { key: "service_reference", label: "Service reference", enabled: true },
    { key: "description", label: "Description", enabled: true }
  ],
  operations: [
    { key: "find_customer", name: "Find Customer", description: "Find customer", type: "read", requiredFields: ["customer_name"], policy: "automatic" },
    { key: "find_machine", name: "Find Machine", description: "Find machine by serial number", type: "read", requiredFields: ["serial_number"], policy: "automatic" },
    { key: "get_customer", name: "Get Customer", description: "Retrieve customer and branches", type: "read", requiredFields: ["customer_id"], policy: "automatic" },
    { key: "create_service_request", name: "Create Service Request", description: "Create a service ticket", type: "write", requiredFields: ["customer_id", "description"], policy: "customer_confirmation" }
  ]
};

const searchCustomers = action({
  displayName: "Search customer accounts",
  operationId: "searchCustomers",
  path: "/customers/search",
  inputSchema: { type: "object", required: ["q"], properties: { q: { type: "string" } }, additionalProperties: false }
});
const getCustomer = action({
  displayName: "Retrieve a customer and branches",
  operationId: "getCustomer",
  path: "/customers/{customerId}",
  inputSchema: { type: "object", required: ["customerid"], properties: { customerid: { type: "integer" } }, additionalProperties: false }
});
const createTicket = action({
  displayName: "Create a service ticket",
  operationId: "createServiceTicket",
  method: "POST",
  path: "/service-tickets",
  category: "create",
  approvalPolicy: "customer_confirmation",
  minimumPolicy: "customer_confirmation",
  inputSchema: {
    type: "object",
    required: ["customerid", "description", "workflowstatusid"],
    properties: { customerid: { type: "integer" }, description: { type: "string" }, workflowstatusid: { type: "integer" } },
    additionalProperties: false
  }
});

test("generic search input is matched to the operation's required customer field", () => {
  const result = suggestFieldMapping(engine, searchCustomers, engine.operations[0]);
  assert.deepEqual(result.fieldMapping, { customer_name: "q" });
  assert.deepEqual(result.unresolved, []);
});

test("a generic status field is not guessed as a compound numeric workflow status id", () => {
  const statusEngine = { ...engine, fields: [...engine.fields, { key: "status", label: "Status", enabled: true }] };
  const result = suggestFieldMapping(statusEngine, action({
    displayName: "Create service ticket",
    operationId: "createTicket",
    method: "POST",
    category: "create",
    inputSchema: {
      type: "object",
      required: ["fieldworkmachinestatusid"],
      properties: { fieldworkmachinestatusid: { type: "integer", enum: [1, 2, 3, 4] } },
      additionalProperties: false
    }
  }), engine.operations[3]);
  assert.deepEqual(result.fieldMapping, {});
  assert.deepEqual(result.unresolved.map((item) => item.externalField), ["fieldworkmachinestatusid"]);
});

test("recommendations connect clear read actions but do not invent a serial lookup", () => {
  const result = recommendEngineSetup(engine, [{
    id: "connection-1",
    name: "Customer system",
    status: "active",
    lastTestStatus: "passed",
    actions: [searchCustomers, getCustomer, createTicket]
  }]);
  const findCustomer = result.recommendations.find((item) => item.operationKey === "find_customer");
  const findMachine = result.recommendations.find((item) => item.operationKey === "find_machine");
  const customerDetail = result.recommendations.find((item) => item.operationKey === "get_customer");
  assert.equal(findCustomer.status, "ready");
  assert.equal(findCustomer.recommendedActionId, "searchCustomers");
  assert.equal(customerDetail.status, "ready");
  assert.equal(customerDetail.recommendedActionId, "getCustomer");
  assert.equal(findMachine.status, "missing");
  assert.equal(findMachine.recommendedActionId, null);
});

test("write action with an unknown required API field is review-only", () => {
  const result = recommendEngineSetup(engine, [{
    id: "connection-1",
    name: "Customer system",
    status: "active",
    lastTestStatus: "passed",
    actions: [createTicket]
  }]);
  const create = result.recommendations.find((item) => item.operationKey === "create_service_request");
  assert.equal(create.status, "review");
  assert.equal(create.selected, false);
  assert.deepEqual(create.unresolved.map((item) => item.externalField), ["workflowstatusid"]);
});

test("an existing mapping stays available even when its label is not a strong semantic match", () => {
  const opaqueLookup = action({
    displayName: "Lookup record",
    operationId: "lookupRecord",
    path: "/records/{customerid}",
    inputSchema: { type: "object", required: ["customerid"], properties: { customerid: { type: "integer" } }, additionalProperties: false }
  });
  const mappedEngine = {
    ...engine,
    operations: engine.operations.map((operation) => operation.key === "get_customer"
      ? { ...operation, mapping: { actionId: "lookupRecord", fieldMapping: { customer_id: "customerid" } } }
      : operation)
  };
  const result = recommendEngineSetup(mappedEngine, [{
    id: "connection-1",
    name: "Customer system",
    status: "active",
    lastTestStatus: "passed",
    actions: [opaqueLookup]
  }]);
  const customerDetail = result.recommendations.find((item) => item.operationKey === "get_customer");
  assert.equal(customerDetail.status, "connected");
  assert.equal(customerDetail.recommendedActionId, "lookupRecord");
  assert.equal(customerDetail.alternatives[0].actionId, "lookupRecord");
});
