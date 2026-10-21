const test = require("node:test");
const assert = require("node:assert/strict");
const rl = require("../src/resolve-loop");

test("signed links: valid for the recipient, tamper-proof", () => {
  const id = "978aac92-b1d8-44a3-8ab8-31ccb47068a9";
  const token = rl.makeToken(id, "Staff@Example.com");
  const data = rl.readToken(token);
  assert.equal(data.r, id);
  assert.equal(data.e, "staff@example.com");
  const [body, mac] = token.split(".");
  const forged = Buffer.from(JSON.stringify({ r: "other", e: "x@y.z", x: Date.now() + 1e9 })).toString("base64url");
  assert.equal(rl.readToken(`${forged}.${mac}`), null);
  assert.equal(rl.readToken(`${body}.x${mac.slice(1)}`), null);
  const links = rl.resolveLinks(id, "staff@example.com");
  assert.equal(links.code, "R-978aac92");
  assert.match(links.retry, /\/resolve\/.+\?do=retry$/);
});

test("staff reply prompt carries the reply and the problem", () => {
  const prompt = rl.interpreterPrompt("ayos na po, try ulit", "No active messenger in South 3");
  assert.match(prompt, /ayos na po, try ulit/);
  assert.match(prompt, /South 3/);
  assert.match(prompt, /retry\|manual\|handle\|unclear/);
});
