// End-to-end check of Phone Lines on the PREVIEW (port 3177). Run from the preview folder.
require("dotenv").config({ override: true });
const auth = require("../src/auth");
const { prisma } = require("../src/db");
const BASE = "http://127.0.0.1:3177";
const TEST_COMPANY = "7d9ab57d-49e9-420a-86d4-972ca3d75cdf"; // "testcompany"

const signName = Object.keys(auth).find((k) => /sign|token/i.test(k) && typeof auth[k] === "function");
function tokenFor(user) { return auth[signName](user); }
async function call(token, method, path, body) {
  const r = await fetch(BASE + path, { method, headers: { "content-type": "application/json", authorization: "Bearer " + token }, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  return { status: r.status, body: j };
}
function ok(label, cond, extra) { console.log((cond ? "PASS " : "FAIL ") + label + (extra ? "  — " + extra : "")); if (!cond) process.exitCode = 1; }

(async () => {
  console.log("sign function:", signName);
  const staff = await prisma.user.findFirst({ where: { platform_role: { in: ["admin", "ADMIN", "superadmin", "SUPERADMIN"] } } });
  const tenantAdmin = await prisma.user.findFirst({ where: { company_id: TEST_COMPANY, role: { in: ["admin", "account_admin", "owner", "ADMIN", "OWNER"] }, platform_role: null } });
  const otherTenant = await prisma.user.findFirst({ where: { company_id: { not: TEST_COMPANY }, platform_role: null, role: { in: ["admin", "account_admin", "owner", "ADMIN", "OWNER"] } } });
  ok("found platform admin user", Boolean(staff), staff?.email);
  ok("found test tenant admin user", Boolean(tenantAdmin), tenantAdmin?.email);
  if (!staff || !tenantAdmin) return;
  const S = tokenFor(staff), T = tokenFor(tenantAdmin), O = otherTenant ? tokenFor(otherTenant) : null;

  // Tenant cannot reach platform routes.
  ok("tenant blocked from Platform › Phone Lines", (await call(T, "GET", "/api/platform/phone-lines")).status === 403);

  // Staff adds a router.
  const serial = "TEST-" + Date.now();
  const add = await call(S, "POST", "/api/platform/phone-lines", { model: "AIO100-1V", device_serial: serial, phone_number: "0999 000 0000", carrier: "Smart", gateway_host: "127.0.0.1" });
  ok("staff adds router (in stock)", add.status === 200 && add.body.device.status === "in_stock", add.body.error);
  const id = add.body.device?.id;
  ok("list never includes SIP password", !JSON.stringify((await call(S, "GET", "/api/platform/phone-lines")).body).includes("password"));

  // Before assignment the tenant has no phone line.
  let ch = (await call(T, "GET", "/api/channels")).body.channels.find((c) => c.key === "mobile_phone");
  ok("tenant sees 'no phone line yet' before assignment", ch && !ch.device);

  // Staff assigns -> handoff kit code.
  const asg = await call(S, "POST", `/api/platform/phone-lines/${id}/assign`, { company_id: TEST_COMPANY });
  const code = asg.body.device?.setup_code;
  ok("assign creates setup code", /^AIS-[A-Z2-9]{4}-[A-Z2-9]{4}$/.test(code || ""), code);

  // Wrong tenant cannot claim it.
  if (O) ok("other customer cannot use the code", (await call(O, "POST", "/api/channels/mobile_phone/claim", { code })).status === 400);
  ok("wrong code rejected", (await call(T, "POST", "/api/channels/mobile_phone/claim", { code: "AIS-ZZZZ-ZZZZ" })).status === 400);

  // Tenant claims (lower-case, no dashes still works).
  const claim = await call(T, "POST", "/api/channels/mobile_phone/claim", { code: code.toLowerCase().replace(/-/g, "") });
  ch = claim.body.channels?.find((c) => c.key === "mobile_phone");
  ok("tenant links router with setup code", claim.status === 200 && ch?.steps?.code, claim.body.error);
  ok("code is single-use", (await call(T, "POST", "/api/channels/mobile_phone/claim", { code })).status === 400);

  // Check connection (127.0.0.1 answers ping).
  const chk = await call(T, "POST", "/api/channels/mobile_phone/check");
  ok("connection check runs", chk.status === 200 && chk.body.check, JSON.stringify(chk.body.check));

  // Personalise + actions.
  const per = await call(T, "PUT", "/api/channels/mobile_phone", { pitch: { agent_name: "Marie", greeting: "Hello po, this is Marie. Paano ko kayo matutulungan?", voice: "zonos1110_22050_epoch180", hours_days: "Mon–Sat", hours_open: "08:00", hours_close: "18:00", after_hours: "answer" } });
  ch = per.body.channels?.find((c) => c.key === "mobile_phone");
  ok("personalise saved (name Marie)", ch?.pitch?.agent_name === "Marie" && ch.steps.personalise, per.body.error);
  const act = await call(T, "PUT", "/api/channels/mobile_phone", { pitch: { allow_sms: true, allow_booking: false, allow_tickets: true, alert_contact: "Staff 0917", actions_saved: true } });
  ch = act.body.channels?.find((c) => c.key === "mobile_phone");
  ok("allowed actions saved", ch?.steps?.actions && ch.pitch.allow_booking === false, act.body.error);
  ok("go live stays locked", (await call(T, "PUT", "/api/channels/mobile_phone", { enabled: true })).status === 400);
  ok("empty assistant name rejected", (await call(T, "PUT", "/api/channels/mobile_phone", { pitch: { agent_name: "" } })).status === 400);

  // Staff view reflects the customer's setup.
  const after = (await call(S, "GET", "/api/platform/phone-lines")).body.devices.find((d) => d.id === id);
  ok("staff sees 'set up by customer'", after?.claimed_at && !after.setup_code);

  // Clean up the test router and the test tenant's phone settings.
  await prisma.sipDevice.delete({ where: { id } });
  await prisma.tenantChannel.deleteMany({ where: { company_id: TEST_COMPANY, channel_key: "mobile_phone" } });
  console.log("cleaned up test router and test settings");
  await prisma.$disconnect();
})().catch((e) => { console.error("ERROR", e); process.exit(1); });
