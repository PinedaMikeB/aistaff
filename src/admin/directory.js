// Tenant + user directory queries for the Super Admin area.
//
// IMPORTANT data-model note (do not paper over this): this repo has two
// parallel identities that are NOT directly linked by a foreign key —
//   - Company/User  = the tenant workspace (Messenger inbox, leads, etc.)
//   - Customer/Order/Subscription = the AIStaff *billing* identity (the
//     commerce/checkout system in src/payments.js), linked via User.id, not
//     Company.id.
// So "which pricing plan is this tenant on" cannot be resolved with a single
// clean join. Below this is resolved best-effort (through any user of the
// company who also has a Customer record with an active subscription) and
// explicitly reported as "Not linked" when it can't be resolved, rather than
// guessed or fabricated. This gap is called out in the deliverables report.

// Lazily required (not at module top-level) so that simply requiring this
// file for its constants (e.g. SAFE_USER_SELECT, in tests) never forces a
// Prisma client construction / DB connection attempt.
function db() { return require("../db").prisma; }

const SAFE_USER_SELECT = {
  id: true,
  name: true,
  email: true,
  role: true,
  platform_role: true,
  status: true,
  mfa_enabled: true,
  last_login_at: true,
  created_at: true,
  company_id: true,
  company: { select: { id: true, name: true } }
};

async function listTenants({ limit = 100 } = {}) {
  const companies = await db().company.findMany({
    orderBy: { created_at: "desc" },
    take: Math.min(Math.max(Number(limit) || 100, 1), 500),
    select: {
      id: true,
      name: true,
      status: true,
      created_at: true,
      _count: { select: { users: true } }
    }
  });

  const results = [];
  for (const company of companies) {
    const [recentConversation, planInfo] = await Promise.all([
      db().conversation.findFirst({
        where: { company_id: company.id },
        orderBy: { last_message_at: "desc" },
        select: { last_message_at: true }
      }),
      resolveBestEffortPlan(company.id)
    ]);

    results.push({
      tenantId: company.id,
      tenantName: company.name,
      status: company.status,
      plan: planInfo,
      memberCount: company._count.users,
      recentActivityAt: recentConversation?.last_message_at || null,
      brandeeUsage: "Not tracked per tenant — Brandee is currently a pre-tenant public tool (see admin deliverables notes).",
      lastPlanGenerationStatus: "Not applicable — no tenant-linked Brandee runs exist yet.",
      createdAt: company.created_at
    });
  }
  return results;
}

async function resolveBestEffortPlan(companyId) {
  try {
    const userWithSub = await db().user.findFirst({
      where: { company_id: companyId, customers: { some: { subscriptions: { some: { status: "active" } } } } },
      select: {
        customers: {
          select: { subscriptions: { where: { status: "active" }, select: { pricing_plan: { select: { name: true } } }, take: 1 } },
          take: 1
        }
      }
    });
    const planName = userWithSub?.customers?.[0]?.subscriptions?.[0]?.pricing_plan?.name;
    return planName || "Not linked";
  } catch {
    return "Not linked";
  }
}

async function getTenantById(tenantId) {
  return db().company.findUnique({
    where: { id: tenantId },
    select: {
      id: true, name: true, status: true, industry: true, website: true,
      contact_email: true, contact_number: true, created_at: true, updated_at: true,
      _count: { select: { users: true, leads: true, conversations: true } }
    }
  });
}

async function setTenantStatus(tenantId, status) {
  return db().company.update({ where: { id: tenantId }, data: { status } });
}

async function listUsers({ limit = 200 } = {}) {
  return db().user.findMany({
    orderBy: { created_at: "desc" },
    take: Math.min(Math.max(Number(limit) || 200, 1), 1000),
    select: SAFE_USER_SELECT
  });
}

async function getUserById(userId) {
  return db().user.findUnique({ where: { id: userId }, select: SAFE_USER_SELECT });
}

async function setUserStatus(userId, status) {
  return db().user.update({ where: { id: userId }, data: { status }, select: SAFE_USER_SELECT });
}

async function setPlatformRole(userId, platformRole) {
  return db().user.update({ where: { id: userId }, data: { platform_role: platformRole }, select: SAFE_USER_SELECT });
}

module.exports = {
  SAFE_USER_SELECT,
  listTenants,
  getTenantById,
  setTenantStatus,
  listUsers,
  getUserById,
  setUserStatus,
  setPlatformRole
};
