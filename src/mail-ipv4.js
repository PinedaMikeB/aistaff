/**
 * 2026-10-20: nodemailer picks a RANDOM address among IPv4 + IPv6 for the mail server. The Ryzen's
 * IPv6 route is broken, so about half of all emails hung ~2 minutes before falling back to IPv4
 * (staff alerts and customer emails late; a customer reply was cut off). Show nodemailer IPv4
 * interfaces only. Required by every module that sends mail (safe to require many times).
 */
try {
  const shared = require("nodemailer/lib/shared");
  if (!shared.__ipv4Only) {
    const ifaces = require("os").networkInterfaces();
    shared.networkInterfaces = Object.fromEntries(Object.entries(ifaces).map(([name, list]) => [name, (list || []).filter((i) => i.family === "IPv4" || i.family === 4)]));
    shared.__ipv4Only = true;
  }
} catch (error) {
  console.warn("[mail] IPv4-only setup skipped: %s", error.message);
}
module.exports = {};
