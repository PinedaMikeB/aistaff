const test = require("node:test");
const assert = require("node:assert");
const contacts = require("../src/contacts");

test("contacts: Philippine phone numbers normalise to one key", () => {
  assert.equal(contacts.phoneKey("09171234567"), "639171234567");
  assert.equal(contacts.phoneKey("+63 917 123 4567"), "639171234567");
  assert.equal(contacts.phoneKey("9171234567"), "639171234567");
  assert.equal(contacts.phoneKey("anonymous"), null);
});

test("contacts: identity per channel", () => {
  assert.deepEqual(contacts.identityOf({ channel: "email", customer_profile: { known: { calleremail: "Ana@Example.com" } } }), { channel: "email", identity: "ana@example.com" });
  assert.deepEqual(contacts.identityOf({ channel: "facebook_messenger", psid: "123" }), { channel: "facebook_messenger", identity: "123" });
});
