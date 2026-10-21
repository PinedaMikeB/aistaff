const test = require("node:test");
const assert = require("node:assert/strict");
const { simpleParser } = require("mailparser");
const ec = require("../src/email-channel");

const config = { address: "care@example.com", username: "care@example.com" };
const mail = (headers, body = "Hello, my printer is not working.") => simpleParser(Buffer.from(`${headers}\r\nContent-Type: text/plain\r\n\r\n${body}\r\n`));
const base = "From: Ana Cruz <ana@customer.ph>\r\nTo: care@example.com\r\nSubject: Printer problem\r\nMessage-ID: <a1@customer.ph>";

test("real customer mail is answered", async () => {
  assert.equal(ec.skipReason(await mail(base), config), null);
});

test("loops and machine mail are skipped", async () => {
  const cases = {
    own_message: "From: care@example.com\r\nSubject: hi",
    aistaff_system_mail: `From: ${process.env.NOTIFY_SMTP_USER || "support@aistaff.click"}\r\nSubject: URGENT`,
    auto_reply: `${base}\r\nAuto-Submitted: auto-replied`,
    bulk_mail: `${base}\r\nPrecedence: bulk`,
    newsletter: `${base}\r\nList-Unsubscribe: <mailto:x@y.z>`,
    bounce: "From: MAILER-DAEMON@mx.example.net\r\nSubject: Undelivered",
    noreply_sender: "From: no-reply@shop.ph\r\nSubject: Your order"
  };
  if (!process.env.NOTIFY_SMTP_USER) process.env.NOTIFY_SMTP_USER = "support@aistaff.click";
  for (const [reason, headers] of Object.entries(cases)) {
    assert.equal(ec.skipReason(await mail(headers), config), reason, reason);
  }
  assert.equal(ec.skipReason(await mail("From: Ana <ana@customer.ph>\r\nSubject: Out of Office: away"), config), "auto_reply");
  assert.equal(ec.skipReason(await mail(`${base}\r\nX-AIStaff-Channel: email`), config), "own_message");
});

test("only the new part of a reply is kept", () => {
  const text = "Wala pa pong dumating.\nSalamat.\n\nOn Mon, Oct 20, 2026 at 9:00 AM Marga <care@example.com> wrote:\n> Hi Ana\n> earlier text";
  assert.equal(ec.newPartOfReply(text), "Wala pa pong dumating.\nSalamat.");
});

test("Hostinger preset fills servers; test is invalidated by a new password", () => {
  const c = ec.normalizeConfig({ provider: "hostinger", address: "Care@Example.com" }, {}, "Acme");
  assert.equal(c.address, "care@example.com");
  assert.equal(c.imap_host, "imap.hostinger.com");
  assert.equal(c.smtp_port, 465);
  assert.equal(c.sender_name, "Acme");
  const row = { config: c, secret_encrypted: "a" };
  const tested = { ...row, tested_fingerprint: ec.fingerprint(row) };
  assert.equal(ec.isTested(tested), true);
  assert.equal(ec.isTested({ ...tested, secret_encrypted: "b" }), false);
});
