const state = {
  user: null,
  company: null,
  currentRoute: "public",
  bookingCalendarMonth: null
};

const navItems = [
  ["dashboard", "Dashboard"],
  ["marketing", "Marketing"],
  ["onboarding", "Onboarding"],
  ["conversations", "Inquiries"],
  ["leads", "Leads"],
  ["knowledge-base", "Knowledge Base"],
  ["ai-studio", "AI Studio"],
  ["qualification-questions", "Qualification Questions"],
  ["quotations", "Quotations"],
  ["bookings", "Bookings"],
  ["payments", "Payments"],
  ["follow-ups", "Follow-ups"],
  ["settings", "Settings"]
];

/**
 * Screens that belong to AIStaff, not to a customer.
 *
 * Marketing is GLOBAL state — getMarketingOverview() takes no company id, so
 * the launch checklist is shared by every tenant and a customer ticking a box
 * would change it for everyone. Onboarding and AI Studio are internal tooling;
 * AI Studio exposes the raw system prompt, which no clinic owner should edit.
 *
 * Payments removed from tenants 2026-08-19: it shows AIStaff's own order and
 * pricing internals, which is platform business, not the customer's.
 */
const PLATFORM_ONLY_ROUTES = new Set(["marketing", "onboarding", "ai-studio", "payments"]);

/**
 * Nav visible to this user.
 *
 * FAIL-SAFE TOWARD THE REVIEWED STATE (HANDOFF §12): the submission videos show
 * the main tenant nav in this order, and a mismatch can trigger a re-review
 * that suspends Messenger for every client. So the full nav is the DEFAULT,
 * and items are hidden only when the signed-in user is positively identified as
 * a customer — platform_role null.
 *
 * Every internal account, including reviewer@aistaff.click which Meta uses to
 * log in, carries a platform_role and therefore sees the nav unchanged. Order
 * is never altered; entries are only omitted.
 */
function visibleNavItems() {
  const isPlatformUser = Boolean(state.user && state.user.platform_role);
  // Platform is APPENDED, never inserted — staff-only extras must come after
  // the tenant workspace items shown in the submission videos (§12).
  if (isPlatformUser) return [...navItems, ["platform", "Platform"]];
  return navItems.filter(([route]) => !PLATFORM_ONLY_ROUTES.has(route));
}

const $ = (selector) => document.querySelector(selector);

function toast(message) {
  const box = $("#toast");
  box.textContent = message;
  box.hidden = false;
  setTimeout(() => { box.hidden = true; }, 3600);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: response.statusText }));
    throw new Error(error.error || "Request failed");
  }
  return response.json();
}

function messageSenderLabel(senderType) {
  if (senderType === "customer") return "Customer";
  if (senderType === "ai") return "AIStaff";
  return senderType;
}

function renderMessageTranscript(messages) {
  if (!messages?.length) {
    return `<p class="muted">No messages saved yet.</p>`;
  }
  return messages.map((m) => {
    // Attachments shown inline, so the transcript matches what the customer
    // actually received. Without this the thread reads as if Closer promised a
    // visual and never sent one — the reply says "here's a quick visual" and
    // the image is invisible to whoever reviews the conversation.
    const files = Array.isArray(m.attachments) ? m.attachments : [];
    const media = files.length
      ? `<div class="message-media">${files.map((f) => (
          f.type === "image"
            ? `<a href="${escapeHtml(f.url)}" target="_blank" rel="noopener"><img src="${escapeHtml(f.url)}" alt="${escapeHtml(f.caption || "")}" loading="lazy" /></a>`
            : `<a class="message-file" href="${escapeHtml(f.url)}" target="_blank" rel="noopener">${escapeHtml((f.type || "file").toUpperCase())} · ${escapeHtml(f.caption || "open")}</a>`
        )).join("")}</div>`
      : "";

    return `
    <article class="message ${m.sender_type}">
      <header>
        <strong>${messageSenderLabel(m.sender_type)}</strong>
        <time>${fmtDate(m.created_at)}</time>
      </header>
      <p>${escapeHtml(m.message_text)}</p>
      ${media}
    </article>`;
  }).join("");
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function fmtDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("en-PH", {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit"
  });
}

function money(value) {
  if (!value) return "TBD";
  return `PHP ${Number(value).toLocaleString("en-PH")}`;
}

function localDateTimeValue(value = new Date()) {
  const date = new Date(value);
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}

function statusPill(value) {
  const safe = value || "new";
  return `<span class="status ${safe}">${safe.replaceAll("_", " ")}</span>`;
}

function scorePill(value) {
  const safe = value || "cold";
  return `<span class="score ${safe}">${safe}</span>`;
}

function adminPath(route = "dashboard", id = null) {
  if (route === "login") return "/admin/login";
  return id ? `/admin/${route}/${id}` : `/admin/${route}`;
}

function parseAdminRoute() {
  const path = location.pathname.replace(/^\/admin\/?/, "");
  const parts = path.split("/").filter(Boolean);
  if (!parts.length) return { routeName: "dashboard", id: null };
  if (parts[0] === "login") return { routeName: "login", id: null };
  return { routeName: parts[0], id: parts[1] || null };
}

function goAdmin(route = "dashboard", id = null) {
  history.pushState(null, "", adminPath(route, id));
  routeHandler();
}

function rowLink(route, id, text) {
  return `<a href="${adminPath(route, id)}"><b>${text || "Open"}</b></a>`;
}

function setMode(mode, panel = "login") {
  $("[data-public].site-header").hidden = mode !== "public";
  $("#publicSite").hidden = mode !== "public";
  $("[data-public].site-footer").hidden = mode !== "public";
  $("#adminApp").hidden = mode !== "admin";
  $("#loginPage").hidden = mode !== "login";
  // The login shell hosts three panels: sign in, request a reset, set a new
  // password. All must work BEFORE authentication, so they live here rather
  // than behind the session gate below.
  if (mode === "login") {
    $("#loginForm").hidden = panel !== "login";
    $("#forgotForm").hidden = panel !== "forgot";
    $("#resetForm").hidden = panel !== "reset";
  }
}

function renderAdminNav(active) {
  // visibleNavItems(), not navItems — customers do not see Marketing,
  // Onboarding or AI Studio. Every staff account (including the Meta reviewer
  // login) carries a platform_role and still sees the full nav, so the
  // submission videos continue to match (§12).
  $("#adminNav").innerHTML = visibleNavItems().map(([key, label]) => (
    `<a class="${active === key ? "active" : ""}" href="${adminPath(key)}"><span>${label[0]}</span>${label}</a>`
  )).join("");

  // Signed-in identity, so it is never ambiguous which account you are in.
  const box = $("#sidebarUser");
  if (box && state.user) {
    const name = state.user.name || state.user.email || "Signed in";
    // Tenant role in plain words. "account_admin" is database shorthand; the
    // person needs to see what they can do, and a staff member assisting a
    // customer needs to know whose account and at what level.
    const TENANT_ROLE = {
      account_admin: "Account admin",
      account_user: "Account user",
      owner: "Account admin",
      admin: "Account admin"
    };
    const tenantRole = TENANT_ROLE[state.user.role] || "Account user";
    const platform = state.user.platform_role
      ? ` · Platform ${state.user.platform_role}`
      : "";
    $("#sidebarAvatar").textContent = name.trim().charAt(0).toUpperCase();
    $("#sidebarUserName").textContent = name;
    $("#sidebarUserCompany").textContent =
      `${tenantRole}${platform}${state.company?.name ? ` · ${state.company.name}` : ""}`;
    box.hidden = false;
  }
}

async function loadSession() {
  try {
    const session = await api("/api/auth/me");
    state.user = session.user;
    state.company = session.company;
    return true;
  } catch {
    state.user = null;
    state.company = null;
    return false;
  }
}

function setTitle(title) {
  $("#adminTitle").textContent = title;
  document.title = `${title} | AIStaff.click`;
}

async function dashboardView() {
  setTitle("Dashboard");
  const data = await api("/api/dashboard");
  $("#adminContent").innerHTML = `
    <div class="admin-grid">
      <section class="metrics">
        <article class="metric-card"><small>Leads today</small><strong>${data.leadsToday}</strong></article>
        <article class="metric-card"><small>Hot leads</small><strong>${data.hotLeads}</strong></article>
        <article class="metric-card"><small>Quotation-ready</small><strong>${data.quotationReady}</strong></article>
        <article class="metric-card"><small>Pending approvals</small><strong>${data.pendingApprovals}</strong></article>
        <article class="metric-card"><small>Needs human</small><strong>${data.needsHuman}</strong></article>
        <article class="metric-card"><small>Pending follow-ups</small><strong>${data.pendingFollowUps}</strong></article>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Marketing launch</h2><a class="button button-soft" href="${adminPath("marketing")}">Open Marketing</a></div>
        <p class="muted">Manage ads, launch checklist, bot testing, and inquiry review without using the terminal.</p>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Recent conversations</h2><a class="button button-soft" href="${adminPath("conversations")}">Review all inquiries</a></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Customer</th><th>Intent</th><th>Score</th><th>Needs Human</th><th>Last Message</th></tr></thead>
            <tbody>${data.recentConversations.map((c) => `
              <tr>
                <td>${rowLink("conversations", c.id, c.customer_name || c.psid)}</td>
                <td>${c.intent || "qualifying"}</td>
                <td>${scorePill(c.lead_score)}</td>
                <td>${c.needs_human ? statusPill("handoff") : statusPill(c.status)}</td>
                <td>${c.messages?.[0]?.message_text || "No messages yet"}</td>
              </tr>`).join("")}</tbody>
          </table>
        </div>
      </section>
    </div>`;
}

function marketingTabs(active) {
  const tabs = [
    ["", "Overview"],
    ["process", "Launch Process"],
    ["ads", "Ads & Creatives"],
    ["review", "Review & Test"]
  ];
  return `<nav class="subnav">${tabs.map(([slug, label]) => (
    `<a class="${active === slug ? "active" : ""}" href="${adminPath("marketing", slug || null)}">${label}</a>`
  )).join("")}</nav>`;
}

function copyButton(label = "Copy") {
  return `<button type="button" class="button button-soft copy-pre-btn">${label}</button>`;
}

function settingsTabs(active = "") {
  const tabs = [
    ["", "General"],
    ["facebook-page-connection", "Facebook Page Connection"]
  ];
  return `<nav class="subnav">${tabs.map(([slug, label]) => (
    `<a class="${active === slug ? "active" : ""}" href="${adminPath("settings", slug || null)}">${label}</a>`
  )).join("")}</nav>`;
}

function bindCopyButtons(root = document) {
  root.querySelectorAll(".copy-pre-btn").forEach((button) => {
    button.onclick = async () => {
      const pre = button.previousElementSibling;
      if (pre?.matches("pre")) {
        await navigator.clipboard.writeText(pre.textContent || "");
        toast("Copied to clipboard");
      }
    };
  });
}

async function marketingHubView() {
  setTitle("Marketing");
  const data = await api("/api/marketing");
  $("#adminContent").innerHTML = `
    ${marketingTabs("")}
    <div class="admin-grid">
      <section class="metrics">
        <article class="metric-card"><small>Launch checklist</small><strong>${data.checklistDone}/${data.checklistTotal}</strong></article>
        <article class="metric-card"><small>Ad creatives</small><strong>${data.creatives.length}</strong></article>
        <article class="metric-card"><small>Approved ads</small><strong>${data.creatives.filter((c) => c.review.status === "approved").length}</strong></article>
        <article class="metric-card"><small>Exported videos</small><strong>${data.creatives.filter((c) => c.video).length}</strong></article>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Phase 1 marketing funnel</h2></div>
        <div class="funnel-steps">
          <article><span>1</span><h3>Facebook Ad (Taglish video)</h3><p>Send traffic to landing page or AIStaff Messenger Page.</p></article>
          <article><span>2</span><h3>Landing page audit form</h3><p><a href="/#audit" target="_blank" rel="noopener">aistaff.click/#audit</a> saves leads in admin.</p></article>
          <article><span>3</span><h3>Messenger bot qualifies</h3><p>Pricing gated until contact captured. Review in Inquiries.</p></article>
          <article><span>4</span><h3>You call within 24h</h3><p>Follow up audit leads and book managed onboarding.</p></article>
        </div>
        <p class="muted">Test budget: ${data.funnel.testBudget}. Kill rule: ${data.funnel.killRule}.</p>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Quick actions</h2></div>
        <div class="actions-row">
          <a class="button button-primary" href="${adminPath("marketing", "ads")}">Open ad creatives</a>
          <a class="button button-soft" href="${adminPath("marketing", "review")}">Test bot & review</a>
          <a class="button button-soft" href="${adminPath("conversations")}">Review inquiries</a>
          <a class="button button-soft" href="${adminPath("leads")}">Audit leads</a>
        </div>
      </section>
    </div>`;
}

async function marketingProcessView() {
  setTitle("Launch Process");
  const data = await api("/api/marketing");
  $("#adminContent").innerHTML = `
    ${marketingTabs("process")}
    <section class="panel">
      <div class="panel-header"><h2>Launch checklist</h2><span>${data.checklistDone}/${data.checklistTotal} complete</span></div>
      <p class="muted">Track Phase 1 launch without using the terminal. Click to mark steps done.</p>
      <div class="checklist-grid">
        ${data.checklist.map((item) => `
          <label class="checklist-item ${item.done ? "done" : ""}">
            <input type="checkbox" data-checklist-id="${item.id}" ${item.done ? "checked" : ""} />
            <div>
              <small>${item.group}</small>
              <strong>${item.label}</strong>
              ${item.href ? `<a href="${item.href}">Open →</a>` : ""}
            </div>
          </label>`).join("")}
      </div>
    </section>
    <section class="panel">
      <h2>Campaign notes</h2>
      <form id="marketingNotesForm" class="form-grid">
        <label class="full">Notes<textarea name="notes" rows="5">${escapeHtml(data.notes || "")}</textarea></label>
        <button class="button button-primary" type="submit">Save notes</button>
      </form>
    </section>`;

  $("#adminContent").querySelectorAll("[data-checklist-id]").forEach((input) => {
    input.onchange = async () => {
      await api("/api/marketing/checklist", { method: "PATCH", body: { id: input.dataset.checklistId, done: input.checked } });
      toast(input.checked ? "Step marked done" : "Step reopened");
      marketingProcessView();
    };
  });
  $("#marketingNotesForm").onsubmit = async (event) => {
    event.preventDefault();
    const notes = new FormData(event.currentTarget).get("notes");
    await api("/api/marketing/notes", { method: "PUT", body: { notes } });
    toast("Notes saved");
  };
}

function exportProgressBlock(creative) {
  const job = creative.exportJob;
  if (!job || !["running", "failed", "done"].includes(job.status)) return "";
  const failed = job.status === "failed";
  const running = job.status === "running";
  const done = job.status === "done";
  const progress = Math.max(0, Math.min(100, Number(job.progress || 0)));
  return `
    <div class="export-progress ${failed ? "failed" : running ? "running" : "done"}" data-export-progress="${creative.id}">
      <div class="export-progress-meta">
        <strong>${failed ? "Export failed" : running ? "Exporting…" : "Export complete"}</strong>
        <span>${progress}%</span>
      </div>
      <div class="export-progress-track" aria-hidden="true">
        <div class="export-progress-bar" style="width:${progress}%"></div>
      </div>
      <p class="export-progress-detail">${escapeHtml(job.progressLabel || (running ? "Processing…" : ""))}</p>
      ${failed && job.error ? `<p class="export-progress-error">${escapeHtml(job.error)}</p>` : ""}
      ${done ? `<p class="export-progress-detail">Your file is ready below.</p>` : ""}
    </div>`;
}

function creativePreviewBlock(creative) {
  if (creative.video) {
    const url = `${creative.video.url}?v=${encodeURIComponent(creative.video.updatedAt || "")}`;
    return `
      <div class="preview-status ready">MP4 ready — press play below</div>
      <video class="ad-video" controls playsinline preload="metadata" poster="${creative.preview?.url || ""}" src="${url}"></video>
      <div class="actions-row preview-actions">
        <a class="button button-primary" href="${url}" target="_blank" rel="noopener">Open MP4 in new tab</a>
        <a class="button button-soft" href="${url}" download="${creative.outputFile}">Download MP4</a>
      </div>`;
  }
  if (creative.preview) {
    return `
      <div class="preview-status">Static preview only — export MP4 to play the full 15s video</div>
      <img src="${creative.preview.url}?v=${encodeURIComponent(creative.preview.updatedAt || "")}" alt="${escapeHtml(creative.title)}" />`;
  }
  return `<div class="preview-placeholder">No preview yet — click Refresh preview</div>`;
}

let marketingAdsPollTimer = null;

function updateExportProgressBars(items) {
  items.forEach(({ compositionId, exportJob, video }) => {
    const card = document.querySelector(`[data-creative-id="${compositionId}"]`);
    if (!card) return;

    let block = card.querySelector(`[data-export-progress="${compositionId}"]`);
    const body = card.querySelector(".creative-body");
    const shouldShow = exportJob && (exportJob.status === "running" || exportJob.status === "failed" || (exportJob.status === "done" && Date.now() - new Date(exportJob.finishedAt).getTime() < 15000));

    if (!shouldShow) {
      if (block) block.remove();
      return;
    }

    const html = exportProgressBlock({ id: compositionId, exportJob });
    if (block) {
      block.outerHTML = html;
    } else if (body) {
      body.insertAdjacentHTML("afterbegin", html);
    }

    if (exportJob.status === "failed") {
      card.querySelectorAll(".render-btn").forEach((btn) => { btn.disabled = false; });
    }
    if (exportJob.status === "done" && video) {
      card.querySelectorAll(".render-btn").forEach((btn) => { btn.disabled = false; });
    }
  });
}

function stopMarketingAdsPoll() {
  if (marketingAdsPollTimer) {
    clearInterval(marketingAdsPollTimer);
    marketingAdsPollTimer = null;
  }
}

function startMarketingAdsPoll() {
  stopMarketingAdsPoll();

  const tick = async () => {
    try {
      const { items } = await api("/api/marketing/render-status");
      updateExportProgressBars(items);

      const running = items.some((item) => item.exportJob?.status === "running");
      const justDone = items.filter((item) => item.exportJob?.status === "done" && item.video);
      const justFailed = items.filter((item) => item.exportJob?.status === "failed");

      if (!running && justDone.length) {
        stopMarketingAdsPoll();
        toast("MP4 export ready — you can play it now");
        marketingAdsView();
        return;
      }

      if (!running && justFailed.length) {
        const recentFail = justFailed.find((item) => item.exportJob?.finishedAt && Date.now() - new Date(item.exportJob.finishedAt).getTime() < 20000);
        if (recentFail && !startMarketingAdsPoll.failedNotified) {
          toast(`Export failed: ${recentFail.exportJob.error || "Unknown error"}`);
          startMarketingAdsPoll.failedNotified = true;
        }
        stopMarketingAdsPoll();
      }
    } catch {
      stopMarketingAdsPoll();
    }
  };

  tick();
  marketingAdsPollTimer = setInterval(tick, 2000);
}
startMarketingAdsPoll.failedNotified = false;

async function marketingAdsView() {
  setTitle("Ads & Creatives");
  const data = await api("/api/marketing");
  const activeExports = data.creatives.filter((c) => c.exportJob?.status === "running").length;
  $("#adminContent").innerHTML = `
    ${marketingTabs("ads")}
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Remotion ad creatives</h2>
          <p class="muted">Click <b>Export MP4</b> and watch the progress bar. When it hits 100%, the video player appears below.</p>
        </div>
      </div>
      ${activeExports ? `<p class="export-banner">Exporting ${activeExports} video(s)… progress updates every 2 seconds.</p>` : ""}
      <div class="creative-grid">
        ${data.creatives.map((creative) => `
          <article class="creative-card" data-creative-id="${creative.id}">
            <div class="creative-preview">
              ${creativePreviewBlock(creative)}
            </div>
            <div class="creative-body">
              ${exportProgressBlock(creative)}
              <div class="panel-header"><h3>${escapeHtml(creative.title)}</h3>${statusPill(creative.review.status)}</div>
              <p class="muted">${escapeHtml(creative.angle)} · ${escapeHtml(creative.format)} · ${escapeHtml(creative.language)}</p>
              <div class="actions-row">
                <button class="button button-primary render-btn" data-id="${creative.id}" data-kind="video" ${creative.exportJob?.status === "running" ? "disabled" : ""}>${creative.video ? "Re-export MP4" : "Export MP4"}</button>
                <button class="button button-soft render-btn" data-id="${creative.id}" data-kind="still" ${creative.exportJob?.status === "running" ? "disabled" : ""}>Refresh preview image</button>
                ${creative.voiceoverFile ? `<button type="button" class="button button-soft voiceover-btn" data-id="${creative.id}">Generate voiceover</button>` : ""}
              </div>
              <details>
                <summary>Facebook ad copy</summary>
                <div class="copy-block">
                  <p><b>Primary text</b></p>
                  <pre>${escapeHtml(creative.copy.primary)}</pre>
                  ${copyButton("Copy primary text")}
                  <p><b>Headline:</b> ${escapeHtml(creative.copy.headline)}</p>
                  <pre>${escapeHtml(creative.copy.headline)}</pre>
                  ${copyButton("Copy headline")}
                  <p><b>CTA button:</b> ${escapeHtml(creative.copy.cta)}</p>
                </div>
              </details>
              <form class="ad-review-form form-grid" data-review-id="${creative.id}">
                <label>Review status
                  <select name="status">
                    <option value="draft" ${creative.review.status === "draft" ? "selected" : ""}>Draft</option>
                    <option value="approved" ${creative.review.status === "approved" ? "selected" : ""}>Approved</option>
                    <option value="needs_changes" ${creative.review.status === "needs_changes" ? "selected" : ""}>Needs changes</option>
                  </select>
                </label>
                <label class="full">Review note<textarea name="note">${escapeHtml(creative.review.note || "")}</textarea></label>
                <button class="button button-soft" type="submit">Save review</button>
              </form>
            </div>
          </article>`).join("")}
      </div>
    </section>`;

  bindCopyButtons($("#adminContent"));
  $("#adminContent").querySelectorAll(".render-btn").forEach((button) => {
    button.onclick = async () => {
      if (button.disabled) return;
      button.disabled = true;
      const original = button.textContent;
      button.textContent = "Starting…";
      try {
        const result = await api("/api/marketing/render", {
          method: "POST",
          body: { compositionId: button.dataset.id, kind: button.dataset.kind }
        });
        if (result.exportJob) {
          updateExportProgressBars([{
            compositionId: button.dataset.id,
            exportJob: result.exportJob,
            video: null
          }]);
        }
        startMarketingAdsPoll();
        startMarketingAdsPoll.failedNotified = false;
        toast(result.alreadyRunning ? "Export already running" : "Export started");
      } catch (error) {
        toast(error.message);
        button.disabled = false;
        button.textContent = original;
      }
    };
  });
  $("#adminContent").querySelectorAll(".voiceover-btn").forEach((button) => {
    button.onclick = async () => {
      button.disabled = true;
      const original = button.textContent;
      button.textContent = "Generating VO…";
      try {
        const result = await api("/api/marketing/generate-voiceover", {
          method: "POST",
          body: { compositionId: button.dataset.id }
        });
        toast(result.message || "Voiceover ready");
      } catch (error) {
        toast(error.message);
      } finally {
        button.disabled = false;
        button.textContent = original;
      }
    };
  });
  $("#adminContent").querySelectorAll(".ad-review-form").forEach((form) => {
    form.onsubmit = async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(form));
      await api("/api/marketing/ad-review", {
        method: "PATCH",
        body: { id: form.dataset.reviewId, status: data.status, note: data.note }
      });
      toast("Ad review saved");
      marketingAdsView();
    };
  });
  if (data.creatives.some((c) => c.exportJob?.status === "running")) {
    startMarketingAdsPoll();
    startMarketingAdsPoll.failedNotified = false;
  }
}

async function marketingReviewView() {
  setTitle("Review & Test");
  const [marketing, review] = await Promise.all([
    api("/api/marketing"),
    api("/api/marketing/review-summary")
  ]);
  $("#adminContent").innerHTML = `
    ${marketingTabs("review")}
    <div class="split">
      <section class="panel">
        <div class="panel-header"><h2>Test AIStaff Messenger bot</h2></div>
        <p class="muted">Test Taglish replies, pricing gate, and audit CTA without opening Messenger.</p>
        <form id="botTestForm" class="form-grid">
          <label class="full">Customer message<textarea name="message" rows="3" placeholder="Hi / Magkano po? / Can you audit my page?">Hi</textarea></label>
          <button class="button button-primary" type="submit">Get AI reply</button>
        </form>
        <div id="botTestReply" class="bot-test-reply" hidden></div>
        <div class="quick-test-row">
          ${["Hi", "Magkano po?", "Can you audit my page?", "Starter vs Growth difference?"].map((msg) => (
            `<button type="button" class="button button-soft quick-bot-test" data-message="${msg.replace(/"/g, "&quot;")}">${escapeHtml(msg)}</button>`
          )).join("")}
        </div>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Review queue</h2></div>
        <div class="metrics metrics-compact">
          <article class="metric-card"><small>New audit leads</small><strong>${review.auditLeads}</strong></article>
          <article class="metric-card"><small>Messenger demo inquiries</small><strong>${review.demoInquiries}</strong></article>
          <article class="metric-card"><small>Website audit requests</small><strong>${review.websiteAudits}</strong></article>
        </div>
        <div class="actions-row">
          <a class="button button-soft" href="${adminPath("conversations")}">Review all inquiries</a>
          <a class="button button-soft" href="${adminPath("leads")}">Open leads CRM</a>
        </div>
      </section>
    </div>
    <section class="panel">
      <div class="panel-header"><h2>Ad approval status</h2></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Creative</th><th>Status</th><th>Video</th><th>Note</th><th></th></tr></thead>
        <tbody>${marketing.creatives.map((c) => `
          <tr>
            <td>${escapeHtml(c.title)}</td>
            <td>${statusPill(c.review.status)}</td>
            <td>${c.video ? "Ready" : "Not exported"}</td>
            <td>${escapeHtml(c.review.note || "—")}</td>
            <td><a href="${adminPath("marketing", "ads")}">Open</a></td>
          </tr>`).join("")}
      </tbody></table></div>
    </section>
    <section class="panel">
      <div class="panel-header"><h2>Recent Messenger demo threads</h2></div>
      ${review.recentDemoMessages.length ? review.recentDemoMessages.map((c) => `
        <article class="review-thread-card">
          <header>
            <strong>${escapeHtml(c.customer_name || c.psid)}</strong>
            <a href="${adminPath("conversations", c.id)}">Review thread →</a>
          </header>
          <div class="message-list transcript">${renderMessageTranscript(c.messages.slice().reverse())}</div>
        </article>`).join("") : `<p class="muted">No demo inquiries yet. Send a message to your AIStaff Facebook Page or use the bot tester above.</p>`}
    </section>`;

  async function runBotTest(message) {
    const result = await api("/api/marketing/test-bot", { method: "POST", body: { message } });
    const box = $("#botTestReply");
    box.hidden = false;
    box.innerHTML = `<small>AIStaff reply</small><p>${escapeHtml(result.reply)}</p>`;
  }

  $("#botTestForm").onsubmit = async (event) => {
    event.preventDefault();
    const message = new FormData(event.currentTarget).get("message");
    await runBotTest(message);
  };
  $("#adminContent").querySelectorAll(".quick-bot-test").forEach((button) => {
    button.onclick = async () => {
      $("#botTestForm textarea[name=message]").value = button.dataset.message;
      await runBotTest(button.dataset.message);
    };
  });
}

async function onboardingView() {
  setTitle("Client Onboarding");
  const status = await api("/api/onboarding-status");
  const items = [
    ["Company profile filled", status.companyProfile, adminPath("settings")],
    ["AI settings configured", status.settingsConfigured, adminPath("settings")],
    [`Knowledge base (3+ entries) — ${status.knowledgeBaseCount}`, status.knowledgeBase, adminPath("knowledge-base")],
    [`Qualification questions (3+) — ${status.qualificationQuestionCount}`, status.qualificationQuestions, adminPath("qualification-questions")],
    [`Facebook Page connected — ${status.facebookPageCount}`, status.facebookPageConnected, adminPath("settings")],
    [`Test lead received — ${status.leadCount}`, status.hasLeads, adminPath("leads")]
  ];
  const done = items.filter(([, ok]) => ok).length;
  $("#adminContent").innerHTML = `
    <section class="panel">
      <div class="panel-header"><h2>Phase 1 onboarding checklist</h2><span>${done}/${items.length} complete</span></div>
      <p>Use this when onboarding a new managed client. Create tenants from Settings after a sale is closed.</p>
      <div class="steps" style="margin-top:16px">
        ${items.map(([label, ok, href]) => `
          <article>
            <span>${ok ? "✓" : "○"}</span>
            <h3>${label}</h3>
            <p><a href="${href}">Open section →</a></p>
          </article>`).join("")}
      </div>
      <div class="panel" style="margin-top:20px">
        <h3>Managed onboarding steps</h3>
        <ol>
          <li>Collect company details after sale closed</li>
          <li>Fill knowledge base with client services, pricing rules, and FAQs</li>
          <li>Connect client Facebook Page in Settings (Page ID + token)</li>
          <li>Send test Messenger inquiry and confirm AI reply</li>
          <li>Train client admin on quotation approval workflow</li>
        </ol>
        <p><a href="${adminPath("marketing", "process")}">Open marketing launch checklist →</a></p>
      </div>
    </section>`;
}

async function conversationsView() {
  setTitle("Inquiries");
  const rows = await api("/api/conversations");
  $("#adminContent").innerHTML = `
    <section class="panel">
      <div class="panel-header">
        <div>
          <h2>Messenger inquiry review</h2>
          <p class="muted">Full conversation history is stored in Postgres and loaded through the API — not from the browser directly.</p>
        </div>
        <button class="button button-soft" id="simulateBtn">Simulate inquiry</button>
      </div>
      ${rows.length ? `<div class="table-wrap"><table>
        <thead><tr><th>Customer</th><th>Channel</th><th>Status</th><th>Intent</th><th>Score</th><th>Messages</th><th>Last message</th><th></th></tr></thead>
        <tbody>${rows.map((c) => `
          <tr>
            <td>${rowLink("conversations", c.id, c.customer_name || c.psid)}</td>
            <td>${c.channel}</td>
            <td>${c.needs_human ? statusPill("handoff") : statusPill(c.status)}</td>
            <td>${c.intent || "qualifying"}</td>
            <td>${scorePill(c.lead_score)}</td>
            <td>${c._count?.messages ?? c.messages?.length ?? 0}</td>
            <td>${escapeHtml(c.messages?.[0]?.message_text || "")}</td>
            <td><a class="button button-soft" href="${adminPath("conversations", c.id)}">Review thread</a></td>
          </tr>`).join("")}</tbody>
      </table></div>` : `<p class="muted">No inquiries yet. Send a message to your AIStaff Facebook Page or click Simulate inquiry.</p>`}
    </section>`;
  $("#simulateBtn").onclick = simulateInquiry;
}

async function conversationDetailView(id) {
  setTitle("Inquiry Review");
  const c = await api(`/api/conversations/${id}`);
  const lead = c.leads?.[0];
  $("#adminContent").innerHTML = `
    <div class="review-toolbar">
      <a class="button button-soft" href="${adminPath("conversations")}">← All inquiries</a>
      ${lead ? `<a class="button button-soft" href="${adminPath("leads", lead.id)}">Open lead record</a>` : ""}
    </div>
    <div class="split review-layout">
      <section class="panel">
        <div class="panel-header"><h2>Conversation transcript</h2><span>${c.messages.length} messages</span></div>
        <div class="message-list transcript">${renderMessageTranscript(c.messages)}</div>
      </section>
      <section class="panel review-meta">
        <h2>Inquiry details</h2>
        <!-- Who this actually is. A PSID is a 17-digit number nobody can act
             on; the name and photo come from Meta's User Profile API. -->
        <div class="inquiry-person">
          ${c.profile_pic_url
            ? `<img class="inquiry-avatar" src="${escapeHtml(c.profile_pic_url)}" alt="" referrerpolicy="no-referrer" onerror="this.replaceWith(Object.assign(document.createElement('span'),{className:'inquiry-avatar is-initials',textContent:'${escapeHtml((c.customer_name || "?").trim().charAt(0).toUpperCase())}'}))" />`
            : `<span class="inquiry-avatar is-initials">${escapeHtml((c.customer_name || "?").trim().charAt(0).toUpperCase())}</span>`}
          <div>
            <b>${escapeHtml(c.customer_name || "Name not available")}</b>
            ${c.psid ? `<a class="inquiry-open-chat" href="https://www.facebook.com/messages/t/${encodeURIComponent(c.psid)}" target="_blank" rel="noopener">Reply in Messenger ↗</a>` : ""}
          </div>
        </div>
        <dl class="detail-list">
          <div><dt>Customer</dt><dd>${escapeHtml(c.customer_name || c.psid)}</dd></div>
          <div><dt>PSID</dt><dd><code>${escapeHtml(c.psid)}</code></dd></div>
          <div><dt>Channel</dt><dd>${escapeHtml(c.channel)}</dd></div>
          <div><dt>Status</dt><dd>${c.needs_human ? statusPill("handoff") : statusPill(c.status)}</dd></div>
          <div><dt>Intent</dt><dd>${escapeHtml(c.intent || "qualifying")}</dd></div>
          <div><dt>Lead score</dt><dd>${scorePill(c.lead_score)}</dd></div>
          <div><dt>Started</dt><dd>${fmtDate(c.created_at)}</dd></div>
          <div><dt>Last message</dt><dd>${fmtDate(c.last_message_at)}</dd></div>
        </dl>
        ${lead ? `<div class="review-lead-card">
          <h3>Linked lead</h3>
          <p><b>${escapeHtml(lead.customer_name || "Unknown")}</b></p>
          <p>${escapeHtml(lead.company_name || "Company TBD")}</p>
          <p>${escapeHtml(lead.mobile_number || "No mobile")} · ${escapeHtml(lead.email || "No email")}</p>
        </div>` : ""}
        <div class="actions-row">
          <button class="button button-danger" id="handoffBtn">Trigger Human Handoff</button>
        </div>
      </section>
    </div>`;
  $("#handoffBtn").onclick = async () => {
    await api(`/api/conversations/${id}/handoff`, { method: "POST", body: { reason: "Admin requested handoff from dashboard" } });
    toast("Human handoff created");
    conversationDetailView(id);
  };
}

async function leadsView() {
  setTitle("Leads");
  const rows = await api("/api/leads");
  $("#adminContent").innerHTML = `
    <section class="panel">
      <div class="panel-header"><h2>Facebook inquiry CRM</h2><span>${rows.length} leads</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Customer</th><th>Company</th><th>Location</th><th>Service Needed</th><th>Urgency</th><th>Score</th><th>Quotation Ready</th><th>Follow-up</th><th>Assigned To</th></tr></thead>
        <tbody>${rows.map((lead) => `
          <tr>
            <td>${rowLink("leads", lead.id, lead.customer_name || "Unknown")}</td>
            <td>${lead.company_name || "TBD"}</td>
            <td>${lead.location || "TBD"}</td>
            <td>${lead.service_needed || "TBD"}</td>
            <td>${lead.urgency || "TBD"}</td>
            <td>${scorePill(lead.lead_score)}</td>
            <td>${lead.quotation_ready ? statusPill("quotation_ready") : "No"}</td>
            <td>${fmtDate(lead.follow_up_date)}</td>
            <td>${lead.assigned_user?.name || "Unassigned"}</td>
          </tr>`).join("")}</tbody>
      </table></div>
    </section>`;
}

async function leadDetailView(id) {
  setTitle("Lead Detail");
  const lead = await api(`/api/leads/${id}`);
  $("#adminContent").innerHTML = `
    <div class="split">
      <section class="panel">
        <div class="panel-header"><h2>${lead.customer_name || "Lead"}</h2>${scorePill(lead.lead_score)}</div>
        <form id="leadForm" class="form-grid">
          ${field("customer_name", "Customer name", lead.customer_name)}
          ${field("company_name", "Company", lead.company_name)}
          ${field("mobile_number", "Mobile number", lead.mobile_number)}
          ${field("email", "Email", lead.email)}
          ${field("location", "Location", lead.location)}
          ${field("service_needed", "Service needed", lead.service_needed)}
          ${field("budget", "Budget", lead.budget)}
          ${field("urgency", "Urgency", lead.urgency)}
          ${field("lead_status", "Lead status", lead.lead_status)}
          ${field("follow_up_date", "Follow-up date", lead.follow_up_date ? lead.follow_up_date.slice(0, 10) : "", "date")}
          <label class="full">Notes<textarea name="notes">${lead.notes || ""}</textarea></label>
          <button class="button button-primary full" type="submit">Save Lead</button>
        </form>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Linked quotation drafts</h2><a class="button button-soft" href="${adminPath("quotations")}">Open Quotations</a></div>
        <div class="table-wrap"><table>
          <thead><tr><th>No.</th><th>Status</th><th>Amount</th><th>Created</th></tr></thead>
          <tbody>${lead.quotations.map((q) => `<tr><td>${rowLink("quotations", q.id, q.quotation_number)}</td><td>${statusPill(q.status)}</td><td>${money(q.amount)}</td><td>${fmtDate(q.created_at)}</td></tr>`).join("")}</tbody>
        </table></div>
        <h2>Conversation history</h2>
        <div class="message-list transcript">${renderMessageTranscript(lead.conversation.messages)}</div>
        <a class="button button-soft" href="${adminPath("conversations", lead.conversation_id)}">Open full inquiry review</a>
      </section>
    </div>`;
  $("#leadForm").onsubmit = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await api(`/api/leads/${id}`, { method: "PUT", body: data });
    toast("Lead saved");
    leadDetailView(id);
  };
}

function field(name, label, value = "", type = "text") {
  return `<label>${label}<input type="${type}" name="${name}" value="${escapeHtml(value || "")}" /></label>`;
}

/**
 * knowledgeBaseView() now lives in /intake-wizard.js — it became the intake
 * wizard on 2026-08-17 (HANDOFF-CLOSER.md §18). The old bare add-a-Q&A form
 * that used to be here is gone: it asked for a "Question" and an "Answer",
 * which is not the shape of a price list, a promo or a shipping table.
 * The nav item and route name are unchanged (§12 locks the nav).
 */

async function questionsView() {
  setTitle("Qualification Questions");
  const rows = await api("/api/qualification-questions");
  $("#adminContent").innerHTML = `
    <div class="split">
      <section class="panel">
        <h2>Add qualification question</h2>
        <form id="questionForm" class="form-grid">
          ${field("question", "Question")}
          ${field("field_key", "Field key")}
          ${field("display_order", "Display order", "", "number")}
          <button class="button button-primary full" type="submit">Add Question</button>
        </form>
      </section>
      <section class="panel">
        <h2>Question flow</h2>
        <div class="table-wrap"><table><thead><tr><th>Order</th><th>Question</th><th>Field</th><th>Required</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${r.display_order}</td><td>${r.question}</td><td>${r.field_key}</td><td>${r.required ? "Yes" : "No"}</td></tr>`).join("")}</tbody></table></div>
      </section>
    </div>`;
  $("#questionForm").onsubmit = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.display_order = Number(data.display_order || 0);
    data.required = true;
    await api("/api/qualification-questions", { method: "POST", body: data });
    toast("Question added");
    questionsView();
  };
}

async function quotationsView() {
  setTitle("Quotations");
  const rows = await api("/api/quotations");
  $("#adminContent").innerHTML = `
    <section class="panel">
      <div class="panel-header"><h2>Quotation draft workflow</h2><span>${rows.length} quotations</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Quotation Number</th><th>Customer</th><th>Service Needed</th><th>Amount</th><th>Status</th><th>Mode</th><th>Created Date</th><th>Sent Date</th></tr></thead>
        <tbody>${rows.map((q) => `
          <tr>
            <td>${rowLink("quotations", q.id, q.quotation_number)}</td>
            <td>${q.customer_name || q.customer_company || "TBD"}</td>
            <td>${q.service_needed || "TBD"}</td>
            <td>${money(q.amount)}</td>
            <td>${statusPill(q.status)}</td>
            <td>${q.mode}</td>
            <td>${fmtDate(q.created_at)}</td>
            <td>${fmtDate(q.sent_at)}</td>
          </tr>`).join("")}</tbody>
      </table></div>
    </section>`;
}

const BOOKING_STATUS_OPTIONS = ["requested", "pending_confirmation", "confirmed", "paid", "cancelled", "completed", "no_show"];
const BOOKING_FIELD_LIBRARY = [
  { key: "name", label: "Customer name", type: "text" },
  { key: "mobile", label: "Mobile number", type: "tel" },
  { key: "email", label: "Email", type: "email" },
  { key: "company_name", label: "Company / organization", type: "text" },
  { key: "website", label: "Website", type: "url" },
  { key: "purpose", label: "Purpose (repair, meeting, onboarding, reservation)", type: "text" },
  { key: "service_package", label: "Service / package chosen", type: "text" },
  { key: "preferred_date", label: "Preferred date", type: "date" },
  { key: "preferred_time", label: "Preferred time", type: "time" },
  { key: "preferred_meeting_channel", label: "Preferred meeting channel", type: "text" },
  { key: "meeting_link", label: "Meeting link", type: "url" },
  { key: "onboarding_topic", label: "Onboarding/setup topic", type: "text" },
  { key: "branch_location", label: "Branch / location", type: "text" },
  { key: "party_size", label: "Party size", type: "number" },
  { key: "guest_count", label: "Number of guests", type: "number" },
  { key: "check_in_date", label: "Check-in date", type: "date" },
  { key: "check_out_date", label: "Check-out date", type: "date" },
  { key: "room_type", label: "Room type", type: "text" },
  { key: "table_preference", label: "Table preference", type: "text" },
  { key: "doctor_preference", label: "Doctor / specialist preference", type: "text" },
  { key: "staff_preference", label: "Staff preference", type: "text" },
  { key: "therapist_preference", label: "Therapist preference", type: "text" },
  { key: "vehicle_model", label: "Vehicle / model", type: "text" },
  { key: "property_unit", label: "Property / unit", type: "text" },
  { key: "address", label: "Address / service location", type: "text" },
  { key: "concern", label: "Concern / reason for visit", type: "textarea" },
  { key: "special_requests", label: "Special requests", type: "textarea" },
  { key: "notes_remarks", label: "Notes / remarks", type: "textarea" },
  { key: "deposit_payment", label: "Deposit/payment needed", type: "text" },
  { key: "staff_confirmation_required", label: "Staff confirmation required", type: "text" }
];
const BOOKING_FIELD_BY_KEY = Object.fromEntries(BOOKING_FIELD_LIBRARY.map((field) => [field.key, field]));
const BOOKING_FIXED_FORM_FIELDS = new Set(["name", "mobile", "email", "service_package", "preferred_date", "preferred_time"]);
const BOOKING_PRESETS = {
  general: {
    label: "General appointment",
    fields: ["name", "mobile", "purpose", "service_package", "preferred_date", "preferred_time", "notes_remarks", "staff_confirmation_required"]
  },
  ai_service_onboarding: {
    label: "AI service / onboarding meeting",
    fields: ["name", "mobile", "email", "preferred_date", "preferred_time"]
  },
  spa_salon: {
    label: "Spa / salon",
    fields: ["name", "mobile", "service_package", "preferred_date", "preferred_time", "branch_location", "therapist_preference", "special_requests", "deposit_payment", "staff_confirmation_required"]
  },
  clinic_doctor: {
    label: "Clinic / doctor",
    fields: ["name", "mobile", "email", "purpose", "concern", "doctor_preference", "preferred_date", "preferred_time", "branch_location", "staff_confirmation_required"]
  },
  restaurant: {
    label: "Restaurant reservation",
    fields: ["name", "mobile", "preferred_date", "preferred_time", "party_size", "branch_location", "table_preference", "special_requests", "deposit_payment"]
  },
  hotel_lodging: {
    label: "Hotel / lodging",
    fields: ["name", "mobile", "email", "guest_count", "check_in_date", "check_out_date", "room_type", "special_requests", "deposit_payment", "staff_confirmation_required"]
  },
  repair_home_service: {
    label: "Repair / home service",
    fields: ["name", "mobile", "purpose", "concern", "address", "preferred_date", "preferred_time", "vehicle_model", "notes_remarks", "staff_confirmation_required"]
  },
  gym_class: {
    label: "Gym / class",
    fields: ["name", "mobile", "service_package", "preferred_date", "preferred_time", "branch_location", "guest_count", "notes_remarks"]
  },
  school_enrollment: {
    label: "School / enrollment appointment",
    fields: ["name", "mobile", "email", "purpose", "preferred_date", "preferred_time", "branch_location", "notes_remarks", "staff_confirmation_required"]
  },
  church_ministry: {
    label: "Church / ministry meeting",
    fields: ["name", "mobile", "purpose", "preferred_date", "preferred_time", "branch_location", "guest_count", "notes_remarks"]
  },
  real_estate: {
    label: "Real estate viewing",
    fields: ["name", "mobile", "email", "property_unit", "preferred_date", "preferred_time", "branch_location", "guest_count", "notes_remarks", "staff_confirmation_required"]
  },
  car_dealership: {
    label: "Car dealership / test drive",
    fields: ["name", "mobile", "email", "vehicle_model", "preferred_date", "preferred_time", "branch_location", "notes_remarks", "staff_confirmation_required"]
  },
  personal_service: {
    label: "Personal service",
    fields: ["name", "mobile", "purpose", "service_package", "preferred_date", "preferred_time", "address", "notes_remarks"]
  }
};

function bookingStatusSelect(booking) {
  return `<select class="booking-status-select" data-booking-status="${booking.id}">
    ${BOOKING_STATUS_OPTIONS.map((status) => `<option value="${status}" ${booking.status === status ? "selected" : ""}>${status.replace(/_/g, " ")}</option>`).join("")}
  </select>`;
}

function selectedBookingFields(setting) {
  const saved = Array.isArray(setting?.required_fields) ? setting.required_fields : [];
  if (saved.length) return saved.filter((key) => BOOKING_FIELD_BY_KEY[key]);
  const preset = BOOKING_PRESETS[setting?.booking_type || "general"] || BOOKING_PRESETS.general;
  return preset.fields;
}

function bookingFieldCheckboxes(setting) {
  const selected = new Set(selectedBookingFields(setting));
  return `<div class="booking-field-grid">
    ${BOOKING_FIELD_LIBRARY.map((field) => `<label class="booking-field-option">
      <input type="checkbox" name="required_fields" value="${field.key}" ${selected.has(field.key) ? "checked" : ""} />
      <span>${escapeHtml(field.label)}</span>
    </label>`).join("")}
  </div>`;
}

function bookingDynamicInputs(setting) {
  const fields = selectedBookingFields(setting)
    .map((key) => BOOKING_FIELD_BY_KEY[key])
    .filter((field) => field && !BOOKING_FIXED_FORM_FIELDS.has(field.key));
  if (!fields.length) return "";
  return `<div class="booking-extra-fields full">
    <p class="muted">Extra details for this booking type</p>
    <div class="form-grid">
      ${fields.map((bookingField) => {
        if (bookingField.type === "textarea") {
          return `<label class="full">${escapeHtml(bookingField.label)}<textarea name="field_${bookingField.key}" rows="2"></textarea></label>`;
        }
        return field(`field_${bookingField.key}`, bookingField.label, "", bookingField.type);
      }).join("")}
    </div>
  </div>`;
}

function bookingDetailsSummary(booking) {
  const values = booking.field_values && typeof booking.field_values === "object" ? booking.field_values : {};
  const details = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
    .map(([key, value]) => `${BOOKING_FIELD_BY_KEY[key]?.label || key}: ${value}`);
  return [booking.notes || "", ...details].filter(Boolean).join("\n");
}

function bookingDayKey(value) {
  const date = new Date(value);
  return date.toLocaleDateString("en-CA");
}

function monthKey(value) {
  const date = new Date(value);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function monthStartFromKey(key) {
  const [year, month] = String(key || "").split("-").map(Number);
  if (!year || !month) {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1);
  }
  return new Date(year, month - 1, 1);
}

function formatBookingTime(value) {
  return new Date(value).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" });
}

function renderBookingCalendar(bookings) {
  const today = new Date();
  const currentMonth = monthStartFromKey(state.bookingCalendarMonth || monthKey(today));
  const calendarStart = new Date(currentMonth);
  calendarStart.setDate(currentMonth.getDate() - currentMonth.getDay());
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(calendarStart);
    date.setDate(calendarStart.getDate() + index);
    return date;
  });
  const grouped = bookings.reduce((acc, booking) => {
    const key = bookingDayKey(booking.start_at);
    if (!acc[key]) acc[key] = [];
    acc[key].push(booking);
    return acc;
  }, {});

  const monthTitle = currentMonth.toLocaleDateString("en-PH", { month: "long", year: "numeric" });

  return `<div class="booking-calendar-shell">
    <div class="booking-calendar-toolbar">
      <div>
        <h2>${escapeHtml(monthTitle)}</h2>
        <p class="muted">Click any booking to view customer, contact, meeting link, and notes.</p>
      </div>
      <div class="booking-calendar-nav" aria-label="Calendar navigation">
        <button class="button button-soft" type="button" data-booking-month-nav="-1" aria-label="Previous month">&lsaquo;</button>
        <button class="button button-soft" type="button" data-booking-month-today>Today</button>
        <button class="button button-soft" type="button" data-booking-month-nav="1" aria-label="Next month">&rsaquo;</button>
      </div>
    </div>
    <div class="booking-calendar-weekdays" aria-hidden="true">
      ${["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((day) => `<span>${day}</span>`).join("")}
    </div>
    <div class="booking-calendar">
    ${days.map((date) => {
      const key = bookingDayKey(date);
      const items = [...(grouped[key] || [])].sort((a, b) => new Date(a.start_at) - new Date(b.start_at));
      const dayClass = [
        "booking-day",
        key === bookingDayKey(today) ? "is-today" : "",
        date.getMonth() !== currentMonth.getMonth() ? "is-outside-month" : ""
      ].filter(Boolean).join(" ");
      return `<article class="${dayClass}">
        <header><b>${date.toLocaleDateString("en-PH", { weekday: "short" })}</b><span>${date.getDate()}</span></header>
        ${items.slice(0, 3).map((booking) => `<button class="booking-chip ${booking.status}" type="button" data-booking-detail="${escapeHtml(booking.id)}" aria-label="View ${escapeHtml(booking.service_name)} booking at ${formatBookingTime(booking.start_at)}">
          <time>${formatBookingTime(booking.start_at)}</time>
          <span>${escapeHtml(booking.service_name)}</span>
        </button>`).join("")}
        ${items.length > 3 ? `<small>+${items.length - 3} more</small>` : ""}
      </article>`;
    }).join("")}
    </div>
  </div>`;
}

function showBookingDetails(booking) {
  if (!booking) return;
  const values = booking.field_values && typeof booking.field_values === "object" ? booking.field_values : {};
  const detailRows = Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== null && String(value).trim())
    .map(([key, value]) => `<div><dt>${escapeHtml(BOOKING_FIELD_BY_KEY[key]?.label || key.replace(/_/g, " "))}</dt><dd>${escapeHtml(value)}</dd></div>`)
    .join("");
  const contact = [booking.mobile_number, booking.email].filter(Boolean).join(" · ") || "—";
  const meetingLink = values.meeting_link || "";
  const wrap = document.createElement("div");
  wrap.className = "intake-modal-backdrop";
  wrap.innerHTML = `
    <div class="intake-modal booking-detail-modal">
      <div class="booking-detail-header">
        <div>
          <p class="settings-group">Booking details</p>
          <h3>${escapeHtml(booking.service_name)}</h3>
        </div>
        ${statusPill(booking.status)}
      </div>
      <dl class="booking-detail-list">
        <div><dt>Schedule</dt><dd>${fmtDate(booking.start_at)} to ${formatBookingTime(booking.end_at)}</dd></div>
        <div><dt>Customer</dt><dd>${escapeHtml(booking.customer_name || "—")}</dd></div>
        <div><dt>Contact</dt><dd>${escapeHtml(contact)}</dd></div>
        ${booking.source ? `<div><dt>Source</dt><dd>${escapeHtml(booking.source.replace(/_/g, " "))}</dd></div>` : ""}
        ${detailRows}
        ${booking.notes ? `<div class="full"><dt>Notes</dt><dd>${escapeHtml(booking.notes)}</dd></div>` : ""}
      </dl>
      <div class="intake-modal-actions">
        ${meetingLink ? `<a class="button button-green" href="${escapeHtml(meetingLink)}" target="_blank" rel="noopener">Open meeting link</a>` : ""}
        <button class="button button-soft" id="bookingDetailClose" type="button">Close</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => {
    wrap.remove();
    window.removeEventListener("keydown", handleEscape);
  };
  function handleEscape(event) {
    if (event.key === "Escape") close();
  }
  wrap.querySelector("#bookingDetailClose").onclick = close;
  wrap.onclick = (event) => { if (event.target === wrap) close(); };
  window.addEventListener("keydown", handleEscape);
}

async function bookingsView() {
  setTitle("Bookings");
  const data = await api("/api/bookings");
  const activeServices = data.services.filter((service) => service.active);
  const serviceOptions = activeServices.map((service) => `<option value="${service.id}">${escapeHtml(service.name)} · ${service.duration_minutes} min</option>`).join("");
  const bookingType = data.setting.booking_type || "general";
  const fieldMode = data.setting.field_mode || "preset";
  const nextHour = new Date(Date.now() + 60 * 60 * 1000);
  nextHour.setMinutes(0, 0, 0);

  $("#adminContent").innerHTML = `
    <div class="settings-stack booking-stack">
      <section class="panel">
        <div class="panel-header">
          <div>
            <h2>Booking calendar</h2>
            <p class="muted settings-lede">Available in every workspace. Turn it on only when this business wants Closer or staff to collect appointment or reservation details.</p>
          </div>
          ${data.setting.enabled ? statusPill("enabled") : statusPill("inactive")}
        </div>
        <form id="bookingSettingsForm" class="form-grid">
          <label>Booking feature
            <select name="enabled">
              <option value="false" ${!data.setting.enabled ? "selected" : ""}>Off</option>
              <option value="true" ${data.setting.enabled ? "selected" : ""}>On</option>
            </select>
          </label>
          ${field("timezone", "Timezone", data.setting.timezone || "Asia/Manila")}
          ${field("slot_interval_minutes", "Slot interval minutes", data.setting.slot_interval_minutes || 30, "number")}
          ${field("min_notice_minutes", "Minimum notice minutes", data.setting.min_notice_minutes || 120, "number")}
          ${field("max_days_ahead", "Max days ahead", data.setting.max_days_ahead || 30, "number")}
          <label>Booking type
            <select name="booking_type" id="bookingTypeSelect">
              ${Object.entries(BOOKING_PRESETS).map(([key, preset]) => `<option value="${key}" ${bookingType === key ? "selected" : ""}>${escapeHtml(preset.label)}</option>`).join("")}
            </select>
          </label>
          <label>Field setup
            <select name="field_mode">
              <option value="preset" ${fieldMode === "preset" ? "selected" : ""}>Use preset checklist</option>
              <option value="custom" ${fieldMode === "custom" ? "selected" : ""}>Customize fields</option>
            </select>
          </label>
          <div class="full booking-fields-panel">
            <div class="panel-header">
              <div>
                <h2>Details Closer or staff should collect</h2>
                <p class="muted settings-lede">Use the preset, or check the exact fields this tenant needs. Purpose covers repair, meeting, onboarding, reservation, and similar intent.</p>
              </div>
            </div>
            ${bookingFieldCheckboxes(data.setting)}
          </div>
          <label class="full">Booking instructions for staff and Closer
            <textarea name="instructions" rows="4" placeholder="Example: Ask for preferred branch, service, date, time, name and mobile. Confirm only after staff checks availability.">${escapeHtml(data.setting.instructions || "")}</textarea>
          </label>
          <button class="button button-primary" type="submit">Save booking settings</button>
        </form>
        <div class="booking-calendar-feed">
          <div>
            <b>Google Calendar feed</b>
            <p class="muted">Copy this private URL, then add it in Google Calendar under Other calendars → From URL.</p>
          </div>
          <div class="booking-feed-copy">
            <input id="bookingCalendarFeedUrl" value="${escapeHtml(data.calendar_feed_url || "")}" readonly />
            <button class="button button-soft" id="copyBookingCalendarFeed" type="button">Copy link</button>
          </div>
        </div>
      </section>

      <div class="split">
        <section class="panel">
          <div class="panel-header"><h2>Services</h2><span>${data.services.length} configured</span></div>
          <form id="bookingServiceForm" class="form-grid">
            ${field("name", "Service or appointment name")}
            ${field("duration_minutes", "Duration minutes", "60", "number")}
            ${field("price", "Price, if fixed", "", "number")}
            ${field("deposit_amount", "Deposit/reservation fee", "", "number")}
            ${field("location", "Branch/location")}
            <label class="full">Description<textarea name="description" rows="3" placeholder="Short description, inclusions, or who this booking is for."></textarea></label>
            <button class="button button-soft" type="submit">Add service</button>
          </form>
          <div class="booking-service-list">
            ${data.services.map((service) => `<article class="booking-service ${service.active ? "" : "is-inactive"}">
              <div>
                <b>${escapeHtml(service.name)}</b>
                <p>${service.duration_minutes} min${service.price ? ` · ${money(service.price)}` : ""}${service.deposit_amount ? ` · deposit ${money(service.deposit_amount)}` : ""}${service.location ? ` · ${escapeHtml(service.location)}` : ""}</p>
              </div>
              <label class="booking-toggle"><input type="checkbox" data-service-active="${service.id}" ${service.active ? "checked" : ""} /> Active</label>
            </article>`).join("") || `<p class="muted">No services yet. Add one service so bookings have a duration.</p>`}
          </div>
        </section>

        <section class="panel">
          <div class="panel-header"><h2>Add booking</h2><span>${data.bookings.length} upcoming</span></div>
          <form id="bookingForm" class="form-grid">
            <label>Service
              <select name="service_id">
                <option value="">Custom / not listed</option>
                ${serviceOptions}
              </select>
            </label>
            ${field("service_name", "Custom service name")}
            ${field("customer_name", "Customer name")}
            ${field("mobile_number", "Mobile number", "", "tel")}
            ${field("email", "Email", "", "email")}
            ${field("start_at", "Date and time", localDateTimeValue(nextHour), "datetime-local")}
            <label>Status
              <select name="status">
                ${BOOKING_STATUS_OPTIONS.map((status) => `<option value="${status}">${status.replace(/_/g, " ")}</option>`).join("")}
              </select>
            </label>
            <label class="full">Notes<textarea name="notes" rows="3" placeholder="Preferred branch, concern, party size, staff note, or pending confirmation detail."></textarea></label>
            ${bookingDynamicInputs(data.setting)}
            <button class="button button-primary" type="submit">Save booking</button>
          </form>
        </section>
      </div>

      <section class="panel">
        <div class="panel-header"><h2>Calendar</h2><span>${data.setting.enabled ? "Active" : "Inactive until enabled"}</span></div>
        ${renderBookingCalendar(data.bookings)}
      </section>

      <section class="panel">
        <div class="panel-header"><h2>Booking requests</h2><span>${data.bookings.length} records</span></div>
        ${data.bookings.length ? `<div class="table-wrap"><table>
          <thead><tr><th>When</th><th>Customer</th><th>Service</th><th>Contact</th><th>Status</th><th>Notes</th></tr></thead>
          <tbody>${data.bookings.map((booking) => `<tr>
            <td>${fmtDate(booking.start_at)}<br><span class="muted">until ${new Date(booking.end_at).toLocaleTimeString("en-PH", { hour: "numeric", minute: "2-digit" })}</span></td>
            <td>${escapeHtml(booking.customer_name)}</td>
            <td>${escapeHtml(booking.service_name)}</td>
            <td>${escapeHtml([booking.mobile_number, booking.email].filter(Boolean).join(" · ") || "—")}</td>
            <td>${bookingStatusSelect(booking)}</td>
            <td>${escapeHtml(bookingDetailsSummary(booking))}</td>
          </tr>`).join("")}</tbody>
        </table></div>` : `<p class="muted">No bookings yet. When enabled later for Closer, appointment requests can appear here from Messenger or website chat.</p>`}
      </section>
    </div>`;

  $("#bookingTypeSelect")?.addEventListener("change", (event) => {
    const preset = BOOKING_PRESETS[event.currentTarget.value];
    if (!preset) return;
    const selected = new Set(preset.fields);
    document.querySelectorAll("input[name='required_fields']").forEach((input) => {
      input.checked = selected.has(input.value);
    });
  });

  $("#bookingSettingsForm").onsubmit = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const form = Object.fromEntries(formData);
    await api("/api/bookings/settings", {
      method: "PUT",
      body: {
        enabled: form.enabled === "true",
        timezone: form.timezone,
        slot_interval_minutes: Number(form.slot_interval_minutes || 30),
        min_notice_minutes: Number(form.min_notice_minutes || 120),
        max_days_ahead: Number(form.max_days_ahead || 30),
        booking_type: form.booking_type || "general",
        field_mode: form.field_mode || "preset",
        required_fields: formData.getAll("required_fields"),
        instructions: form.instructions || ""
      }
    });
    toast("Booking settings saved");
    bookingsView();
  };

  $("#copyBookingCalendarFeed")?.addEventListener("click", async () => {
    const input = $("#bookingCalendarFeedUrl");
    input.select();
    input.setSelectionRange(0, input.value.length);
    try {
      await navigator.clipboard.writeText(input.value);
      toast("Calendar feed link copied");
    } catch {
      document.execCommand("copy");
      toast("Calendar feed link selected");
    }
  });

  $("#bookingServiceForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = Object.fromEntries(new FormData(event.currentTarget));
    await api("/api/bookings/services", {
      method: "POST",
      body: {
        ...form,
        duration_minutes: Number(form.duration_minutes || 60),
        price: form.price || null,
        deposit_amount: form.deposit_amount || null,
        active: true
      }
    });
    toast("Booking service added");
    bookingsView();
  };

  $("#bookingForm").onsubmit = async (event) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const form = Object.fromEntries(formData);
    const fieldValues = {};
    for (const [key, value] of formData.entries()) {
      if (key.startsWith("field_") && String(value).trim()) {
        fieldValues[key.replace(/^field_/, "")] = value;
      }
    }
    await api("/api/bookings", {
      method: "POST",
      body: {
        ...form,
        service_id: form.service_id || null,
        service_name: form.service_name || null,
        field_values: fieldValues
      }
    });
    toast("Booking saved");
    bookingsView();
  };

  document.querySelectorAll("[data-service-active]").forEach((input) => {
    input.onchange = async () => {
      await api(`/api/bookings/services/${input.dataset.serviceActive}`, { method: "PUT", body: { active: input.checked } });
      toast(input.checked ? "Service activated" : "Service deactivated");
      bookingsView();
    };
  });

  document.querySelectorAll("[data-booking-status]").forEach((select) => {
    select.onchange = async () => {
      await api(`/api/bookings/${select.dataset.bookingStatus}/status`, { method: "PUT", body: { status: select.value } });
      toast("Booking status updated");
      bookingsView();
    };
  });

  document.querySelectorAll("[data-booking-month-nav]").forEach((button) => {
    button.onclick = () => {
      const base = monthStartFromKey(state.bookingCalendarMonth || monthKey(new Date()));
      base.setMonth(base.getMonth() + Number(button.dataset.bookingMonthNav || 0));
      state.bookingCalendarMonth = monthKey(base);
      bookingsView();
    };
  });

  $("[data-booking-month-today]")?.addEventListener("click", () => {
    state.bookingCalendarMonth = monthKey(new Date());
    bookingsView();
  });

  document.querySelectorAll("[data-booking-detail]").forEach((button) => {
    button.onclick = () => {
      const booking = data.bookings.find((item) => String(item.id) === String(button.dataset.bookingDetail));
      showBookingDetails(booking);
    };
  });
}

async function quotationDetailView(id) {
  setTitle("Quotation Detail");
  const q = await api(`/api/quotations/${id}`);
  $("#adminContent").innerHTML = `
    <div class="split">
      <section class="panel">
        <div class="panel-header"><h2>${q.quotation_number}</h2>${statusPill(q.status)}</div>
        <form id="quoteForm" class="form-grid">
          ${field("customer_name", "Customer", q.customer_name)}
          ${field("customer_company", "Customer company", q.customer_company)}
          ${field("service_needed", "Service needed", q.service_needed)}
          ${field("amount", "Amount", q.amount || "", "number")}
          <label class="full">Quotation details<textarea name="quotation_details">${q.quotation_details || ""}</textarea></label>
          <label class="full">Terms<textarea name="terms">${q.terms || ""}</textarea></label>
          <button class="button button-soft" type="submit">Edit Quotation</button>
        </form>
        <div class="actions-row">
          <button class="button button-green" data-action="approve">Approve Quotation</button>
          <button class="button button-danger" data-action="reject">Reject Quotation</button>
          <button class="button button-primary" data-action="send">Send Quotation</button>
        </div>
      </section>
      <section class="panel">
        <h2>Lead and conversation context</h2>
        <p><b>Lead:</b> ${q.lead.customer_name || "Unknown"} · ${q.lead.company_name || "No company yet"}</p>
        <div class="message-list">${q.conversation.messages.map((m) => `<div class="message ${m.sender_type}"><small>${m.sender_type}</small>${m.message_text}</div>`).join("")}</div>
      </section>
    </div>`;
  $("#quoteForm").onsubmit = async (event) => {
    event.preventDefault();
    await api(`/api/quotations/${id}`, { method: "PUT", body: Object.fromEntries(new FormData(event.currentTarget)) });
    toast("Quotation updated");
    quotationDetailView(id);
  };
  document.querySelectorAll("[data-action]").forEach((button) => {
    button.onclick = async () => {
      await api(`/api/quotations/${id}/${button.dataset.action}`, { method: "POST", body: {} });
      toast(`Quotation ${button.dataset.action} complete`);
      quotationDetailView(id);
    };
  });
}

async function followUpsView() {
  setTitle("Follow-ups");
  const rows = await api("/api/follow-ups");
  $("#adminContent").innerHTML = `
    <section class="panel">
      <div class="panel-header"><h2>Basic follow-up tracker</h2><span>${rows.length} tasks</span></div>
      <div class="table-wrap"><table>
        <thead><tr><th>Due Date</th><th>Status</th><th>Lead</th><th>Company</th><th>Note</th><th>Assigned</th></tr></thead>
        <tbody>${rows.map((f) => `<tr><td>${fmtDate(f.due_date)}</td><td>${statusPill(f.status)}</td><td>${rowLink("leads", f.lead_id, f.lead.customer_name || "Lead")}</td><td>${f.lead.company_name || "TBD"}</td><td>${f.note || ""}</td><td>${f.assigned_user?.name || "Unassigned"}</td></tr>`).join("")}</tbody>
      </table></div>
    </section>`;
}

async function aiStudioView() {
  setTitle("AI Studio");
  // REPLACED 2026-08-18. The old screen edited `ai_custom_instructions` via
  // aistaff-ai-config, which only ever reached the SITE CHAT widget — editing
  // it did nothing to Messenger replies. This edits the real thing: the
  // instruction block generateSalesReply() sends on every reply.
  const data = await api("/api/prompts/closer");
  const active = data.active;
  const models = await api("/api/models");

  $("#adminContent").innerHTML = `
    <div class="settings-stack">
      <div class="panel" style="padding:0;display:flex;gap:0;overflow:hidden">
        <button class="button button-primary" id="tabCloser" style="flex:1;border-radius:0;margin:0">Closer</button>
        <button class="button button-soft" id="tabDemoPage" style="flex:1;border-radius:0;margin:0">Demo Page</button>
        <button class="button button-soft" id="tabPitch" style="flex:1;border-radius:0;margin:0">Pitch (voice)</button>
      </div>
      <section class="panel">
        <div class="panel-header">
          <h2>Closer instructions${active ? ` — v${active.version} live` : ""}</h2>
          <span class="muted">${active ? `saved ${new Date(active.created_at).toLocaleString()} by ${escapeHtml(active.created_by || "seed")}` : ""}</span>
        </div>
        <p class="muted settings-lede">These govern <b>every</b> customer's Closer, on Messenger and on the website widget. They are the highest authority — a customer's own instructions add to these and can never cancel them. Saving creates a new version; nothing is overwritten.</p>
        <form id="promptForm" class="form-grid">
          <label class="full">Instructions
            <textarea name="content" rows="22" spellcheck="false">${escapeHtml(active ? active.content : "")}</textarea>
          </label>
          <label class="full">What changed? (shown in the history below)
            <input type="text" name="note" maxlength="300" placeholder="e.g. Told it to keep replies short and bullet long lists" />
          </label>
          <button class="button button-primary" type="submit">Save as new version</button>
        </form>
      </section>

      <section class="panel">
        <h2>Version history (${data.revisions.length})</h2>
        <p class="muted settings-lede">Every version that has run. Roll back to put an earlier one live immediately.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Version</th><th>Saved</th><th>By</th><th>What changed</th><th>Actions</th></tr></thead>
          <tbody>${data.revisions.map((r) => `<tr>
            <td>${r.is_active ? `<b>v${r.version}</b> <span class="prompt-live">LIVE</span>` : `v${r.version}`}</td>
            <td>${new Date(r.created_at).toLocaleString()}</td>
            <td class="muted">${escapeHtml(r.created_by || "seed")}</td>
            <td>${escapeHtml(r.note || "—")}</td>
            <td class="intake-kb-actions">
              <button type="button" class="intake-link" data-view-prompt="${r.version}">View</button>
              ${r.is_active ? "" : `<button type="button" class="intake-link" data-rollback="${r.version}">Roll back</button>`}
            </td>
          </tr>`).join("")}</tbody>
        </table></div>
      </section>

      <section class="panel">
        <h2>Models</h2>
        <p class="muted settings-lede">Which model runs each function. Prices are USD per million tokens and change as you choose — Closer sends a large prompt and a short reply, so <b>input price is what matters</b>.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Function</th><th>Model</th><th>Input / Output</th><th>Est. per 1,000 replies</th></tr></thead>
          <tbody>${models.settings.filter((s) => s.fn !== "demo_agent").map((s) => `
            <tr>
              <td><b>${escapeHtml(s.label)}</b><br /><span class="muted">${escapeHtml(s.detail)}</span></td>
              <td>
                <select data-model-fn="${s.fn}">
                  ${models.catalogue.map((c) => `<option value="${c.provider}|${c.model}" ${c.model === s.model ? "selected" : ""}>${escapeHtml(c.label)}</option>`).join("")}
                </select>
              </td>
              <td class="model-price" data-price-for="${s.fn}">—</td>
              <td class="model-est" data-est-for="${s.fn}">—</td>
            </tr>`).join("")}</tbody>
        </table></div>
        <p class="muted">Gemini 3.x introductory pricing ends 31 December 2026 and doubles on 1 January 2027. Budget on the 2027 rate for anything still running next year.</p>
      </section>
    </div>`;

  // Price updates as the dropdown changes, so a choice is never blind.
  // Estimate assumes the real shape of a Closer call: a large prompt (roughly
  // 15,000 tokens of instructions plus knowledge base) and a short reply
  // (~200 tokens). That is why input price dominates.
  const EST_IN = 15000;
  const EST_OUT = 200;
  const priceFor = (value) => {
    const [, model] = String(value).split("|");
    return models.catalogue.find((c) => c.model === model) || null;
  };
  const paintPrice = (fn, value) => {
    const c = priceFor(value);
    const priceCell = document.querySelector(`[data-price-for="${fn}"]`);
    const estCell = document.querySelector(`[data-est-for="${fn}"]`);
    if (!c || c.inCents == null) {
      priceCell.textContent = "price not published";
      estCell.textContent = "—";
      return;
    }
    priceCell.textContent = `$${(c.inCents / 100).toFixed(2)} / $${(c.outCents / 100).toFixed(2)}`;
    const usd = (EST_IN / 1e6) * (c.inCents / 100) * 1000 + (EST_OUT / 1e6) * (c.outCents / 100) * 1000;
    estCell.innerHTML = `$${usd.toFixed(2)} <span class="muted">≈ ₱${Math.round(usd * 58).toLocaleString()}</span>`;
  };

  $("#tabPitch").onclick = () => pitchStudioView();
  $("#tabCloser").onclick = () => aiStudioView();
  $("#tabDemoPage").onclick = () => demoPageStudioView();

  document.querySelectorAll("[data-model-fn]").forEach((select) => {
    select.dataset.current = select.value;
    paintPrice(select.dataset.modelFn, select.value);
    select.onchange = async () => {
      const [provider, model] = select.value.split("|");
      const previous = select.dataset.current || "";
      try {
        await api("/api/models", { method: "POST", body: { fn: select.dataset.modelFn, provider, model } });
        select.dataset.current = select.value;
        paintPrice(select.dataset.modelFn, select.value);
        toast(`${select.dataset.modelFn} now uses ${model}`);
      } catch (error) {
        // Revert the dropdown so it never shows a model that was refused.
        if (previous) select.value = previous;
        paintPrice(select.dataset.modelFn, select.value);
        toast(error.message);
      }
    };
  });

  $("#promptForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api("/api/prompts/closer", {
        method: "POST",
        body: { content: form.get("content"), note: form.get("note") || null }
      });
      toast(`Saved as v${result.version} — live on the next message`);
      aiStudioView();
    } catch (error) {
      toast(error.message);
    }
  };

  document.querySelectorAll("[data-view-prompt]").forEach((btn) => {
    btn.onclick = () => {
      const rev = data.revisions.find((r) => String(r.version) === btn.dataset.viewPrompt);
      if (rev) showPromptRevision(rev);
    };
  });

  document.querySelectorAll("[data-rollback]").forEach((btn) => {
    btn.onclick = async () => {
      const version = Number(btn.dataset.rollback);
      if (!window.confirm(`Roll back to v${version}? It becomes live on the next customer message.`)) return;
      await api("/api/prompts/closer/activate", { method: "POST", body: { version } });
      toast(`v${version} is live again`);
      aiStudioView();
    };
  });
}

async function demoPageStudioView() {
  setTitle("AI Studio");
  const data = await api("/api/prompts/demo-page");
  const active = data.active;
  const models = await api("/api/models");
  const demoSetting = models.settings.find((s) => s.fn === "demo_agent") || {
    fn: "demo_agent",
    label: "Demo agent",
    detail: "The public demo page conversation.",
    provider: "gemini",
    model: "gemini-3.5-flash-lite"
  };

  $("#adminContent").innerHTML = `
    <div class="settings-stack">
      <div class="panel" style="padding:0;display:flex;gap:0;overflow:hidden">
        <button class="button button-soft" id="tabCloser" style="flex:1;border-radius:0;margin:0">Closer</button>
        <button class="button button-primary" id="tabDemoPage" style="flex:1;border-radius:0;margin:0">Demo Page</button>
        <button class="button button-soft" id="tabPitch" style="flex:1;border-radius:0;margin:0">Pitch (voice)</button>
      </div>
      <section class="panel">
        <div class="panel-header">
          <h2>Demo Page instructions${active ? ` — v${active.version} live` : ""}</h2>
          <span class="muted">${active ? `saved ${new Date(active.created_at).toLocaleString()} by ${escapeHtml(active.created_by || "seed")}` : ""}</span>
        </div>
        <p class="muted settings-lede">These govern the public demo on the Closer landing page. The demo should act as the prospect's own business assistant, using the website, product description, and uploaded files they provide. Saving creates a new version; rollback is immediate.</p>
        <form id="demoPromptForm" class="form-grid">
          <label class="full">Instructions
            <textarea name="content" rows="18" spellcheck="false">${escapeHtml(active ? active.content : "")}</textarea>
          </label>
          <label class="full">What changed? (shown in the history below)
            <input type="text" name="note" maxlength="300" placeholder="e.g. Told the demo to ask one sales question when details are missing" />
          </label>
          <button class="button button-primary" type="submit">Save as new version</button>
        </form>
      </section>

      <section class="panel">
        <h2>Demo Page model</h2>
        <p class="muted settings-lede">This model answers customers who try the public demo. It is separate from the real Closer model used for tenant Messenger conversations.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Function</th><th>Model</th><th>Input / Output</th><th>Est. per 1,000 demo replies</th></tr></thead>
          <tbody><tr>
            <td><b>${escapeHtml(demoSetting.label)}</b><br /><span class="muted">${escapeHtml(demoSetting.detail)}</span></td>
            <td>
              <select data-demo-model-fn="${demoSetting.fn}">
                ${models.catalogue.map((c) => `<option value="${c.provider}|${c.model}" ${c.provider === demoSetting.provider && c.model === demoSetting.model ? "selected" : ""}>${escapeHtml(c.label)}</option>`).join("")}
              </select>
            </td>
            <td class="model-price" data-demo-price-for="${demoSetting.fn}">—</td>
            <td class="model-est" data-demo-est-for="${demoSetting.fn}">—</td>
          </tr></tbody>
        </table></div>
      </section>

      <section class="panel">
        <h2>Version history (${data.revisions.length})</h2>
        <p class="muted settings-lede">Every demo prompt version that has run. Roll back to put an earlier one live immediately.</p>
        <div class="table-wrap"><table>
          <thead><tr><th>Version</th><th>Saved</th><th>By</th><th>What changed</th><th>Actions</th></tr></thead>
          <tbody>${data.revisions.map((r) => `<tr>
            <td>${r.is_active ? `<b>v${r.version}</b> <span class="prompt-live">LIVE</span>` : `v${r.version}`}</td>
            <td>${new Date(r.created_at).toLocaleString()}</td>
            <td class="muted">${escapeHtml(r.created_by || "seed")}</td>
            <td>${escapeHtml(r.note || "—")}</td>
            <td class="intake-kb-actions">
              <button type="button" class="intake-link" data-view-demo-prompt="${r.version}">View</button>
              ${r.is_active ? "" : `<button type="button" class="intake-link" data-demo-rollback="${r.version}">Roll back</button>`}
            </td>
          </tr>`).join("")}</tbody>
        </table></div>
      </section>
    </div>`;

  const EST_IN = 6000;
  const EST_OUT = 240;
  const priceFor = (value) => {
    const [, model] = String(value).split("|");
    return models.catalogue.find((c) => c.model === model) || null;
  };
  const paintDemoPrice = (fn, value) => {
    const c = priceFor(value);
    const priceCell = document.querySelector(`[data-demo-price-for="${fn}"]`);
    const estCell = document.querySelector(`[data-demo-est-for="${fn}"]`);
    if (!priceCell || !estCell) return;
    if (!c || c.inCents == null) {
      priceCell.textContent = "price not published";
      estCell.textContent = "—";
      return;
    }
    priceCell.textContent = `$${(c.inCents / 100).toFixed(2)} / $${(c.outCents / 100).toFixed(2)}`;
    const usd = (EST_IN / 1e6) * (c.inCents / 100) * 1000 + (EST_OUT / 1e6) * (c.outCents / 100) * 1000;
    estCell.innerHTML = `$${usd.toFixed(2)} <span class="muted">≈ ₱${Math.round(usd * 58).toLocaleString()}</span>`;
  };

  $("#tabCloser").onclick = () => aiStudioView();
  $("#tabDemoPage").onclick = () => demoPageStudioView();
  $("#tabPitch").onclick = () => pitchStudioView();

  document.querySelectorAll("[data-demo-model-fn]").forEach((select) => {
    select.dataset.current = select.value;
    paintDemoPrice(select.dataset.demoModelFn, select.value);
    select.onchange = async () => {
      const [provider, model] = select.value.split("|");
      const previous = select.dataset.current || "";
      try {
        await api("/api/models", { method: "POST", body: { fn: select.dataset.demoModelFn, provider, model } });
        select.dataset.current = select.value;
        paintDemoPrice(select.dataset.demoModelFn, select.value);
        toast(`${select.dataset.demoModelFn} now uses ${model}`);
      } catch (error) {
        if (previous) select.value = previous;
        paintDemoPrice(select.dataset.demoModelFn, select.value);
        toast(error.message);
      }
    };
  });

  $("#demoPromptForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      const result = await api("/api/prompts/demo-page", {
        method: "POST",
        body: { content: form.get("content"), note: form.get("note") || null }
      });
      toast(`Saved demo prompt as v${result.version}`);
      demoPageStudioView();
    } catch (error) {
      toast(error.message);
    }
  };

  document.querySelectorAll("[data-view-demo-prompt]").forEach((btn) => {
    btn.onclick = () => {
      const rev = data.revisions.find((r) => String(r.version) === btn.dataset.viewDemoPrompt);
      if (rev) showPromptRevision(rev);
    };
  });

  document.querySelectorAll("[data-demo-rollback]").forEach((btn) => {
    btn.onclick = async () => {
      const version = Number(btn.dataset.demoRollback);
      if (!window.confirm(`Roll the demo page prompt back to v${version}? It becomes live immediately.`)) return;
      await api("/api/prompts/demo-page/activate", { method: "POST", body: { version } });
      toast(`Demo page v${version} is live again`);
      demoPageStudioView();
    };
  });
}

function showPromptRevision(rev) {
  const wrap = document.createElement("div");
  wrap.className = "intake-modal-backdrop";
  wrap.innerHTML = `
    <div class="intake-modal is-wide">
      <h3>Version ${rev.version}${rev.is_active ? " (live)" : ""}</h3>
      <p class="muted">${new Date(rev.created_at).toLocaleString()} · ${escapeHtml(rev.created_by || "seed")} · ${rev.chars} characters</p>
      <pre class="intake-entry-view">${escapeHtml(rev.content)}</pre>
      <div class="intake-modal-actions"><button class="button button-soft" id="promptClose">Close</button></div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector("#promptClose").onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
}

async function legacyAiStudioView() {
  setTitle("AI Studio");
  const studio = await api("/api/ai-studio");
  $("#adminContent").innerHTML = `
    <div class="admin-grid">
      <section class="panel full-span">
        <div class="panel-header">
          <h2>AI mission & custom instructions</h2>
          <a class="button button-soft" href="${adminPath("knowledge-base")}">Manage knowledge base (${studio.knowledgeBaseCount})</a>
        </div>
        <p class="muted">The bot always gets the built-in mission below. Add extra instructions for tone, industry focus, or things to avoid. Knowledge base Q&amp;A is injected automatically.</p>
        <label class="full">Built-in mission (read-only)<textarea readonly rows="5">${escapeHtml(studio.defaultGoal)}</textarea></label>
        <form id="aiInstructionsForm" class="form-grid">
          <label class="full">Your custom instructions
            <textarea name="ai_custom_instructions" rows="10" placeholder="Example: For ministry clients like Word On The Go, emphasize discipleship group placement and Join comment handling. Never quote website chat in phase 1.">${escapeHtml(studio.customInstructions || "")}</textarea>
          </label>
          <button class="button button-primary" type="submit">Save instructions</button>
        </form>
      </section>

      <section class="panel">
        <h2>Messenger memory inspector</h2>
        <p class="muted">See what the demo bot remembers for a PSID — lead fields, page candidates, chat memory.</p>
        <form id="memoryInspectForm" class="form-grid">
          ${field("psid", "Messenger PSID", "27194322870254863")}
          <button class="button button-primary" type="submit">Load memory</button>
        </form>
        <div id="memoryInspectResult" class="memory-panel" hidden></div>
      </section>

      <section class="panel">
        <h2>Prompt preview</h2>
        <p class="muted">Exact system prompt the bot would send to OpenAI for a PSID + sample message.</p>
        <form id="promptPreviewForm" class="form-grid">
          ${field("psid", "Messenger PSID", "27194322870254863")}
          <label class="full">Sample customer message<textarea name="message" rows="2">Yes</textarea></label>
          <button class="button button-primary" type="submit">Preview prompt</button>
        </form>
        <pre id="promptPreviewResult" class="code-panel" hidden></pre>
      </section>

      <section class="panel full-span">
        <h2>Active knowledge base</h2>
        <div class="table-wrap"><table>
          <thead><tr><th>Category</th><th>Question</th><th>Answer</th><th>Active</th></tr></thead>
          <tbody>${studio.knowledgeBase.map((row) => `
            <tr>
              <td>${escapeHtml(row.category)}</td>
              <td>${escapeHtml(row.question)}</td>
              <td>${escapeHtml(row.answer)}</td>
              <td>${row.active ? "Yes" : "No"}</td>
            </tr>`).join("") || `<tr><td colspan="4">No knowledge entries yet.</td></tr>`}
          </tbody>
        </table></div>
      </section>
    </div>`;

  $("#aiInstructionsForm").onsubmit = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    await api("/api/ai-studio/instructions", { method: "PUT", body: data });
    toast("AI instructions saved");
    aiStudioView();
  };

  $("#memoryInspectForm").onsubmit = async (event) => {
    event.preventDefault();
    const psid = new FormData(event.currentTarget).get("psid");
    const result = await api(`/api/ai-studio/memory?psid=${encodeURIComponent(psid)}`);
    const box = $("#memoryInspectResult");
    box.hidden = false;
    box.innerHTML = `
      <h3>${escapeHtml(result.conversation.customer_name || result.conversation.psid)}</h3>
      <p><b>Page name in memory:</b> ${escapeHtml(result.memory?.pageName || "—")}</p>
      <p><b>Company:</b> ${escapeHtml(result.memory?.companyName || result.lead?.company_name || "—")}</p>
      <p><b>Website:</b> ${escapeHtml(result.memory?.websiteUrl || "—")} (${escapeHtml(result.memory?.websiteStatus || "unknown")})</p>
      <p><b>Page confirmed:</b> ${result.memory?.pageConfirmed ? "Yes" : "No"} · <b>Assessment:</b> ${result.memory?.assessmentDelivered ? "Yes" : "No"}</p>
      <details open>
        <summary>Full session memory JSON</summary>
        <pre class="code-panel">${escapeHtml(JSON.stringify(result.memory || {}, null, 2))}</pre>
      </details>
      <details>
        <summary>Recent messages</summary>
        <div class="message-list">${(result.recentMessages || []).map((m) => `
          <div class="message ${m.sender_type}">
            <small>${escapeHtml(m.sender_type)} · ${fmtDate(m.created_at)}</small>
            <p>${escapeHtml(m.message_text)}</p>
          </div>`).join("")}
        </div>
      </details>`;
  };

  $("#promptPreviewForm").onsubmit = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    const result = await api(`/api/ai-studio/prompt-preview?psid=${encodeURIComponent(data.psid)}&message=${encodeURIComponent(data.message)}`);
    const box = $("#promptPreviewResult");
    box.hidden = false;
    box.textContent = result.prompt;
  };
}

/**
 * What Closer is actually running for this company, in precedence order.
 * The point is that the owner can confirm their extra instructions were
 * received, and see that they sit UNDER the platform rules rather than
 * replacing them.
 */
async function showCloserPromptPreview() {
  const data = await api("/api/prompts/closer/preview");
  const wrap = document.createElement("div");
  wrap.className = "intake-modal-backdrop";
  wrap.innerHTML = `
    <div class="intake-modal is-wide">
      <h3>What Closer is running</h3>
      <p class="muted">Instruction set v${data.version} · ${data.knowledgeCount} knowledge entries for ${escapeHtml(data.companyName)}</p>
      <p class="settings-group">1 · Built-in rules (always apply)</p>
      <pre class="intake-entry-view">${escapeHtml(data.platformInstructions)}</pre>
      <p class="settings-group">2 · Your extra instructions</p>
      <pre class="intake-entry-view">${escapeHtml(data.customInstructions || "(none added)")}</pre>
      <p class="settings-group">3 · Your knowledge base</p>
      <p class="muted">${data.knowledgeCount} entries are supplied with every reply. Manage them in Knowledge Base.</p>
      <div class="intake-modal-actions"><button class="button button-soft" id="previewClose">Close</button></div>
    </div>`;
  document.body.appendChild(wrap);
  const close = () => wrap.remove();
  wrap.querySelector("#previewClose").onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
}

async function facebookPageConnectionView() {
  setTitle("Facebook Page Connection");
  const data = await api("/api/facebook-page-connection");
  const params = new URLSearchParams(location.search);
  const connectedPage = data.connectedPage;
  const currentPageName = connectedPage?.name || "None";
  const currentStatus = connectedPage ? "Connected" : "Not connected";
  const currentReplies = connectedPage ? "Enabled" : "Disabled";

  $("#adminContent").innerHTML = `
    ${settingsTabs("facebook-page-connection")}
    <div class="admin-grid">
      <section class="panel connection-hero">
        <div class="panel-header">
          <div>
            <p class="eyebrow">Meta App Review</p>
            <h2>Facebook Page Connection</h2>
          </div>
          <a class="button button-primary" href="/api/meta/facebook/connect">Connect Facebook Page</a>
        </div>
        <p class="muted">Connect a client’s Facebook Page to AIStaff so Messenger replies, lead capture, Page analysis, and quotation workflows can run from one admin dashboard. This screen only shows connection status and selectable managed Pages after Facebook authorization.</p>
      </section>

      <section class="panel connection-status-panel">
        <div class="panel-header"><h2>Current connection</h2></div>
        <div class="connection-summary">
          <article>
            <span>Current connected Facebook Page</span>
            <strong>${escapeHtml(currentPageName)}</strong>
          </article>
          <article>
            <span>Connection status</span>
            <strong>${escapeHtml(currentStatus)}</strong>
          </article>
          <article>
            <span>Messenger Replies</span>
            <strong>${escapeHtml(currentReplies)}</strong>
          </article>
        </div>
        ${connectedPage ? `
          <div class="connection-confirmed">
            <p><b>Connected Page:</b> ${escapeHtml(connectedPage.name)}</p>
            <p><b>Status:</b> Connected</p>
            <p><b>Messenger Replies:</b> Enabled</p>
          </div>
          <!-- Disconnect added 2026-08-17 as an ADDITION. The Connect button and
               the connection-status panel above are §12 evidence for two Meta
               permissions and must not be altered. -->
          <div class="connection-disconnect">
            <button class="button button-soft" id="fbDisconnectBtn" data-page-id="${escapeHtml(connectedPage.pageId || "")}">Disconnect this Page</button>
            <p class="muted">Closer stops replying on this Page immediately. Your past conversations and knowledge base are kept, and you can reconnect anytime.</p>
          </div>` : `
          <p class="muted">No Facebook Page is connected yet. Start with the authorization button above, then choose the Page AIStaff should manage.</p>`}
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Authorized Pages</h2>
          <span>${data.managedPages.length ? `${data.managedPages.length} Page${data.managedPages.length === 1 ? "" : "s"} found` : "Waiting for Facebook authorization"}</span>
        </div>
        <p class="muted">After Facebook authorization, this list shows the Pages the signed-in user manages. Select the right Page to complete setup for AIStaff.</p>
        ${data.managedPages.length ? `
          <div class="managed-page-list">
            ${data.managedPages.map((page) => `
              <article class="managed-page-card">
                <div>
                  <strong>${escapeHtml(page.name)}</strong>
                  <p>${escapeHtml(page.category || "Facebook Page")}</p>
                </div>
                <button class="button button-soft" type="button" data-select-facebook-page="${escapeHtml(page.id)}">Select</button>
              </article>`).join("")}
          </div>` : `
          <div class="empty-state">
            <p>No managed Pages loaded yet.</p>
            <p>Click <b>Connect Facebook Page</b> to authorize the Page list request and load the Pages available for connection.</p>
          </div>`}
      </section>

      ${data.savedPages.length ? `
        <section class="panel">
          <div class="panel-header"><h2>Saved Pages</h2></div>
          <div class="table-wrap">
            <table>
              <thead><tr><th>Page</th><th>Page ID</th><th>Status</th><th>Updated</th></tr></thead>
              <tbody>${data.savedPages.map((page) => `
                <tr>
                  <td>${escapeHtml(page.name)}</td>
                  <td>${escapeHtml(page.pageId)}</td>
                  <td>${statusPill(page.status)}</td>
                  <td>${fmtDate(page.updatedAt)}</td>
                </tr>`).join("")}</tbody>
            </table>
          </div>
        </section>` : ""}
    </div>`;

  document.querySelectorAll("[data-select-facebook-page]").forEach((button) => {
    button.onclick = async () => {
      await api("/api/facebook-page-connection/select", {
        method: "POST",
        body: { pageId: button.dataset.selectFacebookPage }
      });
      toast(`Connected Page: ${button.closest(".managed-page-card").querySelector("strong").textContent}`);
      facebookPageConnectionView();
    };
  });

  const disconnectBtn = $("#fbDisconnectBtn");
  if (disconnectBtn) {
    disconnectBtn.onclick = async () => {
      // Confirm before an action that stops customer replies. Reversible, but
      // an accidental click silences their Page until they notice.
      if (!window.confirm("Disconnect this Page? Closer will stop replying to messages on it. Your conversations and knowledge base are kept, and you can reconnect anytime.")) return;
      const result = await api("/api/facebook-page-connection/disconnect", {
        method: "POST",
        body: { pageId: disconnectBtn.dataset.pageId }
      });
      toast(result.unsubscribed
        ? "Page disconnected. Closer has stopped replying."
        : `Page disconnected here, but Facebook reported: ${result.unsubscribeError || "unknown error"}`);
      facebookPageConnectionView();
    };
  }

  if (params.get("meta_auth") === "success") {
    toast("Facebook authorization complete. Select the Page to connect.");
  } else if (params.get("meta_auth") === "empty") {
    toast("Authorization succeeded, but no managed Pages were returned.");
  } else if (params.get("meta_error")) {
    toast(params.get("meta_error"));
  }

  if (params.has("meta_auth") || params.has("meta_error")) {
    history.replaceState(null, "", adminPath("settings", "facebook-page-connection"));
  }
}

async function settingsView(tab = "") {
  if (tab === "facebook-page-connection") {
    await facebookPageConnectionView();
    return;
  }

  setTitle("Settings");
  const [company, settings, pages, promptPreview, customHistory] = await Promise.all([
    api("/api/company"),
    api("/api/settings"),
    api("/api/facebook-pages"),
    // Read-only view of what Closer is actually running. Shown inline rather
    // than behind a button: the owner cannot improve their extra instructions
    // without seeing what is already covered.
    api("/api/prompts/closer/preview").catch(() => null),
    api("/api/prompts/custom").catch(() => ({ revisions: [] }))
  ]);
  $("#adminContent").innerHTML = `
    ${settingsTabs("")}
    <div class="settings-stack">
      <section class="panel">
        <h2>Company profile</h2>
        <p class="muted settings-lede">How we identify your business, and who we speak to about the account.</p>
        <form id="companyForm" class="form-grid">
          ${field("name", "Company name", company.name)}
          ${field("contact_person", "Contact person", company.contact_person)}
          ${field("industry", "Industry", company.industry)}
          ${field("website", "Website", company.website)}
          ${field("contact_email", "Contact email", company.contact_email)}
          ${field("contact_number", "Contact number", company.contact_number)}
          <button class="button button-primary full" type="submit">Save Company</button>
        </form>
      </section>
      <section class="panel">
        <h2>AI and quotation settings</h2>
        <p class="muted settings-lede">Grouped by what each control decides: how the agent replies, what it may do with quotations, and where alerts go.</p>
        <form id="settingsForm" class="form-grid">
          <p class="settings-group full">Replying</p>
          <label>AI enabled<select name="ai_enabled"><option value="true" ${settings.ai_enabled ? "selected" : ""}>Yes</option><option value="false">No</option></select></label>
          <label>Auto reply enabled<select name="auto_reply_enabled"><option value="true" ${settings.auto_reply_enabled ? "selected" : ""}>Yes</option><option value="false">No</option></select></label>
          <label>Business hours only<select name="business_hours_only"><option value="false" ${!settings.business_hours_only ? "selected" : ""}>No</option><option value="true">Yes</option></select></label>
          <label>Human handoff enabled<select name="human_handoff_enabled"><option value="true" ${settings.human_handoff_enabled ? "selected" : ""}>Yes</option><option value="false">No</option></select></label>
          ${field("default_language", "Default language", settings.default_language)}
          ${field("tone", "Tone", settings.tone)}

          <p class="settings-group full">Quotations</p>
          <label>Quotation mode<select name="quotation_mode"><option value="approval_required" ${settings.quotation_mode === "approval_required" ? "selected" : ""}>approval_required</option><option value="auto_send">auto_send</option></select></label>
          <label>Admin approval required<select name="quotation_requires_admin_approval"><option value="true" ${settings.quotation_requires_admin_approval ? "selected" : ""}>Yes</option><option value="false">No</option></select></label>
          <label>Allow AI drafts<select name="allow_ai_quotation_drafts"><option value="true" ${settings.allow_ai_quotation_drafts ? "selected" : ""}>Yes</option><option value="false">No</option></select></label>
          <label>Allow auto-send<select name="allow_auto_send_quotation"><option value="false" ${!settings.allow_auto_send_quotation ? "selected" : ""}>No</option><option value="true">Yes</option></select></label>

          <p class="settings-group full">Notifications</p>
          ${field("notify_email", "Notify email", settings.notify_email)}
          <button class="button button-primary full" type="submit">Save Settings</button>
        </form>
      </section>

      <section class="panel">
        <h2>What your Closer knows and does</h2>
        ${promptPreview ? `
          <p class="muted settings-lede">Built from your own setup, so it is always current. Read-only — change it by editing your Knowledge Base.</p>

          <p class="settings-group">Answers from</p>
          ${promptPreview.covers.length
            ? `<ul class="closer-covers">${promptPreview.covers.map((c) => `<li><b>${c.count}</b> ${escapeHtml(c.label)}</li>`).join("")}</ul>`
            : `<p class="muted">Nothing yet — start with the Knowledge Base.</p>`}

          <p class="settings-group">How it behaves</p>
          <ul class="closer-behaviours">${promptPreview.behaviours.map((b) => `<li>${escapeHtml(b)}</li>`).join("")}</ul>

          ${promptPreview.missing.length ? `
            <p class="settings-group">It does not know yet</p>
            <ul class="closer-missing">${promptPreview.missing.map((m) => `<li>${escapeHtml(m.label)}${m.skipped ? ' <span class="muted">(you skipped this)</span>' : ""}</li>`).join("")}</ul>
            <p class="muted">A customer asking about any of these will be told someone will follow up. <a href="${adminPath("knowledge-base")}">Fill these in</a>.</p>` : ""}

          ${promptPreview.openGaps ? `
            <div class="settings-warning"><b>${promptPreview.openGaps} question${promptPreview.openGaps === 1 ? "" : "s"} your customers actually asked</b> that Closer could not answer. <a href="${adminPath("knowledge-base")}">Answer them</a>.</div>` : ""}
        ` : `<p class="muted">Could not load this right now.</p>`}
      </section>

      <section class="panel">
        <h2>Extra instructions for your Closer</h2>
        <p class="muted settings-lede">Closer already knows how to sell from your knowledge base. Use this only to add house style — tone, what to emphasise, what to always mention.</p>
        <div class="settings-warning">
          <b>For advanced users.</b> These instructions are added to Closer's built-in rules, they do not replace them. Closer will still refuse to invent prices, confirm stock it cannot check, or promise anything outside your knowledge base — even if you ask it to here. Facts belong in the Knowledge Base, not in this box.
        </div>
        <form id="closerInstructionsForm" class="form-grid">
          <label class="full">Your additional instructions
            <textarea name="ai_custom_instructions" rows="8" placeholder="Halimbawa: Laging banggitin na open kami ng Sunday. Address customers as 'po'. Wag masyadong pushy sa premium package.&#10;&#10;Write in English, Tagalog or Taglish — whichever is easier.">${escapeHtml(settings.ai_custom_instructions || "")}</textarea>
          </label>
          <button class="button button-primary" type="submit">Save instructions</button>
        </form>
        ${customHistory.revisions.length ? `
          <h3 class="settings-group">Your changes (${customHistory.revisions.length})</h3>
          <p class="muted">Every version you have saved. Roll back to put an earlier one live.</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Version</th><th>Saved</th><th>By</th><th>Preview</th><th>Actions</th></tr></thead>
            <tbody>${customHistory.revisions.map((r) => `<tr>
              <td>${r.is_active ? `<b>v${r.version}</b> <span class="prompt-live">LIVE</span>` : `v${r.version}`}</td>
              <td>${new Date(r.created_at).toLocaleString()}</td>
              <td class="muted">${escapeHtml(r.created_by || "—")}</td>
              <td>${escapeHtml((r.content || "(cleared)").slice(0, 60))}${(r.content || "").length > 60 ? "…" : ""}</td>
              <td class="intake-kb-actions">
                <button type="button" class="intake-link" data-view-custom="${r.version}">View</button>
                ${r.is_active ? "" : `<button type="button" class="intake-link" data-rollback-custom="${r.version}">Roll back</button>`}
              </td>
            </tr>`).join("")}</tbody>
          </table></div>` : ""}
      </section>
      <section class="panel">
        <h2>Facebook Pages</h2>
        <div class="table-wrap"><table><thead><tr><th>Page</th><th>Page ID</th><th>Status</th></tr></thead><tbody>${pages.map((p) => `<tr><td>${p.page_name}</td><td>${p.page_id}</td><td>${statusPill(p.status)}</td></tr>`).join("")}</tbody></table></div>
        <p class="muted">Use the Facebook Page Connection tab to authorize Facebook, list the Pages you manage, and connect the right Page without showing any access tokens in the dashboard.</p>
        <div class="actions-row">
          <a class="button button-soft" href="${adminPath("settings", "facebook-page-connection")}">Open Facebook Page Connection</a>
        </div>
      </section>
    </div>`;
  $("#companyForm").onsubmit = async (event) => {
    event.preventDefault();
    await api("/api/company", { method: "PUT", body: Object.fromEntries(new FormData(event.currentTarget)) });
    toast("Company saved");
  };

  const instructionsForm = $("#closerInstructionsForm");
  if (instructionsForm) {
    instructionsForm.onsubmit = async (event) => {
      event.preventDefault();
      const value = new FormData(event.currentTarget).get("ai_custom_instructions") || "";
      // Versioned save: records a revision AND updates the live value the
      // reply path reads.
      const result = await api("/api/prompts/custom", { method: "POST", body: { content: value } });
      toast(result.unchanged
        ? "No change to save"
        : `Saved as v${result.version} — Closer follows this from the next message`);
      settingsView();
    };

    document.querySelectorAll("[data-view-custom]").forEach((btn) => {
      btn.onclick = () => {
        const rev = customHistory.revisions.find((r) => String(r.version) === btn.dataset.viewCustom);
        if (rev) showPromptRevision({ ...rev, chars: (rev.content || "").length });
      };
    });

    document.querySelectorAll("[data-rollback-custom]").forEach((btn) => {
      btn.onclick = async () => {
        const version = Number(btn.dataset.rollbackCustom);
        if (!window.confirm(`Roll back to v${version}? Closer uses it from the next message.`)) return;
        await api("/api/prompts/custom/activate", { method: "POST", body: { version } });
        toast(`v${version} is live again`);
        settingsView();
      };
    });
  }
  $("#settingsForm").onsubmit = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    ["ai_enabled", "auto_reply_enabled", "business_hours_only", "human_handoff_enabled", "quotation_requires_admin_approval", "allow_ai_quotation_drafts", "allow_auto_send_quotation"].forEach((key) => {
      data[key] = data[key] === "true";
    });
    await api("/api/settings", { method: "PUT", body: data });
    toast("Settings saved");
  };
}

async function paymentsView() {
  setTitle("Payments");
  const data = await api("/api/admin/payments/dashboard");
  $("#adminContent").innerHTML = `
    <div class="admin-grid">
      <section class="metrics">
        <article class="metric-card"><small>Revenue today</small><strong>${money(data.cards.revenueToday)}</strong></article>
        <article class="metric-card"><small>Revenue this month</small><strong>${money(data.cards.revenueThisMonth)}</strong></article>
        <article class="metric-card"><small>Pending payments</small><strong>${data.cards.pendingPayments}</strong></article>
        <article class="metric-card"><small>Failed payments</small><strong>${data.cards.failedPayments}</strong></article>
        <article class="metric-card"><small>Active subscriptions</small><strong>${data.cards.activeSubscriptions}</strong></article>
        <article class="metric-card"><small>Past-due subscriptions</small><strong>${data.cards.pastDueSubscriptions}</strong></article>
        <article class="metric-card"><small>Cancelled subscriptions</small><strong>${data.cards.cancelledSubscriptions}</strong></article>
        <article class="metric-card"><small>Upcoming renewals</small><strong>${data.cards.upcomingRenewals}</strong></article>
      </section>
      <section class="panel">
        <div class="panel-header"><h2>Payments and subscriptions</h2></div>
        <div class="table-wrap">
          <table>
            <thead><tr><th>Order number</th><th>Customer</th><th>Company</th><th>Package</th><th>Amount</th><th>Currency</th><th>Provider</th><th>Payment method</th><th>Payment status</th><th>Subscription status</th><th>Date</th><th>Actions</th></tr></thead>
            <tbody>${data.orders.map((order) => {
              const plan = order.items?.find((item) => item.item_type === "pricing_plan") || {};
              const payment = order.payments?.[0] || {};
              const subscription = order.subscriptions?.[0] || {};
              return `<tr>
                <td><b>${escapeHtml(order.order_number)}</b></td>
                <td>${escapeHtml(order.customer?.full_name)}</td>
                <td>${escapeHtml(order.customer?.company_name || order.customer?.business_name)}</td>
                <td>${escapeHtml(plan.item_name)}</td>
                <td>${money(order.total)}</td>
                <td>${escapeHtml(order.currency)}</td>
                <td>${escapeHtml(order.payment_provider)}</td>
                <td>${escapeHtml(payment.payment_method || "pending")}</td>
                <td>${statusPill(order.payment_status)}</td>
                <td>${statusPill(subscription.status || "pending")}</td>
                <td>${fmtDate(order.created_at)}</td>
                <td><div class="actions-row">
                  <a class="button button-soft" href="/checkout/pending/?order=${encodeURIComponent(order.order_number)}" target="_blank" rel="noopener">View order</a>
                  <button class="button button-soft" type="button" title="Provider reference">${escapeHtml((order.external_payment_id || "No reference").slice(0, 24))}</button>
                  <button class="button button-soft" type="button" disabled>Retry status check</button>
                  <button class="button button-soft" type="button" disabled>Refund request</button>
                  <button class="button button-soft" type="button" disabled>Download invoice</button>
                </div></td>
              </tr>`;
            }).join("")}</tbody>
          </table>
        </div>
        <p class="muted">Financial actions require admin, finance, or owner role. Manual payment approval, refund execution, and provider reconciliation are prepared in the backend and should be enabled only after provider credentials and finance procedures are verified.</p>
      </section>
    </div>`;
}

async function simulateInquiry() {
  const message = prompt("Customer Messenger message", "Magkano po copier rental? Colored po sa Cainta, urgent this week. 09171234567 maria@example.com");
  if (!message) return;
  const result = await api("/api/demo/inbound-message", { method: "POST", body: { psid: "demo_customer", message } });
  toast(`AI replied: ${result.reply}`);
  routeHandler();
}

async function routeHandler() {
  if (location.hash.startsWith("#/")) {
    const parts = location.hash.slice(1).replace(/^\//, "").split("/");
    const routeName = parts[0] || "dashboard";
    const id = parts[1] || null;
    history.replaceState(null, "", adminPath(routeName, id));
  }

  const isAdmin = location.pathname.startsWith("/admin");
  if (!isAdmin) {
    setMode("public");
    document.title = "AIStaff.click | AI Inbox Sales Assistant";
    return;
  }

  let { routeName, id } = parseAdminRoute();

  if (routeName === "login") {
    if (state.user || (await loadSession())) {
      history.replaceState(null, "", adminPath("dashboard"));
      setMode("admin");
      renderAdminNav("dashboard");
      await dashboardView();
      return;
    }
    setMode("login");
    document.title = "Admin Login | AIStaff.click";
    return;
  }

  if (routeName === "forgot-password") {
    setMode("login", "forgot");
    document.title = "Reset your password | AIStaff.click";
    return;
  }

  if (routeName === "reset-password") {
    setMode("login", "reset");
    document.title = "Set your password | AIStaff.click";
    // A brand-new customer arrives here from the welcome email, so the copy
    // should read as setting a password, not resetting a forgotten one.
    if (!new URLSearchParams(location.search).get("token")) {
      $("#resetIntro").textContent = "This link is missing its token. Please use the link from your email, or request a new one.";
    }
    return;
  }

  if (!state.user && !(await loadSession())) {
    history.replaceState(null, "", adminPath("login"));
    setMode("login");
    document.title = "Admin Login | AIStaff.click";
    return;
  }

  setMode("admin");
  // A hidden nav link is not access control — typing /admin/ai-studio directly
  // still loaded the screen, which then failed on a 403 and rendered blank.
  // Customers are sent to their dashboard instead.
  const allowed = visibleNavItems().some(([key]) => key === routeName);
  if (!allowed && PLATFORM_ONLY_ROUTES.has(routeName)) {
    history.replaceState(null, "", adminPath("dashboard"));
    routeName = "dashboard";
    id = null;
  }
  const active = visibleNavItems().some(([key]) => key === routeName) ? routeName : "dashboard";
  renderAdminNav(active);

  try {
    if (routeName === "platform") await platformView();
    else if (routeName === "dashboard") await dashboardView();
    else if (routeName === "marketing" && id === "ads") await marketingAdsView();
    else if (routeName === "marketing" && id === "review") await marketingReviewView();
    else if (routeName === "marketing" && id === "process") await marketingProcessView();
    else if (routeName === "marketing") await marketingHubView();
    else if (routeName === "onboarding") await onboardingView();
    else if (routeName === "conversations" && id) await conversationDetailView(id);
    else if (routeName === "conversations") await conversationsView();
    else if (routeName === "leads" && id) await leadDetailView(id);
    else if (routeName === "leads") await leadsView();
    else if (routeName === "knowledge-base") await knowledgeBaseView();
    else if (routeName === "ai-studio") await aiStudioView();
    else if (routeName === "qualification-questions") await questionsView();
    else if (routeName === "quotations" && id) await quotationDetailView(id);
    else if (routeName === "quotations") await quotationsView();
    else if (routeName === "bookings") await bookingsView();
    else if (routeName === "payments") await paymentsView();
    else if (routeName === "follow-ups") await followUpsView();
    else if (routeName === "settings") await settingsView(id);
    else await dashboardView();
    // Setup reminder, once per session, on any admin screen while unfinished.
    if (typeof maybeShowSetupModal === "function") maybeShowSetupModal();
    // Header status pill — starts once, then polls.
    if (typeof startCloserStatusPolling === "function") startCloserStatusPolling();
    if (typeof renderAssistBanner === "function") renderAssistBanner();
  } catch (error) {
    toast(error.message);
  }
}

async function loadPublicConfig() {
  const button = $("#messengerDemoBtn");
  if (!button) return;
  try {
    const config = await api("/api/public-config");
    if (config.messengerUrl) button.href = config.messengerUrl;
  } catch {
    // Keep the fallback m.me link from HTML.
  }
}

if ($("#auditForm")) {
  $("#auditForm").onsubmit = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    try {
      await api("/api/public/audit-request", {
        method: "POST",
        body: {
          company: data.company,
          person: data.person,
          mobile: data.mobile,
          email: data.email,
          page: data.page,
          business: data.business || null,
          inquiries: data.inquiries || null,
          quotations: data.quotations || null,
          message: data.message || null
        }
      });
      $("#auditSuccess").hidden = false;
      event.currentTarget.reset();
    } catch (error) {
      toast(error.message || "Could not submit audit request");
    }
  };
}

if ($("#forgotForm")) {
  $("#forgotForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Sending...";
    try {
      const body = Object.fromEntries(new FormData(form));
      const res = await fetch("/api/auth/forgot-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: body.email })
      });
      const json = await res.json();
      // Deliberately the same message whether or not the address exists —
      // anything else turns this form into a way to test who our customers
      // are. The server behaves identically for the same reason.
      toast(json.message || "If an account exists for that address, we've sent a reset link.");
      form.reset();
    } catch (error) {
      toast("Could not send the reset link. Please try again.");
    } finally {
      btn.disabled = false;
      btn.textContent = "Send reset link";
    }
  };
}

if ($("#resetForm")) {
  $("#resetForm").onsubmit = async (event) => {
    event.preventDefault();
    const form = event.currentTarget;
    const body = Object.fromEntries(new FormData(form));
    if (body.password !== body.confirm) return toast("Those passwords do not match.");
    if (String(body.password).length < 8) return toast("Password must be at least 8 characters.");

    const token = new URLSearchParams(location.search).get("token");
    if (!token) return toast("This link is missing its token. Please use the link from your email.");

    const btn = form.querySelector("button[type=submit]");
    btn.disabled = true;
    btn.textContent = "Saving...";
    try {
      const res = await fetch("/api/auth/reset-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: body.password })
      });
      const json = await res.json();
      if (!json.ok) throw new Error(json.error || "Could not set your password.");
      toast("Password saved. Please sign in.");
      // Not signed in automatically: holding the emailed link proves control
      // of the inbox, not of the password just chosen.
      setTimeout(() => { location.href = adminPath("login"); }, 1200);
    } catch (error) {
      toast(error.message);
    } finally {
      btn.disabled = false;
      btn.textContent = "Save password";
    }
  };
}

if ($("#loginForm")) {
  $("#loginForm").onsubmit = async (event) => {
    event.preventDefault();
    try {
      const data = Object.fromEntries(new FormData(event.currentTarget));
      const session = await api("/api/auth/login", { method: "POST", body: data });
      state.user = session.user;
      await loadSession();
      history.pushState(null, "", adminPath("dashboard"));
      routeHandler();
    } catch (error) {
      toast(error.message);
    }
  };
}

if ($("#logoutBtn")) {
  $("#logoutBtn").onclick = async () => {
    await api("/api/auth/logout", { method: "POST", body: {} });
    state.user = null;
    history.pushState(null, "", adminPath("login"));
    routeHandler();
  };
}

if ($("#demoMessageBtn")) $("#demoMessageBtn").onclick = simulateInquiry;

window.addEventListener("popstate", routeHandler);
window.addEventListener("hashchange", routeHandler);
loadPublicConfig();
loadSession().finally(routeHandler);


// ---------------------------------------------------------------------------
// Pitch (voice agent) settings — pipeline switch, Piper voice picker, preview.
// ---------------------------------------------------------------------------
async function pitchStudioView() {
  setTitle("AI Studio — Pitch");
  const state = await api("/api/pitch-admin/");
  const cfg = state.config;
  const prompt = await api(`/api/pitch-admin/prompt?pipeline=${cfg.pipeline}`);
  const svc = state.services;

  const dot = (ok) => `<span style="color:${ok ? "#3ecf8e" : "#e05252"}">●</span>`;
  const langOpts = state.languages.map((l) =>
    `<option value="${l.code}"${l.code === "en_US" ? " selected" : ""}>${escapeHtml(l.name)} — ${l.code} (${l.voices})</option>`).join("");
  const whisperOpts = state.whisperModels.map((m) =>
    `<option value="${m.name}"${m.name === cfg.local.whisperModel ? " selected" : ""}>${m.name} (${m.sizeMB} MB)</option>`).join("");

  const PIPE_LABEL = { "gemini-live": "Gemini Live", local: "Local (Piper)" };
  const drifted = state.runningPipeline && state.runningPipeline !== cfg.pipeline;
  const driftBanner = drifted ? `
      <section class="panel" style="border-left:4px solid #e0a33e;background:#fffaf0">
        <b>Saved settings are not live yet.</b>
        <p class="muted" style="margin:6px 0 0">
          You saved <b>${PIPE_LABEL[cfg.pipeline]}</b>, but calls are currently answered by
          <b>${PIPE_LABEL[state.runningPipeline]}</b>. Pitch reads its pipeline once at startup —
          use <b>Save &amp; restart voice stack</b> at the bottom to apply.
        </p>
      </section>` : "";

  $("#adminContent").innerHTML = `
    <div class="settings-stack">
      <div class="panel" style="padding:0;display:flex;gap:0;overflow:hidden">
        <button class="button button-soft" id="tabCloser" style="flex:1;border-radius:0;margin:0">Closer</button>
        <button class="button button-primary" id="tabPitch" style="flex:1;border-radius:0;margin:0">Pitch (voice)</button>
      </div>
      ${driftBanner}

      <section class="panel">
        <div class="panel-header">
          <h2>Service status</h2>
          <button class="button button-soft" id="pitchRefresh">Refresh</button>
        </div>
        <p class="muted">
          ${dot(!!svc.pitchPid)} Pitch ${svc.pitchPid ? `(pid ${svc.pitchPid})` : "not running"}${state.runningPipeline ? ` — answering with <b>${PIPE_LABEL[state.runningPipeline]}</b>` : ""} &nbsp;·&nbsp;
          ${dot(svc.whisper)} whisper.cpp :8080 &nbsp;·&nbsp;
          ${dot(svc.piper)} Piper :9891
        </p>
        <p class="muted" style="font-size:12px">Settings file: <code>${escapeHtml(state.configPath)}</code>${cfg.updatedAt ? ` · saved ${new Date(cfg.updatedAt).toLocaleString()}` : ""}</p>
      </section>

      <section class="panel">
        <div class="panel-header"><h2>Pipeline</h2></div>
        <p class="muted settings-lede">Which engine answers calls. Gemini Live is speech-to-speech with native Taglish and emotion. Local runs whisper &rarr; text brain &rarr; Piper on this machine — far cheaper, slightly slower, English only until the Taglish voice is trained.</p>
        <table class="data-table">
          <thead><tr><th></th><th>Pipeline</th><th>TTS cost / call</th><th>Latency</th><th>Taglish</th><th>Emotion</th></tr></thead>
          <tbody>
            <tr>
              <td><input type="radio" name="pipeline" value="gemini-live" id="pipeGemini"${cfg.pipeline === "gemini-live" ? " checked" : ""}></td>
              <td><label for="pipeGemini"><b>1 — Gemini Live</b><br><span class="muted">premium tier</span></label></td>
              <td>≈ ₱1.30</td><td>~500 ms</td><td>Native</td><td>Native affect</td>
            </tr>
            <tr>
              <td><input type="radio" name="pipeline" value="local" id="pipeLocal"${cfg.pipeline === "local" ? " checked" : ""}></td>
              <td><label for="pipeLocal"><b>2 — Local (Piper)</b><br><span class="muted">standard tier</span></label></td>
              <td>≈ ₱0.02</td><td>~1.3 s</td><td>After training</td><td>Speaker slots</td>
            </tr>
          </tbody>
        </table>
        <label class="full" style="margin-top:14px">
          <input type="checkbox" id="bargeIn"${cfg.bargeInEnabled ? " checked" : ""}>
          Barge-in — let the caller interrupt the agent mid-sentence
        </label>
        <p class="muted" style="font-size:12px">Turning this off stops mid-sentence cut-offs. Endpoint detection stays on either way; the local pipeline cannot work without it.</p>
      </section>

      <section class="panel" id="geminiPanel">
        <div class="panel-header"><h2>Gemini Live voice</h2></div>
        <p class="muted settings-lede">Google's prebuilt voices. There is no custom voice and no language setting — the model matches whatever the caller speaks, including mid-sentence Taglish. Changing this needs a restart.</p>
        <div class="form-grid">
          <label>Voice<select id="geminiVoice">${(state.geminiVoices || []).map((v) =>
            `<option value="${v.name}"${v.name === (cfg.geminiLive && cfg.geminiLive.voice) ? " selected" : ""}>${v.name} — ${v.gender}, ${v.note}</option>`).join("")}</select></label>
        </div>
        <p class="muted" style="font-size:12px;margin-top:10px">No preview available — Gemini voices are only produced during a live call. Change it, restart, and ring the number to hear it.</p>
      </section>

      <section class="panel" id="piperPanel">
        <div class="panel-header"><h2>Piper voice</h2></div>
        <div class="form-grid">
          <label>Language<select id="voiceLang">${langOpts}</select></label>
          <label>Gender<select id="voiceGender">
            <option value="">All</option>
            <option value="female" selected>Female</option>
            <option value="male">Male</option>
          </select></label>
          <label>Whisper model<select id="whisperModel">${whisperOpts}</select></label>
          <label>Speech rate <span class="muted" id="lsVal">${cfg.local.piperLengthScale}</span>
            <input type="range" id="lengthScale" min="0.6" max="1.6" step="0.05" value="${cfg.local.piperLengthScale}">
          </label>
        </div>
        <div id="voiceList" class="muted" style="margin-top:14px">Loading voices…</div>
      </section>

      <section class="panel" id="previewPanel">
        <div class="panel-header"><h2>Preview</h2></div>
        <label class="full">Test line
          <input type="text" id="previewText" value="Good afternoon! Thank you for calling. How can I help you today?" maxlength="300">
        </label>
        <div style="display:flex;gap:10px;align-items:center;margin-top:10px;flex-wrap:wrap">
          <button class="button button-soft" id="previewBtn">Play preview</button>
          <span class="muted" id="previewMeta"></span>
        </div>
        <audio id="previewAudio" controls style="width:100%;margin-top:12px" hidden></audio>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Pitch instructions — ${PIPE_LABEL[prompt.pipeline]}${prompt.active ? ` · v${prompt.active.version} live` : ""}</h2>
          <span class="muted">${prompt.active ? `saved ${new Date(prompt.active.created_at).toLocaleString()} by ${escapeHtml(prompt.active.created_by || "seed")}` : ""}</span>
        </div>
        <p class="muted settings-lede">The <b>complete</b> prompt for this pipeline — nothing is added from code. Each pipeline has its own, because the language rules differ: Gemini Live can speak Taglish, Piper cannot. Switch the pipeline above to edit the other one. Three variables are filled at call time: <code>{{business_name}}</code>, <code>{{agent_name}}</code>, <code>{{caller_number}}</code>.</p>
        <form id="pitchPromptForm" class="form-grid">
          <label class="full">Instructions
            <textarea name="content" rows="22" spellcheck="false">${escapeHtml(prompt.active ? prompt.active.content : "")}</textarea>
          </label>
          <label class="full">What changed? (shown in the history below)
            <input type="text" name="note" maxlength="300" placeholder="e.g. Told it to confirm the delivery address before closing" />
          </label>
          <div style="display:flex;gap:10px;align-items:center">
            <button class="button button-primary" type="submit">Save as new version</button>
            <button class="button button-soft" type="button" id="promptReset">Reset to default</button>
          </div>
        </form>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>What Pitch actually sends</h2>
          <button class="button button-soft" id="promptPreviewBtn">Show assembled prompt</button>
        </div>
        <p class="muted">The same text with <code>{{business_name}}</code>, <code>{{agent_name}}</code> and <code>{{caller_number}}</code> filled in — exactly what the model receives.</p>
        <pre id="promptPreview" style="white-space:pre-wrap;font-size:12px;max-height:420px;overflow:auto;background:#f6f7f9;padding:14px;border-radius:8px" hidden></pre>
      </section>

      <section class="panel">
        <div class="panel-header">
          <h2>Version history (${prompt.revisions.length})</h2>
        </div>
        <p class="muted">Every version that has run. Roll back to put an earlier one live immediately.</p>
        <table class="data-table">
          <thead><tr><th>Version</th><th>Saved</th><th>By</th><th>What changed</th><th>Actions</th></tr></thead>
          <tbody>${prompt.revisions.map((v) => `
            <tr>
              <td><b>v${v.version}</b>${v.is_active ? ` <span style="background:#d9f7e8;color:#1a7a4f;padding:1px 7px;border-radius:10px;font-size:11px">LIVE</span>` : ""}</td>
              <td>${new Date(v.created_at).toLocaleString()}</td>
              <td>${escapeHtml(v.created_by || "seed")}</td>
              <td>${escapeHtml(v.note || "")}</td>
              <td>${v.is_active ? "" : `<button class="button button-soft" data-rollback="${v.version}">Roll back</button>`}</td>
            </tr>`).join("")}
          </tbody>
        </table>
      </section>

      <section class="panel">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <button class="button button-primary" id="pitchSave">Save settings</button>
          <button class="button" id="pitchApply">Save &amp; restart voice stack</button>
          <span class="muted" id="pitchStatus"></span>
        </div>
        <p class="muted" style="font-size:12px;margin-top:10px">Restarting takes about 30 seconds and drops any call in progress. Save alone takes effect on the next restart.</p>
      </section>
    </div>`;

  let selectedVoice = cfg.local.piperVoice;

  async function loadVoices() {
    const lang = $("#voiceLang").value;
    const gender = $("#voiceGender").value;
    const q = new URLSearchParams({ language: lang });
    if (gender) q.set("gender", gender);
    const { voices } = await api(`/api/pitch-admin/voices?${q}`);
    if (!voices.length) {
      $("#voiceList").innerHTML = `<p class="muted">No voices for this filter.</p>`;
      return;
    }
    $("#voiceList").innerHTML = `
      <table class="data-table">
        <thead><tr><th></th><th>Voice</th><th>Quality</th><th>Gender</th><th>Speakers</th><th></th></tr></thead>
        <tbody>${voices.map((v) => `
          <tr>
            <td><input type="radio" name="voice" value="${v.key}"${v.key === selectedVoice ? " checked" : ""}${v.installed ? "" : " disabled"}></td>
            <td>${escapeHtml(v.name)}<br><span class="muted" style="font-size:11px">${v.key}</span></td>
            <td>${v.quality}</td>
            <td>${v.gender}</td>
            <td>${v.numSpeakers > 1 ? v.numSpeakers : "—"}</td>
            <td>${v.installed
              ? `<button class="button button-soft" data-play="${v.key}">Listen</button>`
              : `<button class="button button-soft" data-install="${v.key}">Download</button>`}</td>
          </tr>`).join("")}
        </tbody>
      </table>`;

    $("#voiceList").querySelectorAll('input[name="voice"]').forEach((el) => {
      el.onchange = () => { selectedVoice = el.value; };
    });
    $("#voiceList").querySelectorAll("[data-play]").forEach((b) => {
      b.onclick = () => playPreview(b.dataset.play);
    });
    $("#voiceList").querySelectorAll("[data-install]").forEach((b) => {
      b.onclick = async () => {
        b.disabled = true; b.textContent = "Downloading…";
        try {
          await api(`/api/pitch-admin/voices/${b.dataset.install}/install`, { method: "POST" });
          toast(`${b.dataset.install} installed`);
          await loadVoices();
        } catch (e) { toast(`Download failed: ${e.message}`); b.disabled = false; b.textContent = "Download"; }
      };
    });
  }

  async function playPreview(voice) {
    const meta = $("#previewMeta");
    meta.textContent = "synthesizing…";
    try {
      const r = await api("/api/pitch-admin/preview", {
        method: "POST",
        body: {
          voice: voice || selectedVoice,
          text: $("#previewText").value,
          lengthScale: Number($("#lengthScale").value),
        },
      });
      const audio = $("#previewAudio");
      audio.hidden = false;
      audio.src = r.url;
      audio.play();
      meta.textContent = `${r.voice} · ${r.ms} ms`;
    } catch (e) { meta.textContent = `failed: ${e.message}`; }
  }

  // Only show the panel that belongs to the selected pipeline — Piper voices
  // are meaningless on Gemini Live and vice versa.
  function syncPanels() {
    const isLocal = document.querySelector('input[name="pipeline"]:checked').value === "local";
    $("#piperPanel").hidden = !isLocal;
    $("#geminiPanel").hidden = isLocal;
    $("#previewPanel").hidden = !isLocal;
  }
  document.querySelectorAll('input[name="pipeline"]').forEach((el) => {
    el.onchange = async () => {
      syncPanels();
      // Each pipeline has its own prompt — save the setting so the reload
      // shows the right one, then re-render.
      try {
        await api("/api/pitch-admin/config", { method: "PUT", body: collect() });
        pitchStudioView();
      } catch { syncPanels(); }
    };
  });
  syncPanels();

  $("#pitchPromptForm").onsubmit = async (event) => {
    event.preventDefault();
    const f = new FormData(event.target);
    try {
      const r = await api("/api/pitch-admin/prompt", {
        method: "POST",
        body: {
          pipeline: prompt.pipeline,
          content: f.get("content"),
          note: f.get("note") || null,
        },
      });
      toast(`Saved as v${r.version} — restart to apply`);
      pitchStudioView();
    } catch (e) { toast(`Save failed: ${e.message}`); }
  };

  $("#promptReset").onclick = async () => {
    if (!confirm(`Reset the ${PIPE_LABEL[prompt.pipeline]} prompt to the built-in default? Your current version stays in history.`)) return;
    try {
      const r = await api("/api/pitch-admin/prompt/reset", {
        method: "POST", body: { pipeline: prompt.pipeline },
      });
      toast(`Reset — now v${r.version}`);
      pitchStudioView();
    } catch (e) { toast(`Reset failed: ${e.message}`); }
  };

  $("#promptPreviewBtn").onclick = async () => {
    const pre = $("#promptPreview");
    try {
      const r = await api(`/api/pitch-admin/prompt/preview?pipeline=${prompt.pipeline}`);
      pre.textContent = r.content;
      pre.hidden = false;
    } catch (e) { pre.textContent = `failed: ${e.message}`; pre.hidden = false; }
  };

  document.querySelectorAll("[data-rollback]").forEach((b) => {
    b.onclick = async () => {
      if (!confirm(`Roll back to v${b.dataset.rollback}? It goes live on the next restart.`)) return;
      try {
        await api("/api/pitch-admin/prompt/activate", {
          method: "POST",
          body: { pipeline: prompt.pipeline, version: Number(b.dataset.rollback) },
        });
        toast(`v${b.dataset.rollback} is now live`);
        pitchStudioView();
      } catch (e) { toast(`Rollback failed: ${e.message}`); }
    };
  });

  function collect() {
    return {
      pipeline: document.querySelector('input[name="pipeline"]:checked').value,
      bargeInEnabled: $("#bargeIn").checked,
      geminiLive: { voice: $("#geminiVoice").value },
      local: {
        ttsEngine: "piper",
        piperVoice: selectedVoice,
        whisperModel: $("#whisperModel").value,
        piperLengthScale: Number($("#lengthScale").value),
      },
    };
  }

  async function save() {
    await api("/api/pitch-admin/config", { method: "PUT", body: collect() });
  }

  $("#voiceLang").onchange = loadVoices;
  $("#voiceGender").onchange = loadVoices;
  $("#lengthScale").oninput = () => { $("#lsVal").textContent = $("#lengthScale").value; };
  $("#previewBtn").onclick = () => playPreview(selectedVoice);
  $("#pitchRefresh").onclick = () => pitchStudioView();
  $("#tabCloser").onclick = () => aiStudioView();
  $("#tabPitch").onclick = () => pitchStudioView();

  $("#pitchSave").onclick = async () => {
    try { await save(); toast("Pitch settings saved"); }
    catch (e) { toast(`Save failed: ${e.message}`); }
  };

  $("#pitchApply").onclick = async () => {
    const status = $("#pitchStatus");
    try {
      await save();
      status.textContent = "restarting…";
      await api("/api/pitch-admin/restart", { method: "POST" });
      let waited = 0;
      const poll = setInterval(async () => {
        waited += 5;
        const s = await api("/api/pitch-admin/");
        if (s.services.pitchPid && (s.config.pipeline === "gemini-live" || (s.services.piper && s.services.whisper))) {
          clearInterval(poll);
          status.textContent = `ready (pid ${s.services.pitchPid})`;
          setTimeout(() => pitchStudioView(), 1200);
        } else if (waited > 75) {
          clearInterval(poll);
          status.textContent = "still starting — hit Refresh in a moment";
        } else {
          status.textContent = `restarting… ${waited}s`;
        }
      }, 5000);
    } catch (e) { status.textContent = `failed: ${e.message}`; }
  };

  await loadVoices();
}
