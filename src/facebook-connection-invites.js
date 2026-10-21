const crypto = require("crypto");
const { prisma } = require("./db");

const INVITE_TTL_HOURS = 24;

function newInviteToken() {
  return crypto.randomBytes(32).toString("hex");
}

function hashInviteToken(rawToken) {
  return crypto.createHash("sha256").update(String(rawToken || "")).digest("hex");
}

async function createFacebookConnectionInvite({ company, user }) {
  const rawToken = newInviteToken();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + INVITE_TTL_HOURS * 60 * 60 * 1000);

  // One clear current link per client. Revocation is explicit and audited in
  // the row instead of deleting history or allowing two competing links.
  await prisma.facebookConnectionInvite.updateMany({
    where: {
      company_id: company.id,
      used_at: null,
      revoked_at: null,
      expires_at: { gt: now }
    },
    data: { revoked_at: now }
  });

  const invite = await prisma.facebookConnectionInvite.create({
    data: {
      company_id: company.id,
      company_name: company.name,
      token_hash: hashInviteToken(rawToken),
      created_by_user_id: user.id,
      created_by_email: user.email,
      expires_at: expiresAt
    },
    select: { id: true, company_id: true, company_name: true, expires_at: true }
  });

  return { ...invite, rawToken };
}

async function readFacebookConnectionInvite(rawToken) {
  if (!rawToken) return { ok: false, code: "invalid" };
  const invite = await prisma.facebookConnectionInvite.findUnique({
    where: { token_hash: hashInviteToken(rawToken) }
  });
  if (!invite) return { ok: false, code: "invalid" };
  if (invite.revoked_at) return { ok: false, code: "revoked" };
  if (invite.used_at) return { ok: false, code: "used", invite };
  if (invite.expires_at.getTime() <= Date.now()) return { ok: false, code: "expired", invite };
  return { ok: true, invite };
}

async function claimFacebookConnectionInvite(inviteId) {
  const claimedAt = new Date();
  const result = await prisma.facebookConnectionInvite.updateMany({
    where: {
      id: inviteId,
      used_at: null,
      revoked_at: null,
      expires_at: { gt: claimedAt }
    },
    data: { used_at: claimedAt }
  });
  return result.count === 1 ? claimedAt : null;
}

async function releaseFacebookConnectionInvite(inviteId, claimedAt) {
  await prisma.facebookConnectionInvite.updateMany({
    where: { id: inviteId, used_at: claimedAt, connected_page_id: null },
    data: { used_at: null }
  });
}

async function completeFacebookConnectionInvite(inviteId, claimedAt, page) {
  const result = await prisma.facebookConnectionInvite.updateMany({
    where: { id: inviteId, used_at: claimedAt, connected_page_id: null },
    data: {
      connected_page_id: page.page_id,
      connected_page_name: page.page_name
    }
  });
  return result.count === 1;
}

module.exports = {
  INVITE_TTL_HOURS,
  hashInviteToken,
  createFacebookConnectionInvite,
  readFacebookConnectionInvite,
  claimFacebookConnectionInvite,
  releaseFacebookConnectionInvite,
  completeFacebookConnectionInvite
};
