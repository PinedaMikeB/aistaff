/**
 * Playbook for urgent alerts (Mike 2026-10-23): every alert says WHAT happened, WHAT TO DO (steps),
 * and links straight to the screen where it is fixed. Used by src/escalations.js for the email,
 * the text message and the /e/<code> page.
 *
 * kind is taken from the alert (column `kind`) or recognised from its title (older alerts).
 * Links: the business's connected system (integration_connections.base_url origin, e.g. app.marga.biz)
 * and the AIStaff conversation (the call / chat transcript).
 */
const KINDS = [
  { kind: "test", match: /^TEST\b/i },
  { kind: "no_machines", match: /has no machines in the records/i },
  { kind: "close_request", match: /^Close (\S+) in your system/i },
  { kind: "cancel_request", match: /^Cancel (\S+) in your system/i },
  { kind: "email_missing", match: /email could not be captured/i },
  { kind: "follow_up", match: /following up on a request/i },
  { kind: "open_request_held", match: /held: the customer has an open request/i },
  { kind: "merge_failed", match: /could not be added to the open request/i },
  { kind: "not_scheduled", match: /could not be scheduled automatically/i },
  { kind: "not_saved", match: /could not be (saved|prepared)/i },
];

function kindOf(row) {
  if (row?.kind) return String(row.kind);
  const title = String(row?.title || "");
  return (KINDS.find((k) => k.match.test(title)) || { kind: "other" }).kind;
}

function refOf(row) {
  const title = String(row?.title || "");
  const d = row?.details || {};
  const fromTitle = title.match(/\b(SR-\d{4}-\d{3,})\b/i);
  if (fromTitle) return fromTitle[1].toUpperCase();
  const blob = Object.values(d).join(" ");
  const fromDetails = blob.match(/\b(SR-\d{4}-\d{3,})\b/i);
  return fromDetails ? fromDetails[1].toUpperCase() : "";
}

// Plain-language reasons for codes coming back from the connected system (2026-10-23).
const WHY = {
  CALLER_EMAIL_REQUIRED: "the caller's email was missing",
  CALLER_NAME_REQUIRED: "the caller's name was missing",
  CALLER_PHONE_REQUIRED: "the caller's contact number was missing",
  CUSTOMER_NOT_FOUND: "the customer could not be found in the records",
  CUSTOMER_BRANCH_NOT_FOUND: "the branch / department could not be found under that customer",
  BRANCH_NOT_FOUND: "the branch / department could not be found under that customer",
  MACHINE_NOT_FOUND: "the machine (serial) could not be found",
  MACHINE_NOT_AT_BRANCH: "the machine is not recorded at that branch",
  RELEASE_ITEMS_REQUIRED: "the ink / toner items and quantities were not given",
  INVALID_RELEASE_ITEMS: "the ink / toner items were not clear",
  INVALID_SCHEDULED_DATE: "the requested date could not be used",
  ASSIGNEE_INVALID: "no active staff could be assigned",
  SUMMARY_TOO_SHORT: "the problem description was too short",
  DESCRIPTION_TOO_SHORT: "the problem description was too short",
  PERMISSION_DENIED: "AIStaff is not allowed to do this in the system",
  AUTH_REQUIRED: "AIStaff could not log in to the system",
  INVALID_CREDENTIAL: "AIStaff's access to the system is invalid or revoked",
  ACCOUNT_OUT_OF_SCOPE: "AIStaff is not allowed to work on that customer",
  TICKET_NOT_FOUND: "the request number could not be found",
  blocked: "it needs a person to check it first",
};
function plainWhy(raw) {
  const text = String(raw || "").trim();
  if (!text) return "";
  const code = (text.match(/\b([A-Z][A-Z_]{3,})\b/) || [])[1];
  if (code && WHY[code]) return WHY[code];
  if (WHY[text]) return WHY[text];
  return text.replace(/_/g, " ").toLowerCase();
}

function telOf(details = {}) {
  const raw = String(details["Contact number"] || details.Phone || "").replace(/\D/g, "");
  if (/^09\d{9}$/.test(raw)) return `+63${raw.slice(1)}`;
  if (/^639\d{9}$/.test(raw)) return `+${raw}`;
  return raw.length >= 7 ? raw : "";
}

/**
 * @param row  staff_escalations row
 * @param ctx  { systemOrigin, conversationUrl }
 * @returns { kind, headline, problem, steps[], actions[{label,url,primary}] }
 */
function buildGuide(row, ctx = {}) {
  const kind = kindOf(row);
  const d = row?.details || {};
  const ref = refOf(row);
  const who = [d.Caller, d.Company && `(${d.Company}${d["Branch / department"] ? ` – ${d["Branch / department"]}` : ""})`].filter(Boolean).join(" ") || "The customer";
  const tel = telOf(d);
  const sys = String(ctx.systemOrigin || "").replace(/\/$/, "");
  const actions = [];
  const add = (label, url, primary = false) => { if (url) actions.push({ label, url, primary }); };
  const callBtn = () => tel && add(`Call ${d.Caller || "the customer"} (${d["Contact number"]})`, `tel:${tel}`);
  const convoBtn = () => ctx.conversationUrl && add("Read the call / chat", ctx.conversationUrl);
  const msBtn = (label) => sys && add(label || (ref ? `Open ${ref} in Master Schedule` : "Open Master Schedule"), `${sys}/master-schedule.html${ref ? `?q=${encodeURIComponent(ref)}` : ""}`, true);
  const newReqBtn = () => sys && add("Create the request in Service", `${sys}/service/?new=1`, true);

  let headline, problem, steps;
  switch (kind) {
    case "test":
      headline = "Test alert";
      problem = "This is only a test of the urgent alert. Nothing needs fixing.";
      steps = ["Press “I handled it” to stop the reminders."];
      break;
    case "no_machines":
      headline = "Caller's company is not in our machine records";
      problem = `${who} called for service, but the AI could not find any machine for that company, so no request was saved.`;
      steps = [
        "Read the call to see which company and machine they meant.",
        "Call the customer back and confirm the company name, branch and the serial on the machine sticker.",
        "If they are a customer under a different name, create the service request in Service under the correct company.",
        "If they are new, add them in Customers first (or pass them to Sales).",
        "Press “I handled it” and write what you did.",
      ];
      convoBtn(); newReqBtn(); callBtn(); if (sys) add("Open Customers", `${sys}/customers.html`);
      break;
    case "close_request":
      headline = `Close ${ref || "the request"} — the customer says it is done`;
      problem = `${who} told the AI that ${ref || "their request"} is already done, but the AI could not close it in the system.`;
      steps = [
        `Open ${ref || "the request"} in Master Schedule (the button below searches it for you).`,
        "Check it really is done (ask the technician if unsure).",
        "Press Close Schedule and choose how it was closed.",
        "Press “I handled it”.",
      ];
      msBtn(); convoBtn(); callBtn();
      break;
    case "cancel_request":
      headline = `Cancel ${ref || "the request"} — the customer no longer needs it`;
      problem = `${who} told the AI they do not need ${ref || "the request"} anymore, but the AI could not cancel it in the system.`;
      steps = [
        `Open ${ref || "the request"} in Master Schedule (the button below searches it for you).`,
        "Press Cancel and write the reason: “Customer no longer needs it”.",
        "If a technician or messenger is already on the way, tell them.",
        "Press “I handled it”.",
      ];
      msBtn(); convoBtn(); callBtn();
      break;
    case "email_missing":
      headline = "Customer email was not captured";
      problem = `The AI could not get ${who}'s email address on the call, so the request may be missing it and the customer will not get updates by email.`;
      steps = [
        "Read the call to see what the caller said.",
        "Call or text the customer and ask for their email.",
        "Add the email to the request (or to the branch in Customers).",
        "Press “I handled it”.",
      ];
      convoBtn(); callBtn(); if (sys) add("Open Customers", `${sys}/customers.html`, true);
      break;
    case "follow_up":
      headline = "Customer is following up on their request";
      problem = `${who} called to ask about their request. The AI told them a person will follow up.`;
      steps = [
        `Find their request in Master Schedule${ref ? ` (${ref})` : ""} and check the status, schedule and assigned staff.`,
        "Call the customer back with the date and time the staff will arrive (or what is delaying it).",
        "If it is overdue, move it up or re-assign it.",
        "Press “I handled it” and write what you told the customer.",
      ];
      msBtn(ref ? undefined : "Find the request in Master Schedule"); callBtn(); convoBtn();
      break;
    case "open_request_held":
      headline = "New request on hold — the customer already has an open request";
      problem = `${who} asked for something, but they already have an open request${ref ? ` (${ref})` : ""} and the call did not settle whether this is the same need or a new one. Nothing new was saved.`;
      steps = [
        "Read the call and check the open request in Master Schedule.",
        "Call the customer: is this the same problem (add it to the open request) or a different one (create a new request)?",
        "Update the open request, or create a new one in Service.",
        "Press “I handled it”.",
      ];
      msBtn(); newReqBtn(); callBtn(); convoBtn();
      break;
    case "merge_failed":
      headline = "Caller's extra need was not added to their open request";
      problem = `${who} added something to their open request${ref ? ` (${ref})` : ""}, but the AI could not save the addition.`;
      steps = [
        "Read the call to see what they added.",
        "Open the request in Master Schedule and add it to the remarks / items.",
        "If items are needed, make sure they are sent to Releasing.",
        "Press “I handled it”.",
      ];
      msBtn(); convoBtn(); callBtn();
      break;
    case "not_scheduled":
      headline = "Request was not scheduled — needs a person to book it";
      problem = `${who} asked for a ${String(d.Need || "service").toLowerCase()}, but it could not be scheduled automatically${d.Why ? ` because ${plainWhy(d.Why)}` : ""}.`;
      steps = [
        "Read the call to see what the customer needs.",
        "Create (or finish) the request in Service and assign the staff and date.",
        "Call the customer back with the schedule.",
        "Press “I handled it”.",
      ];
      newReqBtn(); convoBtn(); callBtn();
      break;
    case "not_saved":
      headline = "Request was NOT saved — needs to be entered by hand";
      problem = `${who} asked for a ${String(d.Need || "service").toLowerCase()}, but the request could not be saved in the system${d.Why ? ` because ${plainWhy(d.Why)}` : ""}. The customer is waiting.`;
      steps = [
        "Open New Service Request (button below) and enter it using the details in this message.",
        "Confirm the serial with the customer if it is missing.",
        "Call the customer back with the reference number and schedule.",
        "Press “I handled it”.",
      ];
      newReqBtn(); convoBtn(); callBtn();
      break;
    default:
      headline = String(row?.title || "Needs attention");
      problem = "The AI could not finish this by itself and needs a person.";
      steps = ["Read the details below (and the call / chat if there is one).", "Do what is needed in your system.", "Press “I handled it” and write what you did."];
      convoBtn(); callBtn();
  }
  if (actions.length && !actions.some((a) => a.primary)) actions[0].primary = true;
  return { kind, headline, problem, steps, actions, ref };
}

module.exports = { buildGuide, kindOf, plainWhy };
