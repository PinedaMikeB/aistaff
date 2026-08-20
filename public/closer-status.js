
/* ===========================================================================
 * Closer status indicator (2026-08-18)
 *
 * Built after the quotation incident: the Page was silent for hours and the
 * only evidence was a stack trace in a log nobody watches. The point of this
 * pill is that the owner finds out from the dashboard, not from a customer.
 *
 * Status is derived server-side from real signals, never a stored flag — a
 * stale "working" badge is worse than no badge.
 * ========================================================================= */

const closerStatusState = { last: null, timer: null };

const CLOSER_STATUS_TEXT = {
  working: "Closer is replying",
  attention: "Closer needs setup",
  down: "Closer is not replying",
  unknown: "Checking…"
};

/** Plain-language reasons. Facts come from the server; wording lives here. */
function closerReasonText(reason) {
  switch (reason.code) {
    case "reply_failures":
      return `${reason.count} repl${reason.count === 1 ? "y" : "ies"} failed in the last ${reason.windowMinutes} minutes.`;
    case "no_page_connected":
      return "No Facebook Page is connected, so messages cannot reach Closer.";
    case "ai_disabled":
      return "AI is switched off in Settings.";
    case "auto_reply_disabled":
      return "Auto-reply is switched off, so Closer drafts but does not send.";
    case "no_knowledge":
      return "The knowledge base is empty, so Closer has nothing to answer from.";
    default:
      return reason.code;
  }
}

async function refreshCloserStatus() {
  const pill = document.getElementById("closerStatus");
  const label = document.getElementById("closerStatusLabel");
  if (!pill || !label) return;

  let health;
  try {
    health = await api("/api/closer/health");
  } catch {
    // A failed health check is not itself an outage — say nothing rather than
    // cry wolf over a dropped request.
    return;
  }

  pill.className = `closer-status is-${health.status}`;
  label.textContent = CLOSER_STATUS_TEXT[health.status] || CLOSER_STATUS_TEXT.unknown;
  pill.title = health.reasons.length
    ? health.reasons.map(closerReasonText).join(" ")
    : `Connected to ${health.pageName || "your Page"} · ${health.knowledgeCount} knowledge entries`;

  // Alert on the TRANSITION into a bad state, not on every poll — an alert
  // that fires every 60 seconds is one people learn to ignore.
  const previous = closerStatusState.last;
  if (health.status === "down" && previous && previous !== "down") {
    toast(`Closer stopped replying. ${health.reasons.map(closerReasonText).join(" ")}`);
  }
  closerStatusState.last = health.status;

  pill.onclick = () => {
    if (!health.reasons.length) {
      toast(`Closer is replying on ${health.pageName || "your Page"}.`);
      return;
    }
    toast(health.reasons.map(closerReasonText).join(" "));
  };
}

function startCloserStatusPolling() {
  if (closerStatusState.timer) return;
  refreshCloserStatus();
  closerStatusState.timer = setInterval(refreshCloserStatus, 60000);
}

(function injectCloserStatusStyles() {
  const css = `
  .closer-status { display: inline-flex; align-items: center; gap: 8px; padding: 8px 14px; border: 1px solid rgba(120,130,160,.25);
    border-radius: 99px; background: #fff; font: 600 12px inherit; cursor: pointer; color: #35405a; }
  .closer-status-dot { width: 8px; height: 8px; border-radius: 50%; background: #98a1ad; flex: 0 0 auto; }
  .closer-status.is-working { border-color: #bfe6cf; background: #f1faf4; color: #22694a; }
  .closer-status.is-working .closer-status-dot { background: #2f9e63; }
  .closer-status.is-attention { border-color: #f0dcb4; background: #fff8ec; color: #85601a; }
  .closer-status.is-attention .closer-status-dot { background: #d99b24; }
  .closer-status.is-down { border-color: #f2c4c4; background: #fff5f5; color: #a32b2b; }
  .closer-status.is-down .closer-status-dot { background: #cf4b4b; animation: closerPulse 1.4s ease-in-out infinite; }
  @keyframes closerPulse { 0%,100% { opacity: 1; } 50% { opacity: .35; } }
  @media (max-width: 900px) { .closer-status span:last-child { display: none; } .closer-status { padding: 8px; } }
  `;
  const tag = document.createElement("style");
  tag.textContent = css;
  document.head.appendChild(tag);
})();
