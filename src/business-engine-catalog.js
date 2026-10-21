const CUSTOMER_SERVICE_FIELDS = [
  "customer_id", "customer_name", "company_name", "branch", "contact_person",
  "contact_number", "email", "address", "machine_id", "serial_number",
  "service_reference", "ticket_reference",
  "category", "description", "priority", "preferred_schedule", "assigned_staff",
  "status", "job_scope", "customer_notes", "internal_notes"
];

const BOOKING_FIELDS = [
  "booking_reference", "customer_id", "customer_name", "service_type", "staff_id",
  "staff_name", "location", "date", "start_time", "end_time", "timezone", "status",
  "notes", "cancellation_reason", "reschedule_reason"
];

const SALES_FIELDS = [
  "lead_id", "customer_name", "company_name", "contact_person", "contact_number",
  "email", "lead_source", "product_or_service", "requirement", "budget",
  "quotation_reference", "quotation_amount", "follow_up_date", "sales_stage",
  "assigned_salesperson", "notes"
];

const FINANCE_FIELDS = [
  "customer_id", "invoice_number", "billing_reference", "invoice_date", "due_date",
  "amount", "payment_status", "billing_status", "submission_date", "required_documents",
  "missing_documents", "dispute_reference", "extension_request", "extension_deadline",
  "follow_up_date", "account_notes"
];

function title(value) {
  return String(value).replace(/_/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function fields(values) {
  return values.map((key, index) => ({
    key,
    label: title(key),
    description: `Logical ${title(key).toLowerCase()} field used by this engine.`,
    dataType: ["amount", "quotation_amount"].includes(key) ? "number" : "string",
    enabled: true,
    required: false,
    order: index + 1
  }));
}

function operation(key, type, required = [], policy = null, fallback = "create_human_task") {
  const isRead = type === "read";
  const defaultPolicy = policy || (isRead ? "automatic" : type === "communication" ? "staff_approval" : "customer_confirmation");
  return {
    key,
    name: title(key),
    description: `${title(key)} using only a tenant-approved capability mapping.`,
    type,
    required,
    defaultPolicy,
    minimumPolicy: defaultPolicy,
    fallback
  };
}

const ENGINE_CATALOG = [
  {
    key: "customer_service",
    name: "Customer Service",
    description: "Handle inquiries, service requests, complaints, tickets, status updates and escalations.",
    instruction: [
      "You are responsible for customer service workflows including inquiries, complaints, service requests, ticket creation, status checks, scheduling-related requests, cancellations, escalations and customer updates.",
      "Use only capabilities enabled for this tenant. Never invent customer records, ticket status or transaction results.",
      "When a customer provides a unique identifier such as a machine serial number, ticket reference or customer reference, use the matching enabled lookup before asking for details. Use the returned customer, branch, machine and saved contact facts, and never ask again for information the lookup already returned.",
      "If an action is unavailable, use the configured fallback process. Request missing information before executing an operation.",
      "Follow approval and confirmation policies for every write or communication action."
    ].join("\n"),
    fields: fields(CUSTOMER_SERVICE_FIELDS),
    operations: [
      operation("find_customer", "read", ["customer_name"]),
      operation("find_machine", "read", ["serial_number"]),
      operation("get_machine_service_details", "read", ["machine_id"]),
      operation("get_customer", "read", ["customer_id"]),
      operation("list_customer_machines", "read", ["customer_id"]),
      operation("list_service_requests", "read", ["customer_id"]),
      operation("create_service_request", "write", ["customer_id", "description"]),
      operation("get_service_request", "read", ["service_reference"]),
      operation("get_service_status", "read", ["service_reference"]),
      operation("update_service_details", "write", ["service_reference"]),
      operation("reschedule_service", "write", ["service_reference", "preferred_schedule"]),
      operation("cancel_service", "write", ["service_reference"]),
      operation("assign_staff", "write", ["service_reference", "assigned_staff"], "staff_approval"),
      operation("update_service_status", "write", ["service_reference", "status"], "staff_approval"),
      operation("close_service_request", "write", ["service_reference"], "staff_approval"),
      operation("add_service_note", "write", ["service_reference", "customer_notes"]),
      operation("escalate_service_request", "write", ["service_reference"], "staff_approval"),
      operation("create_human_task", "write", ["description"], "staff_approval"),
      operation("notify_customer", "communication", ["customer_id", "description"], "staff_approval")
    ]
  },
  {
    key: "booking",
    name: "Booking & Appointments",
    description: "Handle availability, booking, rescheduling, cancellations and reminders.",
    instruction: [
      "You handle availability and appointment workflows only through enabled tenant capabilities.",
      "Collect the required service, customer, date, time, timezone and location details before requesting a booking change.",
      "Never invent availability or claim a booking is confirmed unless the mapped system reports success.",
      "Follow every confirmation, approval and fallback policy."
    ].join("\n"),
    fields: fields(BOOKING_FIELDS),
    operations: [
      operation("check_availability", "read", ["service_type", "date"]),
      operation("create_booking", "write", ["customer_name", "service_type", "date", "start_time"]),
      operation("get_booking", "read", ["booking_reference"]),
      operation("reschedule_booking", "write", ["booking_reference", "date", "start_time"]),
      operation("cancel_booking", "write", ["booking_reference"]),
      operation("assign_staff", "write", ["booking_reference", "staff_id"], "staff_approval"),
      operation("change_booking_details", "write", ["booking_reference"]),
      operation("send_booking_confirmation", "communication", ["booking_reference"], "staff_approval"),
      operation("send_booking_reminder", "communication", ["booking_reference"], "staff_approval"),
      operation("create_human_task", "write", ["notes"], "staff_approval")
    ]
  },
  {
    key: "sales",
    name: "Sales",
    description: "Handle leads, qualification, quotations, follow-ups, meetings and opportunity progression.",
    instruction: [
      "You handle sales workflows using the tenant's enabled capabilities and approved business facts.",
      "Never invent lead records, quotation amounts, approval status, availability or completed follow-ups.",
      "Collect required buyer details before a write, follow the configured policy, and use human fallback when a capability is unavailable."
    ].join("\n"),
    fields: fields(SALES_FIELDS),
    operations: [
      operation("find_lead", "read", ["customer_name"]),
      operation("create_lead", "write", ["customer_name", "requirement"]),
      operation("qualify_lead", "write", ["lead_id"], "staff_approval"),
      operation("update_lead", "write", ["lead_id"]),
      operation("create_quote", "write", ["lead_id", "product_or_service"], "staff_approval"),
      operation("get_quote", "read", ["quotation_reference"]),
      operation("send_quote", "communication", ["quotation_reference"], "staff_approval"),
      operation("schedule_sales_meeting", "write", ["lead_id", "follow_up_date"]),
      operation("follow_up_quote", "communication", ["quotation_reference"], "staff_approval"),
      operation("update_sales_stage", "write", ["lead_id", "sales_stage"], "staff_approval"),
      operation("assign_salesperson", "write", ["lead_id", "assigned_salesperson"], "staff_approval"),
      operation("create_human_task", "write", ["notes"], "staff_approval")
    ]
  },
  {
    key: "finance",
    name: "Finance & Billing",
    description: "Handle invoices, billing submissions, payment status, reminders, disputes and extensions.",
    instruction: [
      "You handle finance and billing workflows only through enabled tenant capabilities.",
      "Never invent invoice balances, payment status, submission results, deadlines or dispute outcomes.",
      "Treat financial records as sensitive, request missing references, and follow the strictest configured approval policy.",
      "Use the configured human fallback whenever a finance capability is unavailable."
    ].join("\n"),
    fields: fields(FINANCE_FIELDS),
    operations: [
      operation("get_invoice", "read", ["invoice_number"]),
      operation("submit_invoice", "write", ["invoice_number"], "staff_approval"),
      operation("check_billing_status", "read", ["billing_reference"]),
      operation("check_payment_status", "read", ["invoice_number"]),
      operation("send_billing_reminder", "communication", ["invoice_number"], "staff_approval"),
      operation("follow_up_invoice", "communication", ["invoice_number"], "staff_approval"),
      operation("request_billing_documents", "communication", ["invoice_number"], "staff_approval"),
      operation("record_billing_document", "write", ["invoice_number", "required_documents"], "staff_approval"),
      operation("create_billing_dispute", "write", ["invoice_number"], "staff_approval"),
      operation("request_payment_extension", "write", ["invoice_number", "extension_deadline"], "staff_approval"),
      operation("check_extension_status", "read", ["dispute_reference"]),
      operation("schedule_billing_meeting", "write", ["customer_id", "follow_up_date"], "staff_approval"),
      operation("create_human_task", "write", ["account_notes"], "staff_approval"),
      operation("notify_customer", "communication", ["customer_id", "account_notes"], "staff_approval")
    ]
  }
].map((engine, index) => ({ ...engine, version: 5, order: index + 1 }));

module.exports = { ENGINE_CATALOG };
