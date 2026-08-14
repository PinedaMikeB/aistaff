/**
 * Turn a paid order into a usable account.
 *
 * THE GAP THIS CLOSES: checkout creates Customer + Order + Subscription, and
 * the Xendit webhook marks them paid — but nothing ever created a Company or a
 * User. So the moment after a customer paid successfully, they had nothing to
 * log into, and someone had to run `npm run create:client` by hand.
 *
 * DESIGN NOTES
 *
 * - Idempotent. Webhooks retry, and Xendit may deliver the same PAID event
 *   more than once. Provisioning twice would create two companies and orphan
 *   the first, so every step checks before it creates.
 * - No password is ever chosen for the customer. A random one is stored so the
 *   column is satisfied, then they get a set-password link through the normal
 *   reset flow. Emailing a password we generated would put a working
 *   credential in an inbox forever — the same mistake as the ChangeMe123!
 *   default that shipped live on the login page.
 * - Never throws into the webhook. A failure here must not make Xendit retry a
 *   payment that was already recorded; it logs and leaves the order paid so it
 *   can be provisioned by hand.
 */

const crypto = require("crypto");
const { prisma } = require("./db");
const { hashPassword } = require("./auth");
const {
  hashToken, newRawToken, isEmailConfigured, createTransport, appUrl,
  TOKEN_TTL_MINUTES
} = require("./password-reset");
const { BUSINESS_IDENTITY } = require("./payments");

/** Set-password links are longer-lived than a reset — this is onboarding. */
const SETUP_TOKEN_TTL_HOURS = 72;

function companyNameFor(customer) {
  const business = String(customer.business_name || customer.company_name || "").trim();
  if (business) return business;
  const person = String(customer.full_name || "").trim();
  return person ? `${person}'s Business` : "New Client";
}

module.exports = { SETUP_TOKEN_TTL_HOURS, companyNameFor };

/** Next free account number, AIS-YYYY-NNNN, matching the backfill format. */
async function nextAccountNumber(tx) {
  const year = new Date().getFullYear();
  const prefix = `AIS-${year}-`;
  const last = await tx.company.findFirst({
    where: { account_number: { startsWith: prefix } },
    orderBy: { account_number: "desc" },
    select: { account_number: true }
  });
  const n = last ? Number(String(last.account_number).slice(prefix.length)) + 1 : 1;
  return prefix + String(n).padStart(4, "0");
}

/**
 * Provision a tenant for a paid order.
 *
 * @returns {Promise<{ok:boolean, reason?:string, companyId?:string, userId?:string,
 *                    accountNumber?:string, setupUrl?:string, alreadyProvisioned?:boolean}>}
 */
async function provisionPaidOrder(orderId) {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: { customer: true, subscriptions: true }
    });
    if (!order) return { ok: false, reason: "order_not_found" };
    if (order.payment_status !== "paid") return { ok: false, reason: "order_not_paid" };

    const customer = order.customer;
    if (!customer || !customer.email) return { ok: false, reason: "no_customer_email" };
    const email = String(customer.email).trim().toLowerCase();

    // Already done? Webhooks retry; provisioning twice would strand a company.
    const linked = order.subscriptions.find((s) => s.company_id);
    if (linked) {
      return { ok: true, alreadyProvisioned: true, companyId: linked.company_id };
    }

    // Returning buyer: attach the new subscription to the company they already
    // own rather than creating a second one. User.email is globally unique, so
    // creating another would fail anyway.
    const existingUser = await prisma.user.findUnique({
      where: { email },
      select: { id: true, company_id: true }
    });

    const result = await prisma.$transaction(async (tx) => {
      let companyId = existingUser ? existingUser.company_id : null;
      let userId = existingUser ? existingUser.id : null;
      let accountNumber = null;

      if (!companyId) {
        accountNumber = await nextAccountNumber(tx);
        const company = await tx.company.create({
          data: {
            name: companyNameFor(customer),
            account_number: accountNumber,
            industry: customer.industry || null,
            website: customer.business_website || null,
            contact_email: email,
            contact_number: customer.mobile_number || null,
            status: "active"
          }
        });
        companyId = company.id;

        // A random password nobody knows. The customer sets their own via the
        // link below; this only satisfies the non-null column.
        const placeholder = await hashPassword(crypto.randomBytes(24).toString("base64url"));
        const user = await tx.user.create({
          data: {
            company_id: companyId,
            name: customer.full_name || "Owner",
            email,
            password_hash: placeholder,
            role: "owner"
          }
        });
        userId = user.id;

        // Onboarding status reads this; without it the dashboard looks broken
        // on first login.
        await tx.companySetting.upsert({
          where: { company_id: companyId },
          update: {},
          create: { company_id: companyId }
        });
      } else {
        const company = await tx.company.findUnique({
          where: { id: companyId },
          select: { account_number: true }
        });
        accountNumber = company && company.account_number;
      }

      // The link the whole migration was for: this payment provisioned THIS
      // workspace.
      await tx.subscription.updateMany({
        where: { order_id: order.id },
        data: { company_id: companyId }
      });

      return { companyId, userId, accountNumber };
    });

    const setupUrl = await issueSetupLink(result.userId, existingUser ? "returning" : "new");
    return { ok: true, ...result, setupUrl };
  } catch (error) {
    console.error("[provisioning] failed:", error.message);
    return { ok: false, reason: "provisioning_failed", detail: error.message };
  }
}

/**
 * Issue a set-password link, reusing the password-reset token table.
 *
 * Same security properties as a reset: only sha256(token) is stored, single
 * use, and redeeming it bumps session_epoch. Returning users get one too — if
 * they have forgotten their password, this is the gentlest way back in.
 */
async function issueSetupLink(userId, kind) {
  if (!userId) return null;
  const rawToken = newRawToken();
  await prisma.passwordResetToken.create({
    data: {
      user_id: userId,
      token_hash: hashToken(rawToken),
      expires_at: new Date(Date.now() + SETUP_TOKEN_TTL_HOURS * 60 * 60 * 1000)
    }
  });
  const url = `${appUrl()}/admin/reset-password?token=${rawToken}`;
  await sendWelcomeEmail(userId, url, kind);
  return url;
}

/**
 * Welcome + set password. Never throws: a mail outage must not undo a
 * provisioning that already succeeded — the link is returned to the caller and
 * shows in the admin, so it can be resent by hand.
 */
async function sendWelcomeEmail(userId, setupUrl, kind) {
  try {
    if (!isEmailConfigured()) {
      console.warn("[provisioning] SMTP not configured; welcome email not sent");
      return;
    }
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { email: true, name: true, company: { select: { name: true, account_number: true } } }
    });
    if (!user) return;

    const brand = BUSINESS_IDENTITY.brandName || "AIStaff";
    const lines = [
      `Hi ${user.name || "there"},`,
      "",
      `Your ${brand} account is ready.`,
      "",
      `Workspace: ${user.company.name}`,
      user.company.account_number ? `Account number: ${user.company.account_number}` : "",
      "",
      kind === "returning"
        ? "This was added to the workspace you already have. Sign in as usual — and if you need to reset your password, use the link below."
        : "Set your password here to sign in for the first time:",
      setupUrl,
      "",
      `The link works once and expires in ${SETUP_TOKEN_TTL_HOURS} hours. If it lapses, use "Forgot password" on the sign-in page.`,
      "",
      "We'll be in touch shortly to set up your knowledge base and connect your Facebook Page.",
      "",
      brand
    ].filter((line) => line !== "");

    await createTransport().sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to: user.email,
      subject: `Your ${brand} account is ready`,
      text: lines.join("\n")
    });
  } catch (error) {
    console.error("[provisioning] welcome email failed:", error.message);
  }
}

module.exports.nextAccountNumber = nextAccountNumber;
module.exports.provisionPaidOrder = provisionPaidOrder;
module.exports.issueSetupLink = issueSetupLink;
