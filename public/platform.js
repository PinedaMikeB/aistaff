/* ===========================================================================
 * PLATFORM (2026-08-19) — AIStaff staff managing all customers.
 *
 * Deliberately looks different from /admin. /admin is ONE workspace; this sits
 * above workspaces, and a staff member should never be unsure which hat they
 * are wearing — especially before entering someone else's account.
 * ========================================================================= */

const platformState = { me: null, customers: [], assisting: null, customerStatusFilter: "active" };

/** Colour and wording for setup progress, so the queue reads at a glance. */
function setupTone(percent) {
  if (percent >= 100) return "is-ok";
  if (percent >= 50) return "is-mid";
  return "is-low";
}

const CUSTOMER_STATUS_LABELS = {
  active: "Active",
  inactive: "Inactive"
};

function statusLabel(status) {
  return CUSTOMER_STATUS_LABELS[status] || status || "Unknown";
}

function customerStatusOptions(current) {
  const statuses = ["active", "inactive"];
  if (current && !statuses.includes(current)) statuses.push(current);
  return statuses.map((status) => `<option value="${escapeHtml(status)}" ${status === current ? "selected" : ""}>${escapeHtml(statusLabel(status))}</option>`).join("");
}

function customerStatusCell(c, canChangeStatus) {
  if (!canChangeStatus) {
    return `<span class="plat-pill ${c.status === "active" ? "is-ok" : "is-low"}">${escapeHtml(statusLabel(c.status))}</span>`;
  }
  return `
    <select class="plat-status-select" data-status-for="${escapeHtml(c.id)}" data-current-status="${escapeHtml(c.status || "")}">
      ${customerStatusOptions(c.status)}
    </select>`;
}

function customerNeedsAttention(c) {
  return c.setupPercent < 100 || !c.pageConnected || c.openGaps;
}

function customersForCurrentFilter() {
  const filter = platformState.customerStatusFilter || "active";
  if (filter === "all") return platformState.customers;
  return platformState.customers.filter((c) => (c.status || "inactive") === filter);
}

function customerRow(c, me) {
  const needs = [];
  if (!c.pageConnected) needs.push("No Page connected");
  if (c.setupPercent < 100) needs.push(`Setup ${c.setupPercent}%`);
  if (c.openGaps) needs.push(`${c.openGaps} unanswered`);
  if (!c.aiEnabled) needs.push("AI off");

  return `
    <tr>
      <td>
        <b>${escapeHtml(c.name)}</b>
        <div class="muted">${escapeHtml(c.accountNumber || "—")}${c.contactPerson ? ` · ${escapeHtml(c.contactPerson)}` : ""}</div>
      </td>
      <td>${customerStatusCell(c, me.can.customersStatus)}</td>
      <td>
        <div class="plat-bar ${setupTone(c.setupPercent)}"><span style="width:${c.setupPercent}%"></span></div>
        <div class="muted">${c.setupPercent}% · ${c.knowledgeCount} entries</div>
      </td>
      <td>${c.pageConnected ? `<span class="plat-pill is-ok">${escapeHtml(c.pageName || "connected")}</span>` : `<span class="plat-pill is-low">not connected</span>`}</td>
      <td>${c.conversations}${c.openGaps ? ` <span class="plat-pill is-warn">${c.openGaps} gaps</span>` : ""}</td>
      <td class="muted">${c.lastMessageAt ? fmtDate(c.lastMessageAt) : "never"}</td>
      <td>${needs.length ? `<span class="muted">${escapeHtml(needs.join(" · "))}</span>` : `<span class="plat-pill is-ok">healthy</span>`}</td>
      <td>${me.can.customersAssist ? `<button type="button" class="intake-link" data-assist="${c.id}" data-name="${escapeHtml(c.name)}">Assist →</button>` : ""}</td>
    </tr>`;
}

function renderPlatformStats() {
  const activeCustomers = platformState.customers.filter((c) => c.status === "active");
  const inactiveCustomers = platformState.customers.filter((c) => c.status !== "active");
  const set = (id, value) => {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  };
  set("platformActiveCount", activeCustomers.length);
  set("platformInactiveCount", inactiveCustomers.length);
  set("platformNeedsCount", activeCustomers.filter(customerNeedsAttention).length);
  set("platformOpenGapsCount", activeCustomers.reduce((n, c) => n + c.openGaps, 0));
}

function renderPlatformCustomerRows() {
  const body = document.getElementById("platformCustomerRows");
  if (!body) return;
  const customers = customersForCurrentFilter();
  body.innerHTML = customers.length
    ? customers.map((c) => customerRow(c, platformState.me)).join("")
    : `<tr><td colspan="8" class="muted">No customers match this filter.</td></tr>`;
  wirePlatformCustomerActions();
}

async function platformView() {
  setTitle("Platform");
  let me;
  try {
    me = await api("/api/platform/me");
  } catch {
    // Not a platform user. Send them to their own dashboard rather than
    // showing an error page for an area they should not know exists.
    history.replaceState(null, "", adminPath("dashboard"));
    return dashboardView();
  }
  platformState.me = me;

  const { customers } = await api("/api/platform/customers");
  platformState.customers = customers;

  const activeCustomers = customers.filter((c) => c.status === "active");
  const inactiveCustomers = customers.filter((c) => c.status !== "active");
  const needsAttention = activeCustomers.filter(customerNeedsAttention);

  $("#adminContent").innerHTML = `
    <div class="platform-banner">
      <div>
        <b>AIStaff Platform</b>
        <span class="muted">managing all customers · signed in as ${escapeHtml(me.email)} (${escapeHtml(me.role)})</span>
      </div>
      <a class="button button-soft" href="${adminPath("dashboard")}">My workspace →</a>
    </div>

    <div class="stat-grid">
      <div class="panel stat"><p class="muted">Active customers</p><b id="platformActiveCount">${activeCustomers.length}</b></div>
      <div class="panel stat"><p class="muted">Inactive / hidden</p><b id="platformInactiveCount">${inactiveCustomers.length}</b></div>
      <div class="panel stat"><p class="muted">Need attention</p><b id="platformNeedsCount">${needsAttention.length}</b></div>
      <div class="panel stat"><p class="muted">Open gaps</p><b id="platformOpenGapsCount">${activeCustomers.reduce((n, c) => n + c.openGaps, 0)}</b></div>
    </div>

    <section class="panel">
      <div class="platform-section-head">
        <div>
          <h2>Customers</h2>
          <p class="muted settings-lede">Active customers are shown by default. "Assist" opens their workspace — every entry is logged.</p>
        </div>
        <label class="platform-filter">Show
          <select id="customerStatusFilter">
            <option value="active" ${platformState.customerStatusFilter === "active" ? "selected" : ""}>Active customers</option>
            <option value="inactive" ${platformState.customerStatusFilter === "inactive" ? "selected" : ""}>Inactive / hidden</option>
            <option value="all" ${platformState.customerStatusFilter === "all" ? "selected" : ""}>All customers</option>
          </select>
        </label>
      </div>
      <div class="table-wrap"><table>
        <thead><tr><th>Customer</th><th>Status</th><th>Setup</th><th>Page</th><th>Conversations</th><th>Last message</th><th>Needs</th><th></th></tr></thead>
        <tbody id="platformCustomerRows"></tbody>
      </table></div>
    </section>

    ${me.can.users ? `<div id="staffHolder"></div>` : ""}

    ${me.can.customersView ? `
      <section class="panel">
        <h2>Assist log</h2>
        <p class="muted settings-lede">Who has entered whose workspace. Customers trust AIStaff with their conversations; this is the record that makes that defensible.</p>
        <div id="assistLog" class="muted">Loading…</div>
      </section>` : ""}`;

  wirePlatform();
  renderPlatformCustomerRows();
  loadAssistLog();
  if (me.can.users) loadStaffPanel();
}

function wirePlatform() {
  const filter = document.getElementById("customerStatusFilter");
  if (filter) {
    filter.onchange = () => {
      platformState.customerStatusFilter = filter.value;
      renderPlatformCustomerRows();
    };
  }
  wirePlatformCustomerActions();
}

function wirePlatformCustomerActions() {
  document.querySelectorAll("[data-assist]").forEach((btn) => {
    btn.onclick = async () => {
      const name = btn.dataset.name;
      // Ask for a reason. Not bureaucracy — an audit line reading "fixing
      // shipping rates" is worth far more later than a bare timestamp.
      const reason = window.prompt(`Enter ${name}'s workspace to help.\n\nWhat are you helping with? (recorded in the assist log)`, "");
      if (reason === null) return;
      await api(`/api/platform/assist/${btn.dataset.assist}`, { method: "POST", body: { reason } });
      toast(`Now assisting ${name}`);
      history.pushState(null, "", adminPath("dashboard"));
      await loadSession();
      routeHandler();
    };
  });

  document.querySelectorAll("[data-status-for]").forEach((sel) => {
    sel.onchange = async () => {
      const customer = platformState.customers.find((c) => c.id === sel.dataset.statusFor);
      const previous = sel.dataset.currentStatus;
      const next = sel.value;
      if (!customer || next === previous) return;
      const ok = window.confirm(`Set ${customer.name} to ${statusLabel(next)}?\n\nInactive customers are hidden from the default Platform customer list.`);
      if (!ok) {
        sel.value = previous;
        return;
      }
      sel.disabled = true;
      try {
        await api(`/api/platform/customers/${customer.id}/status`, { method: "PUT", body: { status: next } });
        customer.status = next;
        toast(`${customer.name} is now ${statusLabel(next)}`);
        renderPlatformStats();
        renderPlatformCustomerRows();
      } catch (error) {
        toast(error.message);
        sel.disabled = false;
        sel.value = previous;
      }
    };
  });
}

async function loadAssistLog() {
  const box = $("#assistLog");
  if (!box) return;
  try {
    const { sessions } = await api("/api/platform/assist-log");
    box.innerHTML = sessions.length
      ? `<div class="table-wrap"><table>
          <thead><tr><th>Staff</th><th>Customer</th><th>Reason</th><th>Started</th><th>Ended</th></tr></thead>
          <tbody>${sessions.map((s) => `<tr>
            <td>${escapeHtml(s.staff_email)}</td>
            <td>${escapeHtml(s.company_name)}</td>
            <td>${escapeHtml(s.reason || "—")}</td>
            <td class="muted">${fmtDate(s.started_at)}</td>
            <td class="muted">${s.ended_at ? fmtDate(s.ended_at) : "still in"}</td>
          </tr>`).join("")}</tbody>
        </table></div>`
      : `<p class="muted">Nobody has assisted a customer yet.</p>`;
  } catch {
    box.textContent = "Could not load the assist log.";
  }
}

/**
 * Persistent banner while assisting. The whole safeguard is that a staff
 * member always knows they are inside someone else's account — a silent
 * impersonation is how mistakes get made in the wrong workspace.
 */
async function renderAssistBanner() {
  if (!state.user?.platform_role) return;
  const own = state.user.company_id;
  const current = state.company?.id;
  const existing = document.getElementById("assistBanner");

  if (!current || !own || current === own) {
    if (existing) existing.remove();
    return;
  }
  if (existing) return;

  const bar = document.createElement("div");
  bar.id = "assistBanner";
  bar.className = "assist-banner";
  bar.innerHTML = `
    <span>You are assisting <b>${escapeHtml(state.company.name)}</b> — changes affect their live account.</span>
    <button type="button" id="assistExit">Exit to my workspace</button>`;
  document.body.prepend(bar);
  document.getElementById("assistExit").onclick = async () => {
    await api("/api/platform/assist/exit", { method: "POST", body: {} });
    await loadSession();
    bar.remove();
    history.pushState(null, "", adminPath("dashboard"));
    routeHandler();
    toast("Back in your own workspace");
  };
}

(function injectPlatformStyles() {
  const css = `
  .platform-banner { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap;
    padding: 14px 18px; margin-bottom: 16px; border-radius: 12px;
    background: linear-gradient(135deg, #1a2233, #2b3550); color: #fff; }
	  .platform-banner b { display: block; font-size: 15px; }
	  .platform-banner .muted { color: rgba(255,255,255,.7); font-size: 12px; }
	  .platform-banner .button { background: rgba(255,255,255,.14); color: #fff; border: 0; }
	  .platform-section-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
	  .platform-filter { display: flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700; color: #6a7382; }
	  .platform-filter select, .plat-status-select { min-width: 150px; border: 1px solid var(--line); border-radius: 8px; padding: 8px 10px; background: #fff; font: inherit; color: var(--ink); }
	  .plat-status-select { min-width: 118px; }

	  .plat-bar { height: 6px; border-radius: 99px; background: rgba(120,130,160,.2); overflow: hidden; width: 120px; }
	  .plat-bar > span { display: block; height: 100%; border-radius: 99px; }
  .plat-bar.is-ok > span { background: #2f9e63; }
  .plat-bar.is-mid > span { background: #d99b24; }
  .plat-bar.is-low > span { background: #cf4b4b; }

  .plat-pill { display: inline-block; padding: 2px 9px; border-radius: 99px; font: 700 11px inherit; }
  .plat-pill.is-ok { background: #e7f6ec; color: #22694a; }
  .plat-pill.is-warn { background: #fff3d6; color: #8a5a00; }
  .plat-pill.is-low { background: #ffe9e9; color: #a32b2b; }

  /* Assist banner: deliberately loud. Being unaware you are inside someone
     else's account is exactly the failure this prevents. */
  .assist-banner { position: sticky; top: 0; z-index: 100; display: flex; align-items: center;
    justify-content: space-between; gap: 12px; flex-wrap: wrap;
    padding: 10px 16px; background: #8a2b2b; color: #fff; font-size: 13px; font-weight: 600; }
  .assist-banner button { border: 0; border-radius: 8px; padding: 7px 14px; cursor: pointer;
    background: rgba(255,255,255,.18); color: #fff; font: inherit; }
  .assist-banner button:hover { background: rgba(255,255,255,.3); }
  .role-help { margin: 14px 0 0; padding-left: 18px; font-size: 12px; line-height: 1.9; color: #6a7382; }

	  @media (max-width: 760px) {
	    .plat-bar { width: 80px; }
	    .platform-banner { flex-direction: column; align-items: flex-start; }
	    .platform-section-head { align-items: stretch; }
	    .platform-filter { justify-content: space-between; }
	  }
  `;
  const tag = document.createElement("style");
  tag.textContent = css;
  document.head.appendChild(tag);
})();

/* ---- Staff management. Only `admin` sees this (platform.users). ---- */

const ROLE_HELP = {
  admin: "Everything: staff, pricing, global prompt, models, customers.",
  manager: "Customers only: view, assist, help with knowledge bases.",
  support: "Customers, plus the global prompt and model switching."
};

function staffPanel(users) {
  return `
    <section class="panel">
      <h2>AIStaff staff</h2>
      <p class="muted settings-lede">New staff get a set-your-password email — nobody types a password on someone else's behalf.</p>

      <div class="table-wrap"><table>
        <thead><tr><th>Person</th><th>Platform role</th><th>Last sign-in</th><th>Status</th><th></th></tr></thead>
        <tbody>${users.map((u) => `
          <tr data-user="${u.id}">
            <td><b>${escapeHtml(u.name || "—")}</b><div class="muted">${escapeHtml(u.email)}</div></td>
            <td>
              <select data-role-for="${u.id}">
                ${["admin", "manager", "support"].map((r) => `<option value="${r}" ${r === u.platform_role ? "selected" : ""}>${r}</option>`).join("")}
              </select>
            </td>
            <td class="muted">${u.last_login_at ? fmtDate(u.last_login_at) : "never"}</td>
            <td>${u.status === "active" ? `<span class="plat-pill is-ok">active</span>` : `<span class="plat-pill is-low">${escapeHtml(u.status)}</span>`}</td>
            <td><button type="button" class="intake-link is-danger" data-revoke="${u.id}">Remove access</button></td>
          </tr>`).join("")}</tbody>
      </table></div>

      <h3 class="settings-group">Add someone</h3>
      <form id="staffForm" class="form-grid">
        <label>Name<input type="text" name="name" required placeholder="Irene Pineda" /></label>
        <label>Email<input type="email" name="email" required placeholder="ipineda@aistaff.click" /></label>
        <label>Platform role
          <select name="platformRole">
            <option value="manager">manager — customers only</option>
            <option value="support">support — customers + Closer behaviour</option>
            <option value="admin">admin — everything</option>
          </select>
        </label>
        <label>In the AIStaff workspace
          <select name="tenantRole">
            <option value="account_user">Account user</option>
            <option value="account_admin">Account admin</option>
          </select>
        </label>
        <button class="button button-primary full" type="submit">Create and send set-up email</button>
      </form>

      <ul class="role-help">${Object.entries(ROLE_HELP).map(([r, t]) => `<li><b>${r}</b> — ${t}</li>`).join("")}</ul>
    </section>`;
}

async function loadStaffPanel() {
  const holder = document.getElementById("staffHolder");
  if (!holder) return;
  try {
    const { users } = await api("/api/platform/users");
    holder.innerHTML = staffPanel(users);
    wireStaffPanel();
  } catch {
    holder.innerHTML = "";
  }
}

function wireStaffPanel() {
  const form = document.getElementById("staffForm");
  if (form) {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(event.currentTarget));
      try {
        const result = await api("/api/platform/users", { method: "POST", body: data });
        toast(result.promoted
          ? `${data.email} now has ${data.platformRole} access`
          : result.emailSent
            ? `Created — set-up email sent to ${data.email}`
            : `Created, but the email failed. They can use "Forgot password".`);
        loadStaffPanel();
      } catch (error) {
        toast(error.message);
      }
    };
  }

  document.querySelectorAll("[data-role-for]").forEach((sel) => {
    sel.onchange = async () => {
      try {
        await api(`/api/platform/users/${sel.dataset.roleFor}`, {
          method: "PUT", body: { platformRole: sel.value }
        });
        toast(`Role changed to ${sel.value}`);
      } catch (error) {
        toast(error.message);
        loadStaffPanel();
      }
    };
  });

  document.querySelectorAll("[data-revoke]").forEach((btn) => {
    btn.onclick = async () => {
      if (!window.confirm("Remove platform access? They keep their workspace login but lose the Platform area.")) return;
      try {
        await api(`/api/platform/users/${btn.dataset.revoke}`, {
          method: "PUT", body: { platformRole: null }
        });
        toast("Platform access removed");
        loadStaffPanel();
      } catch (error) {
        toast(error.message);
      }
    };
  });
}
