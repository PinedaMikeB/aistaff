const state = {
  user: null,
  company: null,
  currentRoute: "public"
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
  ["payments", "Payments"],
  ["follow-ups", "Follow-ups"],
  ["settings", "Settings"]
];

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
  return messages.map((m) => `
    <article class="message ${m.sender_type}">
      <header>
        <strong>${messageSenderLabel(m.sender_type)}</strong>
        <time>${fmtDate(m.created_at)}</time>
      </header>
      <p>${escapeHtml(m.message_text)}</p>
    </article>`).join("");
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

function setMode(mode) {
  $("[data-public].site-header").hidden = mode !== "public";
  $("#publicSite").hidden = mode !== "public";
  $("[data-public].site-footer").hidden = mode !== "public";
  $("#adminApp").hidden = mode !== "admin";
  $("#loginPage").hidden = mode !== "login";
}

function renderAdminNav(active) {
  $("#adminNav").innerHTML = navItems.map(([key, label]) => (
    `<a class="${active === key ? "active" : ""}" href="${adminPath(key)}"><span>${label[0]}</span>${label}</a>`
  )).join("");
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
  return `<label>${label}<input type="${type}" name="${name}" value="${value || ""}" /></label>`;
}

async function knowledgeBaseView() {
  setTitle("Knowledge Base");
  const rows = await api("/api/knowledge-base");
  $("#adminContent").innerHTML = `
    <div class="split">
      <section class="panel">
        <h2>Add approved answer</h2>
        <form id="kbForm" class="form-grid">
          ${field("category", "Category")}
          ${field("question", "Question")}
          <label class="full">Answer<textarea name="answer" required></textarea></label>
          ${field("tags", "Tags, comma separated")}
          <button class="button button-primary full" type="submit">Add Knowledge</button>
        </form>
      </section>
      <section class="panel">
        <h2>Approved knowledge</h2>
        <div class="table-wrap"><table><thead><tr><th>Category</th><th>Question</th><th>Answer</th><th>Active</th></tr></thead>
        <tbody>${rows.map((r) => `<tr><td>${r.category}</td><td>${r.question}</td><td>${r.answer}</td><td>${r.active ? "Yes" : "No"}</td></tr>`).join("")}</tbody></table></div>
      </section>
    </div>`;
  $("#kbForm").onsubmit = async (event) => {
    event.preventDefault();
    const data = Object.fromEntries(new FormData(event.currentTarget));
    data.tags = data.tags ? data.tags.split(",").map((tag) => tag.trim()).filter(Boolean) : [];
    await api("/api/knowledge-base", { method: "POST", body: data });
    toast("Knowledge base item added");
    knowledgeBaseView();
  };
}

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
  const [company, settings, pages] = await Promise.all([api("/api/company"), api("/api/settings"), api("/api/facebook-pages")]);
  $("#adminContent").innerHTML = `
    ${settingsTabs("")}
    <div class="split">
      <section class="panel">
        <h2>Company profile</h2>
        <form id="companyForm" class="form-grid">
          ${field("name", "Company name", company.name)}
          ${field("industry", "Industry", company.industry)}
          ${field("website", "Website", company.website)}
          ${field("contact_email", "Contact email", company.contact_email)}
          ${field("contact_number", "Contact number", company.contact_number)}
          <button class="button button-primary full" type="submit">Save Company</button>
        </form>
      </section>
      <section class="panel">
        <h2>AI and quotation settings</h2>
        <form id="settingsForm" class="form-grid">
          <label>AI enabled<select name="ai_enabled"><option value="true" ${settings.ai_enabled ? "selected" : ""}>Yes</option><option value="false">No</option></select></label>
          <label>Auto reply enabled<select name="auto_reply_enabled"><option value="true" ${settings.auto_reply_enabled ? "selected" : ""}>Yes</option><option value="false">No</option></select></label>
          <label>Business hours only<select name="business_hours_only"><option value="false" ${!settings.business_hours_only ? "selected" : ""}>No</option><option value="true">Yes</option></select></label>
          <label>Human handoff enabled<select name="human_handoff_enabled"><option value="true" ${settings.human_handoff_enabled ? "selected" : ""}>Yes</option><option value="false">No</option></select></label>
          ${field("default_language", "Default language", settings.default_language)}
          ${field("tone", "Tone", settings.tone)}
          <label>Quotation mode<select name="quotation_mode"><option value="approval_required" ${settings.quotation_mode === "approval_required" ? "selected" : ""}>approval_required</option><option value="auto_send">auto_send</option></select></label>
          <label>Admin approval required<select name="quotation_requires_admin_approval"><option value="true" ${settings.quotation_requires_admin_approval ? "selected" : ""}>Yes</option><option value="false">No</option></select></label>
          <label>Allow AI drafts<select name="allow_ai_quotation_drafts"><option value="true" ${settings.allow_ai_quotation_drafts ? "selected" : ""}>Yes</option><option value="false">No</option></select></label>
          <label>Allow auto-send<select name="allow_auto_send_quotation"><option value="false" ${!settings.allow_auto_send_quotation ? "selected" : ""}>No</option><option value="true">Yes</option></select></label>
          ${field("notify_email", "Notify email", settings.notify_email)}
          <button class="button button-primary full" type="submit">Save Settings</button>
        </form>
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

  const { routeName, id } = parseAdminRoute();

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

  if (!state.user && !(await loadSession())) {
    history.replaceState(null, "", adminPath("login"));
    setMode("login");
    document.title = "Admin Login | AIStaff.click";
    return;
  }

  setMode("admin");
  const active = navItems.some(([key]) => key === routeName) ? routeName : "dashboard";
  renderAdminNav(active);

  try {
    if (routeName === "dashboard") await dashboardView();
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
    else if (routeName === "payments") await paymentsView();
    else if (routeName === "follow-ups") await followUpsView();
    else if (routeName === "settings") await settingsView(id);
    else await dashboardView();
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
