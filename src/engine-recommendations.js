const READ_METHODS = new Set(["GET", "HEAD"]);

const STOP_WORDS = new Set([
  "a", "an", "and", "by", "for", "from", "in", "into", "of", "on", "or",
  "the", "to", "using", "with", "only", "approved", "capability", "mapping"
]);

const TOKEN_ALIASES = {
  account: "customer",
  accounts: "customer",
  client: "customer",
  clients: "customer",
  appointment: "booking",
  appointments: "booking",
  quotation: "quote",
  quotations: "quote",
  retrieve: "get",
  view: "get",
  read: "get",
  details: "detail",
  information: "detail",
  find: "search",
  lookup: "search",
  case: "ticket",
  request: "ticket",
  requests: "ticket",
  email: "notify",
  message: "notify",
  send: "notify",
  queue: "notify",
  reminder: "notify",
  equipment: "machine",
  asset: "machine",
  invoice: "billing"
};

const OPERATION_HINTS = {
  find_customer: ["search customer", "search account", "list customer"],
  get_customer: ["get customer", "customer detail", "customer branch"],
  find_machine: ["search machine", "find serial", "machine serial"],
  get_machine_service_details: ["machine service detail", "machine contract", "machine history"],
  create_service_request: ["create service ticket", "open service ticket"],
  get_service_request: ["get service ticket", "retrieve service ticket"],
  get_service_status: ["service ticket status", "get ticket status"],
  update_service_details: ["update service ticket", "change service detail"],
  reschedule_service: ["reschedule service", "change service schedule"],
  cancel_service: ["cancel service", "cancel ticket"],
  assign_staff: ["assign staff", "assign technician", "assign representative"],
  update_service_status: ["update service status", "change ticket status"],
  close_service_request: ["close service ticket", "complete service ticket"],
  add_service_note: ["add service note", "add ticket note"],
  escalate_service_request: ["escalate service", "escalate ticket"],
  notify_customer: ["notify customer", "customer email", "customer message"],
  check_availability: ["check availability", "list availability"],
  create_booking: ["create booking", "book appointment"],
  get_booking: ["get booking", "booking detail"],
  reschedule_booking: ["reschedule booking", "change appointment"],
  cancel_booking: ["cancel booking", "cancel appointment"],
  send_booking_confirmation: ["booking confirmation", "appointment confirmation"],
  send_booking_reminder: ["booking reminder", "appointment reminder"],
  find_lead: ["search lead", "find prospect"],
  create_lead: ["create lead", "add prospect"],
  update_lead: ["update lead", "change prospect"],
  create_quote: ["create quote", "create quotation"],
  get_quote: ["get quote", "retrieve quotation"],
  send_quote: ["send quote", "send quotation"],
  get_invoice: ["get invoice", "billing detail"],
  check_billing_status: ["billing status", "invoice status"],
  check_payment_status: ["payment status", "check payment"],
  send_billing_reminder: ["billing reminder", "payment reminder"]
};

const FIELD_ALIASES = {
  customer_id: ["customerid", "accountid", "clientid"],
  customer_name: ["customername", "accountname", "clientname", "q", "query", "search"],
  company_name: ["companyname", "businessname", "organizationname"],
  branch: ["branch", "branchid", "location", "locationid"],
  contact_person: ["contactperson", "contactname", "representative"],
  contact_number: ["contactnumber", "phone", "phonenumber", "mobile", "mobilenumber"],
  service_reference: ["servicereference", "ticketreference", "ticketid", "requestid"],
  ticket_reference: ["ticketreference", "ticketid", "servicereference", "requestid"],
  machine_id: ["machineid", "equipmentid", "assetid"],
  serial_number: ["serial", "serialnumber", "machineserial", "assetnumber"],
  preferred_schedule: ["preferredschedule", "schedule", "scheduledat", "appointmentdate"],
  assigned_staff: ["assignedstaff", "staffid", "technicianid", "representativeid"],
  booking_reference: ["bookingreference", "bookingid", "appointmentid"],
  quotation_reference: ["quotationreference", "quoteid", "quotationid"],
  invoice_number: ["invoicenumber", "invoiceid", "billingreference"],
  billing_reference: ["billingreference", "invoiceid", "invoicenumber"],
  description: ["description", "details", "issue", "problem", "summary", "concern"],
  notes: ["notes", "note", "details", "remarks"],
  customer_notes: ["customernotes", "notes", "note", "remarks"],
  account_notes: ["accountnotes", "notes", "note", "remarks"]
};

function words(value) {
  return String(value || "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map((word) => TOKEN_ALIASES[word] || word)
    .filter((word) => !STOP_WORDS.has(word));
}

function compact(value) {
  return words(value).join("");
}

function operationTypeMatches(operation, action) {
  const read = READ_METHODS.has(String(action.method || "").toUpperCase());
  const communication = String(action.category || "").toLowerCase() === "communication"
    || /email|message|notify|notification|reminder/i.test(`${action.displayName} ${action.operationId} ${action.path}`);
  if (operation.type === "read") return read;
  if (operation.type === "communication") return !read && communication;
  return !read && !communication;
}

function fieldNames(field) {
  return new Set([compact(field.key), compact(field.label), ...(FIELD_ALIASES[field.key] || [])].filter(Boolean));
}

function fieldMatchScore(field, externalName) {
  const target = compact(externalName);
  if (!target) return 0;
  const names = fieldNames(field);
  if (names.has(target)) return 100;
  for (const name of names) {
    if (target.endsWith("id") && !compact(field.key).endsWith("id")) continue;
    if (name.length >= 5 && (name.includes(target) || target.includes(name))) return 70;
  }
  return 0;
}

function suggestFieldMapping(engine, action, operation) {
  const schema = action.inputSchema && typeof action.inputSchema === "object" ? action.inputSchema : {};
  const properties = schema.properties && typeof schema.properties === "object" ? Object.keys(schema.properties) : [];
  const fields = (engine.fields || []).filter((field) => field.enabled);
  const used = new Set();
  const fieldMapping = {};

  for (const field of fields) {
    let best = null;
    for (const externalName of properties) {
      if (used.has(externalName)) continue;
      const score = fieldMatchScore(field, externalName);
      if (!best || score > best.score) best = { externalName, score };
    }
    if (best && best.score >= 70) {
      fieldMapping[field.key] = best.externalName;
      used.add(best.externalName);
    }
  }

  const requiredExternal = Array.isArray(schema.required) ? schema.required : [];
  const requiredLogical = Array.isArray(operation.requiredFields) ? operation.requiredFields : [];
  if (requiredLogical.length === 1) {
    const genericSearch = requiredExternal.find((name) => ["q", "query", "search", "term"].includes(compact(name)));
    if (genericSearch && !used.has(genericSearch)) {
      fieldMapping[requiredLogical[0]] = genericSearch;
      used.add(genericSearch);
    }
  }

  const unresolved = requiredExternal.filter((name) => !used.has(name)).map((name) => ({
    externalField: name,
    label: String(name).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase())
  }));
  return { fieldMapping, unresolved };
}

function scoreAction(operation, action) {
  if (!operationTypeMatches(operation, action)) return -1;
  if (/\bhealth\b|\/health|heartbeat|ping/i.test(`${action.displayName} ${action.operationId} ${action.path}`)) return -1;
  const operationText = `${operation.key} ${operation.name} ${operation.description}`;
  const actionText = `${action.operationId} ${action.displayName} ${action.description} ${action.path}`;
  const operationWords = new Set(words(operationText));
  const actionWords = new Set(words(actionText));
  let score = 0;
  for (const word of operationWords) if (actionWords.has(word)) score += word.length >= 7 ? 3 : 2;
  const actionCompact = compact(actionText);
  for (const hint of OPERATION_HINTS[operation.key] || []) {
    const hintWords = words(hint);
    if (hintWords.every((word) => actionWords.has(word))) score += 8;
    if (actionCompact.includes(compact(hint))) score += 4;
  }
  return score;
}

function recommendEngineSetup(engine, connections = []) {
  const actions = [];
  for (const connection of connections) {
    if (connection.status === "disabled" || connection.status === "attention_required") continue;
    for (const action of connection.actions || []) actions.push({
      ...action,
      connectionId: connection.id,
      connectionName: connection.name,
      connectionStatus: connection.status,
      lastTestStatus: connection.lastTestStatus
    });
  }

  const recommendations = (engine.operations || []).map((operation) => {
    const ranked = actions
      .map((action) => {
        const score = scoreAction(operation, action);
        const fields = suggestFieldMapping(engine, action, operation);
        return { action, score, ...fields };
      })
      .filter((candidate) => candidate.score >= 5)
      .sort((left, right) => right.score - left.score || left.unresolved.length - right.unresolved.length)
      .slice(0, 8);

    const mappedId = operation.mapping?.actionId || null;
    let best = mappedId ? ranked.find((candidate) => candidate.action.id === mappedId) : ranked[0];
    if (!best && mappedId) {
      const mappedAction = actions.find((action) => action.id === mappedId);
      if (mappedAction) best = { action: mappedAction, score: 100, ...suggestFieldMapping(engine, mappedAction, operation) };
    }
    const savedFieldMapping = operation.mapping?.fieldMapping && typeof operation.mapping.fieldMapping === "object"
      ? operation.mapping.fieldMapping : {};
    const hasSavedFieldMapping = Object.keys(savedFieldMapping).length > 0;
    const savedExternalFields = new Set(Object.values(savedFieldMapping));
    const choices = best && !ranked.some((candidate) => candidate.action.id === best.action.id)
      ? [best, ...ranked]
      : ranked;
    const hydratedChoices = choices.map((candidate) => {
      if (!mappedId || candidate.action.id !== mappedId || !hasSavedFieldMapping) return candidate;
      return {
        ...candidate,
        fieldMapping: savedFieldMapping,
        unresolved: candidate.unresolved.filter((issue) => !savedExternalFields.has(issue.externalField))
      };
    });
    const selectedCandidate = mappedId
      ? hydratedChoices.find((candidate) => candidate.action.id === mappedId) || best
      : hydratedChoices[0] || best;
    const existing = Boolean(mappedId && selectedCandidate);
    const ready = Boolean(selectedCandidate && selectedCandidate.unresolved.length === 0 && (selectedCandidate.score >= 8 || existing));
    return {
      operationKey: operation.key,
      operationName: operation.name,
      operationDescription: operation.description,
      type: operation.type,
      policy: operation.policy,
      existing,
      selected: existing || ready,
      status: existing ? "connected" : ready ? "ready" : selectedCandidate ? "review" : "missing",
      recommendedActionId: selectedCandidate?.action.id || null,
      fieldMapping: selectedCandidate?.fieldMapping || {},
      unresolved: selectedCandidate?.unresolved || [],
      alternatives: hydratedChoices.map((candidate) => ({
        actionId: candidate.action.id,
        actionName: candidate.action.displayName,
        connectionName: candidate.action.connectionName,
        method: candidate.action.method,
        path: candidate.action.path,
        policy: candidate.action.approvalPolicy,
        minimumPolicy: candidate.action.minimumPolicy,
        fieldMapping: candidate.fieldMapping,
        unresolved: candidate.unresolved,
        score: candidate.score
      }))
    };
  });

  return {
    ready: recommendations.filter((item) => item.status === "ready" || item.status === "connected").length,
    review: recommendations.filter((item) => item.status === "review").length,
    missing: recommendations.filter((item) => item.status === "missing").length,
    recommendations
  };
}

module.exports = {
  OPERATION_HINTS,
  FIELD_ALIASES,
  words,
  compact,
  operationTypeMatches,
  suggestFieldMapping,
  scoreAction,
  recommendEngineSetup
};
