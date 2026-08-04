// Minimal XML-escaping helper shared by SVG-generating modules. Prevents
// any customer-entered text (headline, copy, testimonial quote, etc.) from
// breaking out of the generated SVG markup.

function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

module.exports = { escapeXml };
