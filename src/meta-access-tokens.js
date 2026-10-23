const DEFAULT_GRAPH_VERSION = "v20.0";

function metaGraphVersion() {
  return String(process.env.META_GRAPH_VERSION || DEFAULT_GRAPH_VERSION).trim() || DEFAULT_GRAPH_VERSION;
}

function metaErrorMessage(payload, fallback) {
  return String(payload?.error?.message || fallback || "Facebook authorization failed.");
}

/**
 * Facebook's authorization-code exchange returns a short-lived user token.
 * Page tokens requested from that temporary credential inherit its fragile
 * session lifetime. Exchange it first, then request /me/accounts with the
 * long-lived credential so the saved Page token is suitable for an ongoing
 * Messenger connection.
 *
 * We intentionally do not persist the user token. It exists only long enough
 * to derive Page tokens and is then discarded from server memory.
 */
async function exchangeForLongLivedMetaUserToken({
  shortLivedToken,
  appId,
  appSecret,
  fetchImpl = global.fetch
}) {
  if (!shortLivedToken) throw new Error("Facebook did not return a temporary access token.");
  if (!appId || !appSecret) throw new Error("Facebook application credentials are not configured.");
  if (typeof fetchImpl !== "function") throw new Error("No HTTP client is available for Facebook authorization.");

  const url = new URL(`https://graph.facebook.com/${metaGraphVersion()}/oauth/access_token`);
  url.searchParams.set("grant_type", "fb_exchange_token");
  url.searchParams.set("client_id", appId);
  url.searchParams.set("client_secret", appSecret);
  url.searchParams.set("fb_exchange_token", shortLivedToken);

  const response = await fetchImpl(url);
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || !payload?.access_token) {
    const error = new Error(metaErrorMessage(payload, `Facebook long-lived token exchange failed (HTTP ${response.status}).`));
    error.metaCode = payload?.error?.code || null;
    error.metaSubcode = payload?.error?.error_subcode || null;
    throw error;
  }

  return {
    accessToken: String(payload.access_token),
    expiresIn: Number(payload.expires_in || 0) || null,
    tokenType: String(payload.token_type || "bearer")
  };
}

/**
 * Ask Meta what kind of credential this is (debug_token, signed with the app
 * token). Used to tell a person-bound USER token apart from a SYSTEM_USER token.
 *
 * WHY: every Page token derived from a person's USER token dies the moment that
 * person's Facebook session is reset (error 190 / subcode 460). Production saw
 * this repeatedly with Marga: connected -> 1-4 hours of replies -> 460. A
 * SYSTEM_USER token (Facebook Login for Business "System-user access token"
 * configuration, or a system user created in the client's Business Portfolio)
 * belongs to the business, not to the rep who clicked Connect, so it survives
 * that rep's password changes, logouts and security checkpoints.
 */
async function inspectMetaToken({ token, appId, appSecret, fetchImpl = global.fetch }) {
  if (!token || !appId || !appSecret || typeof fetchImpl !== "function") return null;
  const url = new URL(`https://graph.facebook.com/${metaGraphVersion()}/debug_token`);
  url.searchParams.set("input_token", token);
  url.searchParams.set("access_token", `${appId}|${appSecret}`);
  try {
    const response = await fetchImpl(url);
    const payload = await response.json().catch(() => ({}));
    const data = payload?.data;
    if (!response.ok || !data) return null;
    return {
      type: String(data.type || "").toUpperCase() || null,
      isValid: Boolean(data.is_valid),
      expiresAt: Number(data.expires_at || 0),
      dataAccessExpiresAt: Number(data.data_access_expires_at || 0),
      userId: data.user_id ? String(data.user_id) : null,
      profileId: data.profile_id ? String(data.profile_id) : null,
      scopes: Array.isArray(data.scopes) ? data.scopes.map(String) : [],
      error: data.error ? { code: data.error.code, subcode: data.error.subcode, message: data.error.message } : null
    };
  } catch {
    return null;
  }
}

/** True when the credential does not depend on any person's Facebook login. */
function isSystemUserToken(info) {
  return Boolean(info && info.type === "SYSTEM_USER");
}

module.exports = {
  DEFAULT_GRAPH_VERSION,
  metaGraphVersion,
  exchangeForLongLivedMetaUserToken,
  inspectMetaToken,
  isSystemUserToken
};
