const test = require("node:test");
const assert = require("node:assert");
const rs = require("../src/reply-style");

test("reply style: email defaults to formal, chat channels to casual", () => {
  assert.equal(rs.defaultStyle("email"), "formal");
  assert.equal(rs.defaultStyle("facebook_messenger"), "casual");
  assert.equal(rs.defaultStyle("website_chat"), "casual");
  assert.match(rs.rules("formal", "email"), /FORMAL/);
  assert.match(rs.rules("casual", "facebook_messenger"), /CASUAL/);
});

test("reply style: formal email text becomes rich HTML with nested lists", () => {
  const html = rs.emailHtml("Dear Ana,\n\nPlease send:\n\n1. Serial\n2. Condition:\n   1. OK\n   2. Down\n\nThank you.");
  assert.match(html, /<p[^>]*>Dear Ana,<\/p>/);
  assert.match(html, /<ol[^>]*><li[^>]*>Serial<\/li><li[^>]*>Condition:<ol[^>]*><li[^>]*>OK<\/li><li[^>]*>Down<\/li><\/ol><\/li><\/ol>/);
  assert.doesNotMatch(rs.emailHtml("<script>x</script>"), /<script>/);
});
