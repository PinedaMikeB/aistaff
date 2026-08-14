#!/usr/bin/env node
/**
 * Simulate a paid order — for testing the post-payment experience without
 * moving money.
 *
 * Does exactly what the Xendit webhook does on a PAID event: marks the order
 * and its payment/invoice paid, activates the subscription, then provisions
 * the workspace and issues a set-password link.
 *
 *   npm run simulate:paid                 # newest awaiting-payment order
 *   npm run simulate:paid ORD-20260813-1  # a specific order number
 *
 * SAFE BY DEFAULT: refuses to run when PAYMENT_MODE=live, so it can never be
 * used to mark a real customer's unpaid order as settled.
 */

require("dotenv").config();
const { prisma } = require("../src/db");
const { provisionPaidOrder } = require("../src/provisioning");
const { nextBillingDate } = require("../src/payments");

async function main() {
  if (String(process.env.PAYMENT_MODE || "").toLowerCase() === "live") {
    console.error("Refusing to run: PAYMENT_MODE=live. This would mark a real order paid.");
    process.exit(1);
  }

  const wanted = process.argv[2];
  const order = wanted
    ? await prisma.order.findFirst({ where: { order_number: wanted }, include: { customer: true } })
    : await prisma.order.findFirst({
        where: { payment_status: { not: "paid" } },
        orderBy: { created_at: "desc" },
        include: { customer: true }
      });

  if (!order) {
    console.error(wanted ? `No order ${wanted}.` : "No unpaid orders found. Complete checkout first.");
    process.exit(1);
  }

  console.log(`Order    : ${order.order_number}`);
  console.log(`Customer : ${order.customer.full_name} <${order.customer.email}>`);
  console.log(`Business : ${order.customer.business_name || "(not given)"}`);
  console.log(`Total    : ${order.currency} ${order.total}`);
  console.log("");

  if (order.payment_status === "paid") {
    console.log("Already paid — re-running provisioning only.");
  } else {
    const periodEnd = nextBillingDate(order.billing_frequency);
    await prisma.$transaction([
      prisma.payment.updateMany({
        where: { order_id: order.id },
        data: { status: "paid", paid_at: new Date() }
      }),
      prisma.order.update({
        where: { id: order.id },
        data: { payment_status: "paid", order_status: "onboarding_required", paid_at: new Date() }
      }),
      prisma.subscription.updateMany({
        where: { order_id: order.id },
        data: { status: "active", current_period_start: new Date(), current_period_end: periodEnd }
      }),
      prisma.invoice.updateMany({
        where: { order_id: order.id },
        data: { status: "paid", paid_at: new Date() }
      })
    ]);
    console.log("Marked paid (simulating the Xendit PAID webhook).");
  }

  const result = await provisionPaidOrder(order.id);
  console.log("");
  if (!result.ok) {
    console.error("Provisioning FAILED:", result.reason, result.detail || "");
    process.exit(1);
  }

  const company = await prisma.company.findUnique({
    where: { id: result.companyId },
    include: { users: { select: { email: true, name: true, role: true } } }
  });

  console.log("=== WHAT THE CUSTOMER NOW HAS ===");
  console.log(`Workspace      : ${company.name}`);
  console.log(`Account number : ${company.account_number}`);
  console.log(`Login email    : ${company.users[0] && company.users[0].email}`);
  console.log(`Role           : ${company.users[0] && company.users[0].role}`);
  console.log("");
  console.log("=== WHAT THEY RECEIVE BY EMAIL ===");
  console.log(result.alreadyProvisioned
    ? "(already provisioned earlier — no new email)"
    : "Subject: Your AIStaff account is ready");
  console.log("");
  console.log("Set-password link (also emailed):");
  console.log(result.setupUrl || "(none — user already existed)");
  console.log("");
  console.log("Then they sign in at: " + (process.env.APP_URL || "https://aistaff.click") + "/admin/login");

  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error("Failed:", error.message);
  await prisma.$disconnect();
  process.exit(1);
});
