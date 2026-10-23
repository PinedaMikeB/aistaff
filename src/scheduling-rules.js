/**
 * Scheduling cut-off rules — Business Engines > Customer Service. Added 2026-10-20
 * (moved from Settings > General the same day: the cut-off is about service work,
 * not the whole business). Stored per tenant engine: tenant_engines.scheduling_rules.
 *
 * Generic for every business and OFF by default. When on, AIStaff works out the
 * earliest target date for a new request:
 *   - working days only (chosen weekdays, minus listed holidays);
 *   - steps = lead days (default 1 = next working day);
 *   - plus prep days when the request needs preparation (keyword match, e.g.
 *     toner, ink, parts) AND it came in after the cut-off or on a non-working
 *     day (before the cut-off the team prepares it the same day).
 * The date is only sent to the connected system's date field (e.g. scheduledDate).
 *
 * Customers: by default Closer NEVER tells a schedule day, date or time and never
 * promises when (tell_customer_schedule = false). Staff emails still show dates.
 */
const { prisma } = require("./db");

const TZ = "Asia/Manila";
const DATE_FIELDS = ["scheduledDate", "scheduleDate", "targetDate", "preferredDate", "serviceDate", "deliveryDate"];
const DAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const NO_PROMISE_LINE = "SCHEDULE: never tell the customer a schedule day, date or time, and never promise when the team will come, deliver or finish (no \"today\", \"tomorrow\", \"within the day\", no time). Say the team will schedule it; the reference number confirms it is saved.";

const DEFAULTS = {
  enabled: false,
  cutoff_time: "16:00",
  working_days: [1, 2, 3, 4, 5, 6],
  lead_days: 1,
  prep_keywords: [],
  prep_days: 1,
  holidays: [],
  queue_note: "Requests are served in the order they came in: earlier calls first, urgent (machine down) first.",
  tell_customer_schedule: false
};

function normalize(raw = {}) {
  const r = raw && typeof raw === "object" ? raw : {};
  const time = /^\d{2}:\d{2}$/.test(String(r.cutoff_time || "")) ? String(r.cutoff_time) : DEFAULTS.cutoff_time;
  const days = Array.isArray(r.working_days) ? [...new Set(r.working_days.map(Number).filter((d) => d >= 0 && d <= 6))].sort() : DEFAULTS.working_days;
  const list = (v) => (Array.isArray(v) ? v : String(v || "").split(/[,\n]/)).map((x) => String(x).trim()).filter(Boolean);
  const int = (v, d, max) => { const n = Number(v); return Number.isFinite(n) ? Math.max(0, Math.min(max, Math.round(n))) : d; };
  return {
    enabled: r.enabled === true,
    cutoff_time: time,
    working_days: days.length ? days : DEFAULTS.working_days,
    lead_days: int(r.lead_days, DEFAULTS.lead_days, 14),
    prep_keywords: list(r.prep_keywords).map((k) => k.toLowerCase()).slice(0, 40),
    prep_days: int(r.prep_days, DEFAULTS.prep_days, 14),
    holidays: list(r.holidays).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).slice(0, 100),
    queue_note: String(r.queue_note ?? DEFAULTS.queue_note).slice(0, 300),
    tell_customer_schedule: r.tell_customer_schedule === true
  };
}

function manila(at = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: TZ, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23", weekday: "short" }).formatToParts(at).map((p) => [p.type, p.value]));
  return { ymd: `${parts.year}-${parts.month}-${parts.day}`, hhmm: `${parts.hour}:${parts.minute}`, dow: DAY_NAMES.indexOf(parts.weekday) };
}
function shift(ymd, days) { const d = new Date(`${ymd}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
function dow(ymd) { return new Date(`${ymd}T00:00:00Z`).getUTCDay(); }
function isWorkingDay(ymd, s) { return s.working_days.includes(dow(ymd)) && !s.holidays.includes(ymd); }
function addWorkingDays(ymd, steps, s) {
  let day = ymd;
  if (steps <= 0) { let guard = 0; while (!isWorkingDay(day, s) && guard++ < 60) day = shift(day, 1); return day; }
  let left = steps, guard = 0;
  while (left > 0 && guard++ < 120) { day = shift(day, 1); if (isWorkingDay(day, s)) left -= 1; }
  return day;
}
function prepKeyword(text, s) {
  const t = String(text || "").toLowerCase();
  return s.prep_keywords.find((k) => new RegExp(`(^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}`, "i").test(t)) || "";
}

/** Earliest target date for a request made at `at` described by `text`. */
function targetDate(settings, { at = new Date(), text = "", needsPrep = null } = {}) {
  const s = normalize(settings);
  const now = manila(at);
  const afterCutoff = now.hhmm >= s.cutoff_time || !isWorkingDay(now.ymd, s);
  const keyword = needsPrep === null ? prepKeyword(text, s) : "";
  const prep = needsPrep === null ? Boolean(keyword) : Boolean(needsPrep);
  const steps = s.lead_days + (prep && afterCutoff ? s.prep_days : 0);
  return { date: addWorkingDays(now.ymd, steps, s), afterCutoff, needsPrep: prep, keyword, requestDay: now.ymd };
}

function niceDate(ymd) {
  return new Date(`${ymd}T00:00:00Z`).toLocaleDateString("en-PH", { weekday: "long", month: "short", day: "numeric", timeZone: "UTC" });
}
function cutoffLabel(hhmm) { const [h, m] = hhmm.split(":").map(Number); return `${((h + 11) % 12) + 1}:${String(m).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`; }

/** Target-date lines (only used when the business allows telling customers the schedule). */
function promptLines(settings, at = new Date()) {
  const s = normalize(settings);
  if (!s.enabled) return [];
  const now = manila(at);
  const plain = targetDate(s, { at, needsPrep: false });
  const prep = targetDate(s, { at, needsPrep: true });
  return [
    `SCHEDULING RULES of this business: working days ${s.working_days.map((d) => DAY_NAMES[d]).join(", ")}; daily cut-off ${cutoffLabel(s.cutoff_time)} (Philippine time).`,
    `Right now it is ${niceDate(now.ymd)} ${now.hhmm}. Earliest target date for a new request: ${niceDate(plain.date)}${s.prep_keywords.length && prep.date !== plain.date ? `; if it needs preparation (${s.prep_keywords.join(", ")}): ${niceDate(prep.date)}` : ""}.`,
    "Give this only as a TARGET date (not a promise, no exact time). A saved request's own schedule always wins."
  ];
}

async function tenantEngineFor(companyId, engineKey) {
  if (!companyId) return null;
  return prisma.tenantEngine.findFirst({ where: { company_id: companyId, engine: { key: engineKey } }, include: { engine: { select: { key: true, name: true } } } }).catch(() => null);
}

async function settingsForEngine(companyId, engineKey = "customer_service") {
  const row = await tenantEngineFor(companyId, engineKey);
  return normalize(row?.scheduling_rules || {});
}

/** Rules of the engine this action is mapped under (none = no change). */
async function settingsForAction(companyId, action) {
  if (!companyId || !action?.id) return null;
  const mapping = await prisma.engineOperationMapping.findFirst({
    where: { company_id: companyId, integration_action_id: action.id },
    include: { tenant_operation: { include: { tenant_engine: { select: { scheduling_rules: true, enabled: true } } } } }
  }).catch(() => null);
  const engine = mapping?.tenant_operation?.tenant_engine;
  return engine ? normalize(engine.scheduling_rules || {}) : null;
}

/** Fill the action's empty date field with the target date when its engine has a cut-off. */
async function applyToArgs({ companyId, action, args, at = new Date() }) {
  const props = action?.input_schema?.properties || {};
  const wanted = new Set(DATE_FIELDS.map((n) => n.toLowerCase()));
  const field = Object.keys(props).find((name) => wanted.has(name.toLowerCase().replace(/_/g, "")));
  if (!field || !companyId) return args;
  const current = args?.[field];
  if (current != null && String(current).trim() !== "") return args;
  const s = await settingsForAction(companyId, action);
  if (!s?.enabled) return args;
  const text = Object.values(args || {}).filter((v) => typeof v === "string").join(" ");
  const result = targetDate(s, { at, text });
  return { ...args, [field]: props[field].format === "date-time" ? `${result.date}T08:00:00+08:00` : result.date };
}

/** Prompt lines for customer replies (Customer Service engine active only). */
async function customerPromptLines(companyId) {
  const row = await tenantEngineFor(companyId, "customer_service");
  if (!row?.enabled) return [];
  const s = normalize(row.scheduling_rules || {});
  return s.tell_customer_schedule ? promptLines(s) : [NO_PROMISE_LINE];
}

module.exports = { DEFAULTS, NO_PROMISE_LINE, normalize, targetDate, promptLines, settingsForEngine, settingsForAction, applyToArgs, customerPromptLines, tenantEngineFor, addWorkingDays, niceDate };
