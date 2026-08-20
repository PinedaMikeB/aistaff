/* ===========================================================================
 * Knowledge base intake wizard (2026-08-17, HANDOFF-CLOSER.md §18)
 *
 * Lives UNDER the existing "Knowledge Base" nav item — §12 locks the nav
 * labels and order, so this is an addition inside that screen, not a new item.
 *
 * COPY NOTE: the "why this helps" text is product copy shown to the business
 * OWNER. Rule 2 forbids storing sentences for the AGENT to say to a CUSTOMER;
 * it does not forbid us writing our own UI.
 * ========================================================================= */

const intakeState = {
  data: null,
  activeStepId: null,
  rows: [],
  uploads: []
};

function intakeWordCount(text) {
  return String(text || "").trim().split(/\s+/).filter(Boolean).length;
}

function intakeProgressBar(percent, addressed, total) {
  const tone = percent === 100 ? "is-complete" : "";
  return `
    <div class="intake-progress ${tone}">
      <div class="intake-progress-head">
        <strong>Setup ${percent}% done</strong>
        <span class="muted">${addressed} of ${total} steps</span>
      </div>
      <div class="intake-bar"><span style="width:${percent}%"></span></div>
    </div>`;
}

/**
 * Shown once a Page is connected but setup is unfinished. Correct English for
 * the message Mike asked for: congratulate, then say plainly what is still
 * needed and why, and give one button that goes straight to the wizard.
 */
function intakeCongratsBanner(data) {
  if (!data.pageConnected) return "";
  if (data.complete) {
    return `
      <div class="intake-banner is-done">
        <h3>Your setup is complete</h3>
        <p>Closer is answering from your knowledge base on <b>${data.pageName || "your Page"}</b>. You can update any step below whenever your prices, promos or policies change.</p>
      </div>`;
  }
  return `
    <div class="intake-banner">
      <h3>Congratulations — <b>${data.pageName || "your Page"}</b> is connected.</h3>
      <p>Closer can now receive and reply to messages on your Page. Before it can sell for you, it needs to learn about your business — your products, prices, promos and policies. Right now it can only tell customers that someone will follow up.</p>
      <p class="muted">This takes a few minutes, one topic at a time. You can skip any step and come back to it later.</p>
      <button class="button button-primary" id="intakeStartBtn">Continue setup</button>
    </div>`;
}

/** Step rail: where they are, what is done, what was skipped. */
function intakeStepRail(steps, activeId) {
  return steps.map((step) => {
    const cls = [
      "intake-step-item",
      step.id === activeId ? "is-active" : "",
      step.done ? "is-done" : "",
      step.skipped && !step.done ? "is-skipped" : ""
    ].filter(Boolean).join(" ");
    const mark = step.done ? "✓" : (step.skipped ? "–" : "");
    const count = step.entryCount ? ` <span class="muted">(${step.entryCount})</span>` : "";
    return `<button type="button" class="${cls}" data-step="${step.id}">
      <span class="intake-step-mark">${mark}</span>
      <span>${step.title}${count}</span>
    </button>`;
  }).join("");
}

function intakeCheckOptionHtml(name, option, checked = false) {
  return `
      <label class="intake-check-option">
        <input type="checkbox" name="${escapeHtml(name)}" value="${escapeHtml(option)}" ${checked ? "checked" : ""} />
        <span>${escapeHtml(option)}</span>
      </label>`;
}

function intakeCheckOtherHtml(name, otherValue = "") {
  return `
      <label class="intake-check-option intake-check-other">
        <input type="checkbox" name="${escapeHtml(name)}" value="__other__" ${otherValue ? "checked" : ""} />
        <span>Other</span>
        <input type="text" name="${escapeHtml(name)}_other" placeholder="Type other option" value="${escapeHtml(otherValue)}" />
      </label>`;
}

function intakeSavedFieldValues(step) {
  if (!step?.paymentSetup && !step?.painSetup) return {};
  const entry = step?.latestEntry;
  if (!entry) return {};
  const values = {
    answer: entry.answer || "",
    title: entry.title || step.title || "",
    currency: entry.currency || "",
    validity: "",
    validUntilDate: entry.validUntil ? String(entry.validUntil).slice(0, 10) : ""
  };

  const groupLabels = {
    "Payment acceptance": "payment_acceptance",
    "Preferred closing path": "preferred_closing_path",
    "Payment methods accepted": "payment_methods",
    "Collect before payment": "collect_before_payment",
    "Amount rules": "amount_rules",
    "Closer must not do": "must_not_do",
    "After payment": "after_payment",
    "Customer pain points": "customer_pains",
    "Solutions or advantages": "solutions_offered",
    "Outcomes to emphasize": "outcomes_to_emphasize"
  };
  const textLabels = {
    "Existing payment terms or policy notes": "payment_policy_text",
    "Payment provider or link source": "provider_source",
    "Fixed deposit/downpayment amount": "fixed_deposit_amount",
    "Percentage deposit": "percentage_deposit",
    "Reservation/booking fee": "reservation_fee_amount",
    "Website checkout link": "website_checkout_url",
    "Booking/reservation link": "booking_link",
    "Customer instructions": "customer_instructions",
    "Owner notes": "pain_solution_notes",
    "Business category": "pain_industry"
  };

  for (const item of Array.isArray(entry.data) ? entry.data : []) {
    const label = String(item?.label || "").trim();
    const value = String(item?.value || "").trim();
    if (!label || !value) continue;
    const groupKey = groupLabels[label];
    if (groupKey) {
      if (!Array.isArray(values[groupKey])) values[groupKey] = [];
      values[groupKey].push(value);
      continue;
    }
    const textKey = textLabels[label];
    if (textKey && !values[textKey]) values[textKey] = value;
  }
  return values;
}

function intakeFieldHtml(field, step, validityOptions, savedValues = {}) {
  const label = field.label || field.name;
  const saved = savedValues[field.name];
  if (field.type === "textarea") {
    // Never HTML-required on an upload step: the browser blocks submit with
    // "Please fill out this field" even when the content came from files.
    // intakeCollect enforces "something must be present" instead.
    const req = field.required && !step.allowUpload ? "required" : "";
    const hint = step.allowUpload ? '<span class="muted">Type here, or leave blank if your files above cover it.</span>' : "";
    // Live word counter. The limit exists because one enormous block reads
    // worse to the agent than several entries — but a limit nobody can see
    // until they hit it is just a failed save.
    const counter = field.name === "answer" ? '<span class="intake-wordcount" data-wordcount>0 words</span>' : "";
    const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : "";
    return `<label class="full">${label}${field.required ? " *" : ""}
      <textarea name="${field.name}" ${req}${placeholder}>${escapeHtml(saved || "")}</textarea>${hint}${counter}</label>`;
  }
  if (field.type === "select") {
    const selected = saved || field.default || "";
    const opts = (field.options || []).map((o) => `<option value="${escapeHtml(o)}" ${o === selected ? "selected" : ""}>${escapeHtml(o)}</option>`).join("");
    return `<label class="${field.showWhen ? `intake-when-${field.showWhen}` : ""}" ${field.showWhen ? "hidden" : ""}>${label}<select name="${field.name}">${opts}</select></label>`;
  }
  if (field.type === "checkbox") {
    return `<label class="full intake-check"><input type="checkbox" name="${field.name}" ${saved ? "checked" : ""} /><span>${label}</span></label>`;
  }
  if (field.type === "checkbox_group") {
    const selectedValues = Array.isArray(saved) ? saved : [];
    const optionSet = new Set(field.options || []);
    const shouldDefault = !step.latestEntry && field.defaultChecked;
    const opts = (field.options || []).map((option) => intakeCheckOptionHtml(field.name, option, shouldDefault || selectedValues.includes(option))).join("");
    const otherValue = selectedValues.find((value) => !optionSet.has(value)) || "";
    const other = field.allowOther ? intakeCheckOtherHtml(field.name, otherValue) : "";
    return `<fieldset class="full intake-check-group" data-check-group="${escapeHtml(field.name)}" ${field.templateKey ? `data-template-key="${escapeHtml(field.templateKey)}"` : ""}>
      <legend>${escapeHtml(label)}</legend>
      <div class="intake-check-options">${opts}${other}</div>
    </fieldset>`;
  }
  if (field.type === "date") {
    return `<label class="${field.showWhen ? `intake-when-${field.showWhen}` : ""}" ${field.showWhen ? "hidden" : ""}>${label}
      <input type="date" name="${field.name}" /></label>`;
  }
  if (field.type === "validity") {
    const opts = validityOptions.map((o) =>
      `<option value="${o.value}" ${o.value === (step.validityDefault || "") ? "selected" : ""}>${o.label}</option>`
    ).join("");
    return `<label>${label}<select name="validity">${opts}</select></label>
      <label class="intake-custom-date" hidden>End date<input type="date" name="validUntilDate" /></label>`;
  }
  // Roughly 100 words. maxlength is the browser's own guard so an over-long
  // label is stopped at the keyboard, never at a failed save; the server
  // enforces the actual 100-word rule.
  const limit = field.name === "title" ? ' maxlength="900"' : "";
  const placeholder = field.placeholder ? ` placeholder="${escapeHtml(field.placeholder)}"` : "";
  return `<label class="${field.showWhen ? `intake-when-${field.showWhen}` : ""}" ${field.showWhen ? "hidden" : ""}>${label}${field.required ? " *" : ""}
    <input type="text" name="${field.name}" value="${escapeHtml(saved || field.default || "")}"${limit}${placeholder} ${field.required ? "required" : ""} /></label>`;
}

/** Structured rows editor — shipping rates by area, spec tables. */
function intakeRowsEditor(step) {
  if (!step.structured) return "";
  const l = step.rowLabels || { label: "Item", value: "Value", note: "Note" };
  return `
    <div class="intake-rows full">
      <div class="intake-rows-head"><b>${l.label} / ${l.value} / ${l.note}</b></div>
      <div id="intakeRows"></div>
      <button type="button" class="button button-soft" id="intakeAddRow">Add a line</button>
    </div>`;
}

function intakeRowHtml(l, values = {}) {
  const v = (k) => String(values[k] || "").replace(/"/g, "&quot;");
  return `<div class="intake-row">
    <input type="text" data-row="label" placeholder="${l.label}" value="${v("label")}" />
    <input type="text" data-row="value" placeholder="${l.value}" value="${v("value")}" />
    <input type="text" data-row="note" placeholder="${l.note}" value="${v("note")}" />
    <button type="button" class="intake-row-del" data-row-del>×</button>
  </div>`;
}

/** Add one row, optionally pre-filled from an uploaded rate card. */
function intakeAddRow(step, values = {}) {
  const holder = $("#intakeRows");
  if (!holder) return;
  const labels = step.rowLabels || { label: "Item", value: "Value", note: "Note" };
  holder.insertAdjacentHTML("beforeend", intakeRowHtml(labels, values));
  holder.lastElementChild.querySelector("[data-row-del]").onclick = (e) => e.target.closest(".intake-row").remove();
}

function intakeChecked(formData, name) {
  const checked = formData.getAll(name)
    .map((value) => String(value || "").trim())
    .filter((value) => value !== "__other__")
    .filter(Boolean);
  const other = String(formData.get(`${name}_other`) || "").trim();
  if (other) checked.push(other);
  return checked;
}

function intakeRenderCheckOptions(name, options = [], allowOther = true, defaultChecked = false) {
  const opts = options.map((option) => intakeCheckOptionHtml(name, option, defaultChecked)).join("");
  return `${opts}${allowOther ? intakeCheckOtherHtml(name) : ""}`;
}

function intakePaymentPayload(form, raw, payload) {
  const formData = new FormData(form);
  const groups = {
    paymentAcceptance: intakeChecked(formData, "payment_acceptance"),
    preferredClosingPath: intakeChecked(formData, "preferred_closing_path"),
    paymentMethods: intakeChecked(formData, "payment_methods"),
    collectBeforePayment: intakeChecked(formData, "collect_before_payment"),
    amountRules: intakeChecked(formData, "amount_rules"),
    mustNotDo: intakeChecked(formData, "must_not_do"),
    afterPayment: intakeChecked(formData, "after_payment")
  };

  const cleanText = (name) => String(raw[name] || "").trim();
  const fields = {
    paymentPolicyText: cleanText("payment_policy_text"),
    providerSource: cleanText("provider_source"),
    fixedDepositAmount: cleanText("fixed_deposit_amount"),
    percentageDeposit: cleanText("percentage_deposit"),
    reservationFeeAmount: cleanText("reservation_fee_amount"),
    websiteCheckoutUrl: cleanText("website_checkout_url"),
    bookingLink: cleanText("booking_link"),
    customerInstructions: cleanText("customer_instructions")
  };

  if (!groups.paymentAcceptance.length) {
    return { error: "Choose whether this business accepts payment from inquiries." };
  }
  if (!groups.preferredClosingPath.length) {
    return { error: "Choose the preferred closing path for ready customers." };
  }

  const acceptsPayment = groups.paymentAcceptance.some((value) => /^yes/i.test(value));
  const routesToPayment = groups.preferredClosingPath.some((value) => /payment|checkout/i.test(value));
  if ((acceptsPayment || routesToPayment) && !groups.paymentMethods.length && !fields.providerSource && !fields.websiteCheckoutUrl && !fields.bookingLink) {
    return { error: "Choose a payment method or add the provider/link source Closer should use." };
  }

  const acceptsDeposit = groups.paymentAcceptance.some((value) => /deposit|downpayment/i.test(value));
  const hasDepositRule = fields.fixedDepositAmount
    || fields.percentageDeposit
    || groups.amountRules.some((value) => /fixed deposit|percentage deposit|staff confirms|different rules/i.test(value));
  if (acceptsDeposit && !hasDepositRule) {
    return { error: "Choose how the downpayment is calculated, or say staff confirms the amount first." };
  }
  const acceptsReservationFee = groups.paymentAcceptance.some((value) => /reservation|booking fee/i.test(value));
  const hasReservationRule = fields.reservationFeeAmount
    || groups.amountRules.some((value) => /reservation fee|staff confirms|different rules/i.test(value));
  if (acceptsReservationFee && !hasReservationRule) {
    return { error: "Add the reservation fee amount, or say staff confirms the amount first." };
  }
  if (groups.amountRules.includes("Fixed deposit") && !fields.fixedDepositAmount) {
    return { error: "Add the fixed deposit or downpayment amount before saving." };
  }
  if (groups.amountRules.includes("Percentage deposit") && !fields.percentageDeposit) {
    return { error: "Add the deposit percentage before saving." };
  }
  if (groups.amountRules.includes("Reservation fee") && !fields.reservationFeeAmount) {
    return { error: "Add the reservation or booking fee amount before saving." };
  }

  const lines = [];
  const data = [];
  const addList = (label, values) => {
    if (!values.length) return;
    lines.push(`${label}: ${values.join(", ")}`);
    values.forEach((value) => data.push({ label, value, note: "" }));
  };
  const addText = (label, value) => {
    if (!value) return;
    lines.push(`${label}: ${value}`);
    data.push({ label, value: value.slice(0, 200), note: value.length > 200 ? "See payment instructions text." : "" });
  };

  addList("Payment acceptance", groups.paymentAcceptance);
  addList("Preferred closing path", groups.preferredClosingPath);
  addList("Payment methods accepted", groups.paymentMethods);
  addText("Existing payment terms or policy notes", fields.paymentPolicyText);
  addText("Payment provider or link source", fields.providerSource);
  addList("Collect before payment", groups.collectBeforePayment);
  addList("Amount rules", groups.amountRules);
  addText("Fixed deposit/downpayment amount", fields.fixedDepositAmount);
  addText("Percentage deposit", fields.percentageDeposit);
  addText("Reservation/booking fee", fields.reservationFeeAmount);
  addText("Website checkout link", fields.websiteCheckoutUrl);
  addText("Booking/reservation link", fields.bookingLink);
  addText("Customer instructions", fields.customerInstructions);
  addList("Closer must not do", groups.mustNotDo);
  addList("After payment", groups.afterPayment);

  if (!lines.length) {
    return { error: "Choose at least one payment option, or skip this step." };
  }

  return {
    ...payload,
    title: "Payment and checkout",
    answer: lines.join("\n"),
    data,
    sourceKind: "setup"
  };
}

function intakePainSolutionPayload(form, raw, payload) {
  const formData = new FormData(form);
  const groups = {
    customerPains: intakeChecked(formData, "customer_pains"),
    solutionsOffered: intakeChecked(formData, "solutions_offered"),
    outcomesToEmphasize: intakeChecked(formData, "outcomes_to_emphasize")
  };
  const notes = String(raw.pain_solution_notes || "").trim();

  const lines = [];
  const data = [];
  const addList = (label, values) => {
    if (!values.length) return;
    lines.push(`${label}: ${values.join(", ")}`);
    values.forEach((value) => data.push({ label, value, note: "" }));
  };

  if (notes) {
    lines.push(`Owner notes: ${notes}`);
    data.push({ label: "Owner notes", value: notes.slice(0, 200), note: notes.length > 200 ? "See full pain and solution notes." : "" });
  }
  addList("Customer pain points", groups.customerPains);
  addList("Solutions or advantages", groups.solutionsOffered);
  addList("Outcomes to emphasize", groups.outcomesToEmphasize);

  const industry = String(raw.pain_industry || "").trim();
  if (industry) {
    lines.unshift(`Business category: ${industry}`);
    data.unshift({ label: "Business category", value: industry, note: "" });
  }

  const manualRows = [...document.querySelectorAll(".intake-row")].map((row) => ({
    label: row.querySelector('[data-row="label"]').value.trim(),
    value: row.querySelector('[data-row="value"]').value.trim(),
    note: row.querySelector('[data-row="note"]').value.trim()
  })).filter((r) => r.label || r.value || r.note);
  if (manualRows.length) {
    lines.push("Manual pain/solution entries:");
    manualRows.forEach((row) => {
      lines.push(`- ${[row.label, row.value].filter(Boolean).join(": ")}${row.note ? ` (${row.note})` : ""}`);
      data.push(row);
    });
  }

  if (!lines.length) {
    return { error: "Describe one pain or solution, choose a checkbox, or skip this step." };
  }

  if (!notes && !groups.customerPains.length && !manualRows.length) {
    return { error: "Choose at least one customer pain point, or describe it in the text box." };
  }
  if (!notes && !groups.solutionsOffered.length && !manualRows.some((row) => row.value)) {
    return { error: "Choose at least one solution, or describe it in the text box." };
  }

  return {
    ...payload,
    title: "Pain points and solutions",
    answer: lines.join("\n"),
    data,
    sourceKind: "setup"
  };
}

/** The active step panel. */
function intakeStepPanel(step, data) {
  if (!step) return `<section class="panel"><p>Nothing to set up.</p></section>`;

  const savedValues = intakeSavedFieldValues(step);
  const fields = (step.fields || [])
    .map((f) => intakeFieldHtml(f, step, data.validityOptions || [], savedValues))
    .join("");

  // Two separate pickers, because they are two different jobs. A price list is
  // usually ONE document (spreadsheet, PDF, poster photo). Product photos are
  // MANY files, often named with the item and price. Mixing them into one
  // control meant a seller picking twenty photos and a spreadsheet together,
  // with no way to tell which was which.
  const upload = step.allowUpload
    ? `<div class="intake-upload full">
         <div class="intake-upload-slot">
           <p><b>${escapeHtml(step.docUploadTitle || "Price list or document")}</b></p>
           <p class="muted">${escapeHtml(step.docUploadHint || step.uploadHint || "A spreadsheet, PDF, or a photo of a printed price list.")}</p>
           <input type="file" class="intake-file" data-upload="doc" multiple accept=".pdf,.xlsx,.xls,.csv,.docx,image/*" />
         </div>
         <div class="intake-upload-slot">
           <p><b>${escapeHtml(step.photoUploadTitle || "Product photos")}</b></p>
           <p class="muted">${escapeHtml(step.photoUploadHint || 'Pick as many as you like. If a photo has no readable text we use its file name, so "Black tshirt P200.jpg" still works.')}</p>
           <input type="file" class="intake-file" data-upload="photos" multiple accept="image/*" />
         </div>
         <span class="muted" id="intakeFileNote"></span>
         <div id="intakeUploadList" class="intake-file-list"></div>
       </div>`
    : "";
  const setupEditNote = step.latestEntry && (step.paymentSetup || step.painSetup)
    ? `<p class="muted">Loaded your saved settings for this step. Saving will update them.</p>`
    : "";

  return `
    <section class="panel intake-panel">
      <p class="section-kicker">${step.done ? ((step.paymentSetup || step.painSetup) ? "Saved — review or change" : "Saved — you can add more") : "Step"}</p>
      <h2>${step.title}</h2>
      <p class="intake-why">${step.why}</p>
      ${step.note ? `<p class="intake-note">${step.note}</p>` : ""}
      ${setupEditNote}
      ${step.faqCheck ? intakeFaqPanel(step) : ""}
      ${step.qualification ? intakeQualificationPanel(step) : ""}
      ${step.faqCheck || step.qualification ? `
        <div class="intake-actions">
          <button class="button button-soft" type="button" id="intakeSkipBtn">Skip for now</button>
        </div>` : `
      <form id="intakeForm" class="form-grid">
        ${upload}
        ${fields}
        ${intakeRowsEditor(step)}
        <div class="intake-actions full">
          <button class="button button-primary" type="submit">Save and continue</button>
          <button class="button button-soft" type="button" id="intakeSkipBtn">Skip for now</button>
        </div>
      </form>`}
    </section>`;
}

/** Collect the form into the API shape, handling validity and structured rows. */
function intakeCollect(form, step) {
  const raw = Object.fromEntries(new FormData(form));

  // Uploaded files and typed text are combined only at save time. Each upload
  // keeps its own edits until then, so adding or removing a file never
  // disturbs what the client typed by hand.
  const uploadText = intakeState.uploads
    .filter((u) => (u.status === "ok" || u.status === "filename") && String(u.text || "").trim())
    .map((u) => u.text.trim())
    .join("\n\n");
  const typed = String(raw.answer || "").trim();

  const sources = intakeState.uploads.filter((u) => u.status === "ok" || u.status === "filename");
  const payload = {
    title: raw.title || step.title,
    answer: [typed, uploadText].filter(Boolean).join("\n\n"),
    currency: raw.currency || null,
    sourceKind: sources.length ? "upload" : "typed",
    sourceName: sources.length === 1 ? sources[0].name : (sources.length ? `${sources.length} files` : null)
  };

  if (raw.areas) payload.answer = `${payload.answer}\nAreas served: ${raw.areas}`;

  if (step.paymentSetup) {
    return intakePaymentPayload(form, raw, payload);
  }

  if (step.painSetup) {
    return intakePainSolutionPayload(form, raw, payload);
  }

  const validity = raw.validity;
  if (validity === "custom" && raw.validUntilDate) {
    payload.validUntil = new Date(raw.validUntilDate).toISOString();
  } else if (validity && validity !== "custom") {
    const d = new Date();
    d.setDate(d.getDate() + Number(validity));
    payload.validUntil = d.toISOString();
  } else {
    payload.validUntil = null;
  }

  if (step.structured) {
    payload.data = [...document.querySelectorAll(".intake-row")].map((row) => ({
      label: row.querySelector('[data-row="label"]').value.trim(),
      value: row.querySelector('[data-row="value"]').value.trim(),
      note: row.querySelector('[data-row="note"]').value.trim()
    })).filter((r) => r.label || r.value);
    if (!payload.answer && payload.data.length) payload.answer = step.title;
  }

  return payload;
}

function wirePainTemplates(step) {
  if (!step?.painSetup || !step.painTemplates) return;
  const select = document.querySelector('select[name="pain_industry"]');
  if (!select) return;
  const savedValues = intakeSavedFieldValues(step);

  const map = {
    customer_pains: "pains",
    solutions_offered: "solutions",
    outcomes_to_emphasize: "outcomes"
  };

  const sync = (preserveSaved = false) => {
    const template = step.painTemplates[select.value] || step.painTemplates.General || {};
    Object.entries(map).forEach(([fieldName, templateKey]) => {
      const group = document.querySelector(`[data-check-group="${fieldName}"] .intake-check-options`);
      if (!group) return;
      group.innerHTML = intakeRenderCheckOptions(fieldName, template[templateKey] || [], true, false);
      if (!preserveSaved) return;
      for (const value of savedValues[fieldName] || []) {
        const input = group.querySelector(`input[type="checkbox"][value="${CSS.escape(value)}"]`);
        if (input) input.checked = true;
        else {
          const other = group.querySelector(`input[name="${fieldName}"][value="__other__"]`);
          const otherText = group.querySelector(`input[name="${fieldName}_other"]`);
          if (other && otherText) {
            other.checked = true;
            otherText.value = value;
          }
        }
      }
    });
  };

  select.onchange = () => sync(false);
  sync(true);
}

async function intakeAttachOriginalUploads(entryId) {
  const originals = intakeState.uploads.filter((u) =>
    u.file && (u.status === "ok" || u.status === "filename" || u.rowCount)
  );
  if (!entryId || !originals.length) return;

  for (const item of originals) {
    try {
      const response = await fetch(`/api/knowledge-base/${entryId}/media`, {
        method: "POST",
        credentials: "include",
        headers: {
          "Content-Type": item.file.type || item.mimeType || "application/octet-stream",
          "X-Filename": encodeURIComponent(item.file.name || item.name || "upload")
        },
        body: item.file
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        console.warn("[intake] original upload not attached", item.name, body.error || response.status);
      }
    } catch (error) {
      console.warn("[intake] original upload not attached", item.name, error.message);
    }
  }
}

/** Main view. Replaces the old bare add-a-Q&A form. */
async function knowledgeBaseView() {
  setTitle("Knowledge Base");
  const [data, rows, gapData] = await Promise.all([
    api("/api/intake/state"),
    api("/api/knowledge-base"),
    api("/api/knowledge-gaps").catch(() => ({ gaps: [] }))
  ]);
  intakeState.data = data;
  intakeState.rows = rows;
  if (!intakeState.activeStepId || !data.steps.some((s) => s.id === intakeState.activeStepId)) {
    intakeState.activeStepId = data.currentStepId;
  }
  const step = data.steps.find((s) => s.id === intakeState.activeStepId);

  const packOptions = data.packs
    .map((p) => `<option value="${p.key}" ${p.key === data.industryPack ? "selected" : ""}>${p.label}</option>`)
    .join("");

  $("#adminContent").innerHTML = `
    ${intakeCongratsBanner(data)}
    ${intakeGapsPanel(gapData.gaps)}
    ${intakeProgressBar(data.percent, data.addressed, data.totalSteps)}
    <div class="intake-layout">
      <aside class="panel intake-rail">
        <label class="intake-pack">Business type
          <select id="intakePack">${packOptions}</select>
        </label>
        <p class="muted intake-pack-note">This changes which questions we ask, nothing else.</p>
        <div class="intake-steps">${intakeStepRail(data.steps, intakeState.activeStepId)}</div>
      </aside>
      <div class="intake-main">
        ${intakeStepPanel(step, data)}
        <section class="panel">
          <h2>What Closer knows so far (${rows.length})</h2>
          <p class="muted">Everything here is what Closer will answer from. Check it the way a customer would read it.</p>
          <div class="table-wrap"><table>
            <thead><tr><th>Topic</th><th>Detail</th><th>Source</th><th>Actions</th></tr></thead>
            <tbody>${rows.map((r) => `<tr>
              <td>${escapeHtml(r.title || r.question || r.category)}</td>
              <td>${escapeHtml(String(r.answer || "").slice(0, 120))}${String(r.answer || "").length > 120 ? "…" : ""}</td>
              <td class="muted">${escapeHtml(r.source_name || r.source_kind || "typed")}</td>
              <td class="intake-kb-actions">
                <button type="button" class="intake-link" data-view-kb="${r.id}">View</button>
                <button type="button" class="intake-link" data-edit-kb="${r.id}">Edit</button>
                <button type="button" class="intake-link is-danger" data-delete-kb="${r.id}">Delete</button>
              </td>
            </tr>`).join("") || `<tr><td colspan="4">Nothing yet. Start with the first step and this fills up as you go.</td></tr>`}</tbody>
          </table></div>
        </section>
      </div>
    </div>`;

  wireIntake(step, data);
  wireGapsPanel();
}

function wireIntake(step, data) {
  const startBtn = $("#intakeStartBtn");
  if (startBtn) startBtn.onclick = () => document.querySelector(".intake-panel")?.scrollIntoView({ behavior: "smooth" });

  $("#intakePack").onchange = async (e) => {
    await api("/api/intake/pack", { method: "POST", body: { pack: e.target.value } });
    intakeState.activeStepId = null;
    knowledgeBaseView();
  };

  document.querySelectorAll("[data-step]").forEach((btn) => {
    btn.onclick = () => {
      // Staged files belong to the step that was open. Carrying them into the
      // next step would silently file a price list under "Policies".
      intakeState.uploads = [];
      intakeState.activeStepId = btn.dataset.step;
      knowledgeBaseView();
    };
  });

  const findRow = (id) => intakeState.rows.find((r) => r.id === id);

  document.querySelectorAll("[data-view-kb]").forEach((btn) => {
    btn.onclick = () => {
      const row = findRow(btn.dataset.viewKb);
      if (row) intakeShowEntry(row, false);
    };
  });

  document.querySelectorAll("[data-edit-kb]").forEach((btn) => {
    btn.onclick = () => {
      const row = findRow(btn.dataset.editKb);
      if (row) intakeShowEntry(row, true);
    };
  });

  document.querySelectorAll("[data-delete-kb]").forEach((btn) => {
    btn.onclick = async () => {
      if (!window.confirm("Delete this? Closer will stop using it when answering customers.")) return;
      await api(`/api/knowledge-base/${btn.dataset.deleteKb}`, { method: "DELETE" });
      toast("Deleted");
      knowledgeBaseView();
    };
  });

  if (!step) return;

  const validitySelect = document.querySelector('select[name="validity"]');
  if (validitySelect) {
    validitySelect.onchange = () => {
      const custom = document.querySelector(".intake-custom-date");
      if (custom) custom.hidden = validitySelect.value !== "custom";
    };
  }

  const addRow = $("#intakeAddRow");
  if (addRow) {
    // Rows are optional. Upload/extraction steps fill them automatically when
    // possible; manual strategy steps use them for one-by-one entries.
    addRow.onclick = () => intakeAddRow(step);
  }

  wirePainTemplates(step);

  // Conditional fields: contact details appear only once they ask for a call.
  const trigger = document.querySelector('select[name="request_call"]');
  if (trigger) {
    const sync = () => {
      const wants = /^yes/i.test(trigger.value);
      document.querySelectorAll(".intake-when-request_call").forEach((el) => { el.hidden = !wants; });
    };
    trigger.onchange = sync;
    sync();
  }

  // Live word counter, wired to the same limit the server enforces.
  const answerBox = document.querySelector('textarea[name="answer"]');
  const counter = document.querySelector("[data-wordcount]");
  if (answerBox && counter) {
    const limit = (intakeState.data && intakeState.data.wordLimit) || 3000;
    const sync = () => {
      const words = intakeWordCount(answerBox.value);
      counter.textContent = `${words.toLocaleString()} / ${limit.toLocaleString()} words`;
      counter.classList.toggle("is-over", words > limit);
    };
    answerBox.oninput = sync;
    intakeState.syncWordCount = sync;
    sync();
  }

  const skipBtn = $("#intakeSkipBtn");
  if (skipBtn) {
    skipBtn.onclick = async () => {
      await api(`/api/intake/skip/${step.id}`, { method: "POST", body: {} });
      intakeState.activeStepId = null;
      toast("Skipped — you can come back to it");
      knowledgeBaseView();
    };
  }

  wireIntakeUpload(step);
  wireIntakeSubmit(step);
  if (step.faqCheck) wireFaqStep();
  if (step.qualification) wireQualificationStep();
}

/**
 * Upload reads the file server-side and PRE-FILLS the answer box. The owner
 * still reads and edits it before saving — extracted text is a suggestion with
 * a source, never a stored fact nobody looked at.
 */
/**
 * Shrink an image before upload.
 *
 * A modern phone photo is 4-12MB, and base64 inflates it by a third. Without
 * this, a customer photographing their price list hits the body limit and gets
 * "request entity too large" — which reads like their file was rejected when
 * really the request never reached the handler.
 *
 * 1600px on the long edge at JPEG 0.82 keeps printed price text legible for
 * vision OCR while typically landing under 500KB. Non-images (PDF, xlsx, docx)
 * pass through untouched — re-encoding those would destroy them.
 */
async function intakeCompress(file) {
  if (!file.type.startsWith("image/")) return { dataUrl: await intakeReadAsDataUrl(file), type: file.type, thumb: null };

  try {
    const bitmap = await createImageBitmap(file);

    const draw = (maxEdge, quality) => {
      const scale = Math.min(1, maxEdge / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(bitmap.width * scale);
      canvas.height = Math.round(bitmap.height * scale);
      const ctx = canvas.getContext("2d");
      // White backing: a transparent PNG flattened onto black makes dark text
      // unreadable, which is exactly the price list we are trying to read.
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL("image/jpeg", quality);
    };

    const dataUrl = draw(1600, 0.82);
    // A separate small thumbnail rather than reusing the full image: twenty
    // product photos held at full size is tens of megabytes sitting in memory
    // for the sake of a 44px preview.
    const thumb = draw(128, 0.6);
    bitmap.close?.();

    return { dataUrl, type: "image/jpeg", thumb };
  } catch {
    // Any failure (odd format, memory) falls back to the original file rather
    // than losing the upload.
    return { dataUrl: await intakeReadAsDataUrl(file), type: file.type, thumb: null };
  }
}

function intakeReadAsDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error("Could not read that file"));
    reader.readAsDataURL(file);
  });
}

/**
 * Staged uploads for the current step.
 *
 * Each file stays a SEPARATE item with its own editable text and its own
 * remove button, rather than being merged into one box. Reasons, from what a
 * real client actually does:
 *  - they add files in several goes ("oh, and the promo poster too"), and a
 *    native file input REPLACES its selection each time, so the only record of
 *    earlier picks has to be ours;
 *  - they change their mind about one file and must be able to drop just that
 *    one, which is impossible once the text is concatenated;
 *  - they need to correct a misread price against the file it came from, which
 *    means seeing which file produced which text.
 */
function intakeUploadItems() {
  if (!intakeState.uploads.length) return "";
  return intakeState.uploads.map((item) => {
    const badge = item.status === "reading" ? "Reading…"
      : item.status === "failed" ? "Not used"
      : item.rowCount ? `${item.rowCount} rates — check them below`
      : item.status === "filename" ? "From file name"
      : `${item.lines} line${item.lines === 1 ? "" : "s"}`;
    const tone = item.status === "failed" ? "is-failed"
      : item.mismatch ? "is-warn"
      : item.status === "filename" ? "is-warn"
      : "is-ok";
    // Mismatch is a WARNING, not a rejection — the client may know better than
    // the classifier. It stays included unless they remove it.
    const mismatchNote = item.mismatch
      ? `<p class="intake-file-warn">This looks like ${escapeHtml(item.looksLike || "a different kind of document")}, not what this step is asking for. Remove it if you added it by mistake — otherwise it will be saved.</p>`
      : "";
    return `
      <div class="intake-file-item ${tone}" data-file-id="${item.id}">
        <div class="intake-file-head">
          ${item.thumb
            ? `<img class="intake-file-thumb" src="${item.thumb}" alt="" />`
            : `<span class="intake-file-thumb is-doc" aria-hidden="true">${escapeHtml((item.name.split(".").pop() || "file").slice(0, 4).toUpperCase())}</span>`}
          <span class="intake-file-name" title="${escapeHtml(item.name)}">${escapeHtml(item.name)}</span>
          <span class="intake-file-badge">${badge}</span>
          <button type="button" class="intake-file-x" data-remove-file="${item.id}" aria-label="Remove ${escapeHtml(item.name)}">×</button>
        </div>
        ${mismatchNote}
        ${item.status === "failed"
          ? `<p class="intake-file-error">${escapeHtml(item.error || "Could not be read.")}</p>`
          : item.status === "reading"
            ? ""
            : `<textarea class="intake-file-text" data-file-text="${item.id}" rows="3">${escapeHtml(item.text || "")}</textarea>`}
      </div>`;
  }).join("");
}

function renderIntakeUploads() {
  const holder = $("#intakeUploadList");
  if (!holder) return;
  holder.innerHTML = intakeUploadItems();

  holder.querySelectorAll("[data-remove-file]").forEach((btn) => {
    btn.onclick = () => {
      intakeState.uploads = intakeState.uploads.filter((u) => u.id !== btn.dataset.removeFile);
      renderIntakeUploads();
    };
  });
  // Edits are kept on the item, so a later add or remove never discards them.
  holder.querySelectorAll("[data-file-text]").forEach((box) => {
    box.oninput = () => {
      const item = intakeState.uploads.find((u) => u.id === box.dataset.fileText);
      if (item) item.text = box.value;
    };
  });
}

function wireIntakeUpload(step) {
  const inputs = [...document.querySelectorAll(".intake-file")];
  if (!inputs.length) return;
  inputs.forEach((input) => { input.onchange = () => handleIntakeFiles(input); });
}

async function handleIntakeFiles(input) {
  const files = [...(input.files || [])];
  if (!files.length) return;
  const note = $("#intakeFileNote");

  // Clear the native input immediately. It only ever shows the LAST pick, and
  // clearing it also lets the same file be re-added after a removal — without
  // this, re-picking an identical filename fires no change event at all.
  input.value = "";

  // Stage every file first so the list appears instantly, then read them one
  // at a time. The client sees progress rather than a frozen page.
  const staged = files.map((file) => {
    const item = { id: `f${Date.now()}${Math.random().toString(36).slice(2, 7)}`, name: file.name, file, mimeType: file.type || "application/octet-stream", status: "reading", text: "", lines: 0 };
    intakeState.uploads.push(item);
    return { file, item };
  });
  renderIntakeUploads();

  for (let i = 0; i < staged.length; i += 1) {
    const { file, item } = staged[i];
    // A removal mid-batch must be respected rather than resurrected.
    if (!intakeState.uploads.some((u) => u.id === item.id)) continue;
    note.textContent = `Reading ${i + 1} of ${staged.length}…`;
    try {
      const { dataUrl, type, thumb } = await intakeCompress(file);
      item.thumb = thumb;
      renderIntakeUploads();
      const result = await api("/api/intake/extract", {
        method: "POST",
        body: { filename: file.name, mimeType: type, data: dataUrl, stepId: intakeState.activeStepId }
      });
      if (result.ok) {
        item.status = result.kind === "filename" ? "filename" : "ok";
        item.text = result.text;
        item.lines = result.lines || 0;
        item.mismatch = Boolean(result.mismatch);
        item.looksLike = result.looksLike || null;
        // A rate card comes back already flattened into rows. Drop them into
        // the editor so the client CHECKS them instead of typing them — a
        // misread cell is then a two-second fix, not a silent wrong quote.
        if (Array.isArray(result.rows) && result.rows.length) {
          const step = (intakeState.data?.steps || []).find((s) => s.id === intakeState.activeStepId);
          if (step && step.structured) {
            result.rows.forEach((row) => intakeAddRow(step, row));
            item.rowCount = result.rows.length;
            // The rows now hold this file's content, so the raw text would be
            // stored twice.
            item.text = "";
          }
        }
      } else {
        item.status = "failed";
        item.error = result.error;
      }
    } catch (error) {
      item.status = "failed";
      item.error = error.message;
    }
    renderIntakeUploads();
  }

  const usable = intakeState.uploads.filter((u) => u.status === "ok" || u.status === "filename").length;
  note.textContent = usable
    ? `${usable} file${usable === 1 ? "" : "s"} ready. Edit anything wrong, remove what you don't want, then save.`
    : "Nothing readable yet — you can still type the details below.";
}

function wireIntakeSubmit(step) {
  const form = $("#intakeForm");
  if (!form) return;
  form.onsubmit = async (event) => {
    event.preventDefault();

    if (step.liveData) {
      const formData = new FormData(form);
      const raw = Object.fromEntries(formData);
      const wantsCall = /^yes/i.test(String(raw.request_call || ""));
      if (wantsCall && !(String(raw.contact_name || "").trim() && String(raw.contact_mobile || "").trim())) {
        toast("Please give a name and mobile number so we can call you");
        return;
      }
      const availabilityItems = intakeChecked(formData, "availability_items");
      const sources = intakeChecked(formData, "live_data_sources");
      const access = intakeChecked(formData, "connection_access");
      const behavior = intakeChecked(formData, "availability_behavior");
      const sourceSummary = sources.length ? sources.join(", ") : "Not specified yet";
      await api("/api/intake/live-data", {
        method: "POST",
        body: {
          source: sourceSummary,
          availabilityItems,
          sources,
          access,
          behavior,
          requestCall: wantsCall,
          contactName: raw.contact_name || null,
          contactMobile: raw.contact_mobile || null,
          contactEmail: raw.contact_email || null,
          preferredDay: raw.preferred_day || null,
          preferredTime: raw.preferred_time || null
        }
      });
      toast(wantsCall
        ? "Thanks — our IT will call you to assess your system. Nothing is charged yet."
        : "Noted. Closer will be honest about what it can confirm.");
      intakeState.activeStepId = null;
      return knowledgeBaseView();
    }

    if (step.qualification) {
      const raw = Object.fromEntries(new FormData(form));
      const questions = String(raw.question_list || "").split("\n").map((q) => q.trim()).filter(Boolean);
      await api("/api/intake/qualification", {
        method: "POST",
        body: { questions, hotSignal: raw.hot_signal || null }
      });
      toast("Saved");
      intakeState.activeStepId = null;
      return knowledgeBaseView();
    }

    const payload = intakeCollect(form, step);
    if (payload.error) { toast(payload.error); return; }
    if (!payload.answer || !payload.answer.trim()) { toast("Please fill this in, or skip the step"); return; }

    // Same limit the server enforces, checked here so the person is told
    // before the round trip rather than after a failed save.
    const limit = (intakeState.data && intakeState.data.wordLimit) || 3000;
    const words = intakeWordCount(payload.answer);
    if (words > limit) {
      toast(`That is ${words.toLocaleString()} words and the limit is ${limit.toLocaleString()} per entry. Save part of it now and add the rest as a second entry.`);
      return;
    }

    const titleLimit = (intakeState.data && intakeState.data.titleWordLimit) || 100;
    const titleWords = intakeWordCount(payload.title);
    if (titleWords > titleLimit) {
      toast(`That title is ${titleWords} words and the limit is ${titleLimit}. Keep the title short and put the detail in the box below it.`);
      return;
    }

    try {
      const saved = await api(`/api/intake/step/${step.id}`, { method: "POST", body: payload });
      await intakeAttachOriginalUploads(saved.entry?.id);
    } catch (error) {
      // Show what the server actually said. Previously this threw into the
      // console and the screen simply did nothing.
      toast(error.message || "Could not save that — please try again");
      return;
    }
    toast("Saved — Closer knows this now");
    intakeState.uploads = [];
    intakeState.activeStepId = null;
    knowledgeBaseView();
  };
}

/**
 * Setup reminder, shown once per session on any admin screen while setup is
 * unfinished. Dismissible — a modal that cannot be closed is a trap, and an
 * owner logging in to check one lead should not be held hostage.
 */
async function maybeShowSetupModal() {
  if (sessionStorage.getItem("intakeModalSeen") === "1") return;
  let data;
  try { data = await api("/api/intake/state"); } catch { return; }
  if (!data || data.complete) return;

  const wrap = document.createElement("div");
  wrap.className = "intake-modal-backdrop";
  wrap.innerHTML = `
    <div class="intake-modal" role="dialog" aria-modal="true" aria-labelledby="intakeModalTitle">
      <h3 id="intakeModalTitle">Your setup is ${data.percent}% done</h3>
      <p>Closer is connected${data.pageName ? ` to <b>${data.pageName}</b>` : ""}, but it does not know your business yet. Until you finish, it can only tell customers that someone will follow up.</p>
      <div class="intake-bar"><span style="width:${data.percent}%"></span></div>
      <p class="muted">${data.addressed} of ${data.totalSteps} steps done. It takes a few minutes and you can stop anytime.</p>
      <div class="intake-modal-actions">
        <button class="button button-primary" id="intakeModalGo">Finish setup</button>
        <button class="button button-soft" id="intakeModalLater">Later</button>
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const close = () => { sessionStorage.setItem("intakeModalSeen", "1"); wrap.remove(); };
  wrap.querySelector("#intakeModalLater").onclick = close;
  wrap.querySelector("#intakeModalGo").onclick = () => {
    close();
    history.pushState(null, "", adminPath("knowledge-base"));
    routeHandler();
  };
  wrap.onclick = (e) => { if (e.target === wrap) close(); };
}

/* ---------------------------------------------------------------------------
 * Wizard styles. Injected from JS so the admin shell's stylesheet is untouched
 * — §12 locks the /admin screens' structure, and a stylesheet edit is the kind
 * of change that quietly alters a Meta-reviewed screen.
 * ------------------------------------------------------------------------- */
(function injectIntakeStyles() {
  const css = `
  .intake-progress { margin-bottom: 18px; padding: 16px 18px; border-radius: 12px; background: #f4f2ff; border: 1px solid #e0dbff; }
  .intake-progress.is-complete { background: #eefaf1; border-color: #cdeeda; }
  .intake-progress-head { display: flex; justify-content: space-between; align-items: baseline; margin-bottom: 10px; }
  .intake-bar { height: 8px; border-radius: 99px; background: #e2ddf5; overflow: hidden; }
  .intake-bar > span { display: block; height: 100%; background: #6b4dff; border-radius: 99px; transition: width .35s ease; }
  .intake-progress.is-complete .intake-bar > span { background: #2f9e63; }

  .intake-banner { margin-bottom: 18px; padding: 20px 22px; border-radius: 12px; background: #eefaf1; border: 1px solid #cdeeda; }
  .intake-banner.is-done { background: #f4f2ff; border-color: #e0dbff; }
  .intake-banner h3 { margin: 0 0 8px; }
  .intake-banner p { margin: 0 0 10px; }

  .intake-layout { display: grid; grid-template-columns: 280px 1fr; gap: 18px; align-items: start; }
  .intake-rail { position: sticky; top: 18px; }
  .intake-pack select { width: 100%; }
  .intake-pack-note { font-size: 12px; margin: 6px 0 14px; }
  .intake-steps { display: grid; gap: 4px; }
  .intake-step-item { display: flex; gap: 10px; align-items: center; width: 100%; padding: 10px 12px; border: 0; border-radius: 8px; background: transparent; text-align: left; cursor: pointer; font: inherit; }
  .intake-step-item:hover { background: #f5f3ff; }
  .intake-step-item.is-active { background: #ece7ff; font-weight: 600; }
  .intake-step-item.is-done { color: #2f7a52; }
  .intake-step-item.is-skipped { color: #98a1ad; }
  .intake-step-mark { width: 18px; display: inline-block; }
  `;
  const tag = document.createElement("style");
  tag.textContent = css;
  document.head.appendChild(tag);
})();

(function injectIntakeStyles2() {
  const css = `
  .intake-panel .intake-why { margin: -4px 0 18px; padding: 12px 14px; border-left: 3px solid #6b4dff; background: #f7f5ff; border-radius: 0 8px 8px 0; }
  .intake-panel .intake-note { margin: -8px 0 18px; padding: 12px 14px; border-left: 3px solid #d99b24; background: #fff8ec; border-radius: 0 8px 8px 0; font-size: 13px; }
  .intake-upload { padding: 14px; border: 1px dashed #cfd6e4; border-radius: 10px; background: #fafbfe; display: grid; gap: 14px; }
  .intake-upload-slot { padding: 12px; border-radius: 8px; background: #fff; border: 1px solid #eef1f6; }
  .intake-upload-slot p { margin: 0 0 6px; }
  .intake-upload-slot p.muted { font-size: 12px; margin-bottom: 10px; }
  .intake-file-list { display: grid; gap: 8px; }
  .intake-file-item { padding: 10px 12px; border-radius: 8px; border: 1px solid #e3e8f0; background: #fff; }
  .intake-file-item.is-ok { border-left: 3px solid #2f9e63; }
  .intake-file-item.is-warn { border-left: 3px solid #d99b24; }
  .intake-file-item.is-failed { border-left: 3px solid #cf4b4b; background: #fff8f8; }
  .intake-file-head { display: flex; align-items: center; gap: 10px; }
  .intake-file-thumb { width: 44px; height: 44px; border-radius: 6px; object-fit: cover; flex: 0 0 auto; border: 1px solid #e3e8f0; background: #fff; }
  .intake-file-thumb.is-doc { display: grid; place-items: center; font-size: 10px; font-weight: 800; color: #6a7382; background: #f2f4f8; letter-spacing: .04em; }
  .intake-file-name { flex: 1; font-weight: 600; font-size: 13px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .intake-file-badge { font-size: 11px; color: #6a7382; white-space: nowrap; }
  .intake-file-x { border: 0; background: #f2f4f8; border-radius: 6px; width: 24px; height: 24px; cursor: pointer; font-size: 16px; line-height: 1; color: #55607a; }
  .intake-file-x:hover { background: #ffe3e3; color: #b32d2d; }
  .intake-file-text { width: 100%; margin-top: 8px; font-size: 12px; font-family: inherit; }
  .intake-file-error { margin: 6px 0 0; font-size: 12px; color: #b32d2d; }
  .intake-file-warn { margin: 6px 0 0; font-size: 12px; color: #8a5a00; background: #fff6e6; padding: 6px 8px; border-radius: 6px; }
  .intake-wordcount { justify-self: end; font-size: 11px; color: #6a7382; font-weight: 600; }
  .intake-wordcount.is-over { color: #b32d2d; }
  .intake-actions { display: flex; gap: 10px; align-items: center; }
  .intake-check { display: flex !important; gap: 10px; align-items: center; grid-column: 1 / -1; }
  .intake-check input[type=checkbox] { width: 18px; height: 18px; margin: 0; flex: 0 0 auto; }
  .intake-check-group { border: 1px solid #e3e8f0; border-radius: 10px; padding: 12px; background: #fbfcff; }
  .intake-check-group legend { padding: 0 4px; color: #344054; font-weight: 800; font-size: 13px; }
  .intake-check-options { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; margin-top: 6px; }
  .intake-check-option { display: flex !important; align-items: flex-start; gap: 8px; min-height: 38px; padding: 8px 10px; border: 1px solid #eef1f6; border-radius: 8px; background: #fff; color: #344054 !important; font-weight: 700 !important; }
  .intake-check-option input[type=checkbox] { width: 18px; height: 18px; margin: 1px 0 0; flex: 0 0 auto; }
  .intake-check-option span { min-width: 0; line-height: 1.25; }
  .intake-check-option.intake-check-other { display: grid !important; grid-template-columns: auto auto minmax(160px, 1fr); align-items: center; }
  .intake-check-other input[type=text] { width: 100%; min-height: 34px; padding: 6px 8px; font-size: 13px; }
  .intake-kb-actions { white-space: nowrap; }
  .intake-link { border: 0; background: none; padding: 2px 6px; cursor: pointer; font: inherit; font-size: 12px; color: #4b3ecf; text-decoration: underline; }
  .intake-link.is-danger { color: #b32d2d; }
  .intake-entry-view { white-space: pre-wrap; word-break: break-word; max-height: 50vh; overflow: auto; background: #f7f8fb; padding: 12px; border-radius: 8px; font-size: 13px; font-family: inherit; }
  .intake-modal textarea { width: 100%; font: inherit; font-size: 13px; }
  .intake-rows-head { margin-bottom: 8px; font-size: 12px; color: #6a7382; }
  .intake-row { display: grid; grid-template-columns: 1fr 1fr 1fr 32px; gap: 8px; margin-bottom: 8px; }
  .intake-row-del { border: 0; background: #f2f4f8; border-radius: 8px; cursor: pointer; font-size: 18px; line-height: 1; }

  .intake-modal-backdrop { position: fixed; inset: 0; background: rgba(14,18,28,.5); display: grid; place-items: center; z-index: 9999; padding: 20px; }
  .intake-modal { max-width: 460px; width: 100%; padding: 26px; border-radius: 14px; background: #fff; box-shadow: 0 24px 60px rgba(0,0,0,.25); }
  /* The whole dialog scrolls, not just the text block. A long entry used to
     push the upload picker and the buttons below the viewport with no way to
     reach them. */
  .intake-modal.is-wide { max-width: 720px; max-height: 88vh; overflow-y: auto; }
  .intake-modal.is-wide .intake-entry-view { max-height: 240px; }
  .intake-modal h3 { margin: 0 0 10px; }
  .intake-modal .intake-bar { margin: 14px 0 8px; }
  .intake-modal-actions { display: flex; gap: 10px; margin-top: 18px; }

  @media (max-width: 900px) {
    .intake-layout { grid-template-columns: 1fr; }
    .intake-rail { position: static; }
    .intake-row { grid-template-columns: 1fr 1fr; }
    .intake-check-options { grid-template-columns: 1fr; }
  }
  `;
  const tag = document.createElement("style");
  tag.textContent = css;
  document.head.appendChild(tag);
})();

/**
 * View or edit one knowledge base entry.
 *
 * Same modal for both: viewing and then wanting to fix a typo is the common
 * path, so "View" opens read-only with an Edit button rather than making them
 * close and re-pick from the table.
 */
function intakeShowEntry(row, editing) {
  const wrap = document.createElement("div");
  wrap.className = "intake-modal-backdrop";
  const expires = row.valid_until ? String(row.valid_until).slice(0, 10) : "No end date";

  const media = Array.isArray(row.media) ? row.media : [];

  // Media lives in the entry dialog because that is where someone goes when
  // they notice a poster is missing. Files are stored at ORIGINAL quality —
  // the compressed copy the wizard makes is only for reading text.
  const mediaBlock = `
    <p class="settings-group">Files Closer can send (${media.length})</p>
    ${media.length ? `<div class="entry-media">${media.map((m) => `
      <div class="entry-media-item" data-media-url="${escapeHtml(m.url)}">
        ${m.type === "image"
          ? `<img src="${escapeHtml(m.url)}" alt="" />`
          : `<span class="entry-media-doc">${escapeHtml((m.type || "file").toUpperCase())}</span>`}
        <div class="entry-media-meta">
          <b>${escapeHtml(m.filename || "file")}</b>
          <span class="muted">${Math.round((m.bytes || 0) / 1024)} KB</span>
          <a href="${escapeHtml(m.url)}" target="_blank" rel="noopener">Public link</a>
        </div>
        <button type="button" class="intake-row-del" data-media-del title="Remove">\u00d7</button>
      </div>`).join("")}</div>`
      : `<p class="muted">No file attached yet. Closer can describe this but cannot send it.</p>`}
    <div class="entry-media-upload">
      <input type="file" id="entryMediaFile" accept="image/*,video/mp4,video/quicktime,application/pdf" />
      <p class="muted">JPG, PNG, GIF, WebP, MP4, MOV or PDF, up to 25MB. Stored at full quality with a public link so Facebook can fetch it.</p>
      <span class="muted" id="entryMediaNote"></span>
    </div>`;

  wrap.innerHTML = `
    <div class="intake-modal is-wide" role="dialog" aria-modal="true">
      <h3>${escapeHtml(row.title || row.question || row.category)}</h3>
      <p class="muted">Source: ${escapeHtml(row.source_name || row.source_kind || "typed")} \u00b7 Expires: ${escapeHtml(expires)}</p>
      ${editing
        ? `<textarea id="intakeEntryText" rows="10">${escapeHtml(row.answer || "")}</textarea>`
        : `<pre class="intake-entry-view">${escapeHtml(row.answer || "")}</pre>`}
      ${mediaBlock}
      <div class="intake-modal-actions">
        ${editing
          ? `<button class="button button-primary" id="intakeEntrySave">Save changes</button>
             <button class="button button-soft" id="intakeEntryClose">Cancel</button>`
          : `<button class="button button-primary" id="intakeEntryEdit">Edit</button>
             <button class="button button-soft" id="intakeEntryClose">Close</button>`}
      </div>
    </div>`;
  document.body.appendChild(wrap);

  const close = () => wrap.remove();
  wrap.querySelector("#intakeEntryClose").onclick = close;
  wrap.onclick = (e) => { if (e.target === wrap) close(); };

  // Upload the ORIGINAL file as raw bytes — no canvas re-encode, no base64.
  // The wizard's compressed copy exists only so vision can read text; this is
  // the file a customer will actually receive.
  const fileInput = wrap.querySelector("#entryMediaFile");
  if (fileInput) {
    fileInput.onchange = async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const note = wrap.querySelector("#entryMediaNote");
      note.textContent = `Uploading ${file.name}…`;
      try {
        const response = await fetch(`/api/knowledge-base/${row.id}/media`, {
          method: "POST",
          credentials: "include",
          headers: {
            "Content-Type": file.type || "application/octet-stream",
            "X-Filename": encodeURIComponent(file.name),
            "X-Caption": encodeURIComponent(row.title || "")
          },
          body: file
        });
        const result = await response.json();
        if (!result.ok) { note.textContent = result.error || "Upload failed."; return; }
        toast("Uploaded — Closer can send this now");
        close();
        knowledgeBaseView();
      } catch (error) {
        note.textContent = error.message;
      }
    };
  }

  wrap.querySelectorAll("[data-media-del]").forEach((btn) => {
    btn.onclick = async () => {
      const url = btn.closest("[data-media-url]").dataset.mediaUrl;
      if (!window.confirm("Remove this file? Closer will stop sending it.")) return;
      await api(`/api/knowledge-base/${row.id}/media`, { method: "DELETE", body: { url } });
      toast("Removed");
      close();
      knowledgeBaseView();
    };
  });

  const editBtn = wrap.querySelector("#intakeEntryEdit");
  if (editBtn) editBtn.onclick = () => { close(); intakeShowEntry(row, true); };

  const saveBtn = wrap.querySelector("#intakeEntrySave");
  if (saveBtn) {
    saveBtn.onclick = async () => {
      const answer = wrap.querySelector("#intakeEntryText").value.trim();
      if (!answer) { toast("It cannot be empty — delete it instead"); return; }
      await api(`/api/knowledge-base/${row.id}`, { method: "PUT", body: { answer } });
      toast("Updated — Closer uses this now");
      close();
      knowledgeBaseView();
    };
  }
}

/* ===========================================================================
 * Suggested questions (2026-08-18)
 *
 * The customer should never face an empty box. Editing beats authoring, and
 * rejecting beats inventing — an owner who cannot write a qualification
 * question can absolutely tell you which of eight suggestions are wrong.
 * ========================================================================= */

const faqState = { items: null, loading: false };

/** The FAQ review step: 30 likely questions, checked against what they entered. */
function intakeFaqPanel(step) {
  if (faqState.loading) {
    return `<p class="muted">Thinking about what your customers will ask… this takes a few seconds.</p>`;
  }
  if (!faqState.items) {
    return `
      <p class="muted">We will list the questions your customers are most likely to ask, then show which ones Closer can already answer.</p>
      <button class="button button-primary" type="button" id="faqGenerate">Show me the questions</button>`;
  }

  const gaps = faqState.items.filter((i) => !i.covered && !i.skipped);
  const covered = faqState.items.filter((i) => i.covered);

  return `
    <div class="faq-summary">
      <b>${covered.length} of ${faqState.items.length} already answered.</b>
      ${gaps.length ? `<span class="faq-gap-count">${gaps.length} need your answer</span>` : `<span class="faq-ok">Nothing missing.</span>`}
    </div>

    ${gaps.length ? `
      <p class="muted">These are the ones Closer cannot answer yet. Fill in what you can — skip anything that does not apply to your business.</p>
      <div class="faq-list">
        ${gaps.map((item, i) => `
          <div class="faq-item" data-faq-index="${faqState.items.indexOf(item)}">
            <p class="faq-q">${escapeHtml(item.question)}</p>
            <textarea rows="2" data-faq-answer placeholder="Your answer…">${escapeHtml(item.answer || "")}</textarea>
            <button type="button" class="intake-link" data-faq-skip>Not applicable</button>
          </div>`).join("")}
      </div>` : ""}

    ${covered.length ? `
      <details class="faq-covered">
        <summary>${covered.length} Closer can already answer</summary>
        <ul>${covered.map((c) => `<li>${escapeHtml(c.question)} <span class="muted">— ${escapeHtml(c.source || "from your knowledge base")}</span></li>`).join("")}</ul>
        <p class="muted">These are not saved again — they are already in your knowledge base, and storing a second copy would let the two drift apart.</p>
      </details>` : ""}

    <div class="intake-actions">
      <button class="button button-primary" type="button" id="faqSave">Save my answers</button>
      <button class="button button-soft" type="button" id="faqRegenerate">Suggest more questions</button>
    </div>`;
}

function wireFaqStep() {
  const generate = $("#faqGenerate") || $("#faqRegenerate");
  if (generate) {
    generate.onclick = async () => {
      faqState.loading = true;
      knowledgeBaseView();
      try {
        const result = await api("/api/intake/suggest-faq", { method: "POST", body: {} });
        faqState.loading = false;
        if (!result.ok) { toast(result.error); faqState.items = null; knowledgeBaseView(); return; }
        // Merge rather than replace, so "suggest more" adds to the list
        // instead of throwing away answers already typed.
        const existing = faqState.items || [];
        const seen = new Set(existing.map((i) => i.question.toLowerCase()));
        faqState.items = [...existing, ...result.questions.filter((q) => !seen.has(q.question.toLowerCase()))];
      } catch (error) {
        faqState.loading = false;
        toast(error.message);
      }
      knowledgeBaseView();
    };
  }

  document.querySelectorAll("[data-faq-answer]").forEach((box) => {
    box.oninput = () => {
      const idx = Number(box.closest("[data-faq-index]").dataset.faqIndex);
      faqState.items[idx].answer = box.value;
    };
  });

  document.querySelectorAll("[data-faq-skip]").forEach((btn) => {
    btn.onclick = () => {
      const idx = Number(btn.closest("[data-faq-index]").dataset.faqIndex);
      // Skipped means SKIPPED — no row is written. Storing "NA" as an answer
      // would let Closer say "NA" to a customer.
      faqState.items[idx].skipped = true;
      faqState.items[idx].answer = "";
      knowledgeBaseView();
    };
  });

  const save = $("#faqSave");
  if (save) {
    save.onclick = async () => {
      const items = (faqState.items || [])
        .filter((i) => !i.covered && !i.skipped && String(i.answer || "").trim())
        .map((i) => ({ question: i.question, answer: i.answer.trim(), category: i.category || "Business" }));
      if (!items.length) { toast("Answer at least one question, or skip this step"); return; }
      const result = await api("/api/intake/faq", { method: "POST", body: { items } });
      toast(`Added ${result.added} answer${result.added === 1 ? "" : "s"} — Closer knows these now`);
      // Answered ones become covered; the list stays so they can keep going.
      faqState.items = faqState.items.map((i) =>
        items.some((s) => s.question === i.question) ? { ...i, covered: true, source: "you just answered it" } : i);
      knowledgeBaseView();
    };
  }
}

const qualState = { suggestions: null, loading: false, fields: [] };

/** The qualification step: suggested questions, each editable and removable. */
function intakeQualificationPanel(step) {
  if (qualState.loading) {
    return `<p class="muted">Working out what you need to ask a buyer…</p>`;
  }
  if (!qualState.suggestions) {
    return `
      <p class="muted">Rather than starting from a blank box, we can suggest the questions that turn a chat into a lead for your kind of business. Edit or delete anything that does not fit.</p>
      <button class="button button-primary" type="button" id="qualGenerate">Suggest questions for my business</button>
      <details class="faq-covered"><summary>Or write them myself</summary>
        <div id="qualManual"></div>
        <button type="button" class="button button-soft" id="qualAddBlank">Add a question</button>
      </details>`;
  }

  const fieldOptions = (selected) => qualState.fields
    .map((f) => `<option value="${f.key}" ${f.key === selected ? "selected" : ""}>${escapeHtml(f.label)}</option>`).join("");

  return `
    <p class="muted">These are suggestions — edit the wording, change what each one saves, or delete any that do not apply. Nothing is saved until you press the button below.</p>
    <div class="qual-list">
      ${qualState.suggestions.map((q, i) => `
        <div class="qual-item" data-qual-index="${i}">
          <input type="text" data-qual-question value="${escapeHtml(q.question)}" />
          <select data-qual-field>${fieldOptions(q.field_key)}</select>
          <button type="button" class="intake-row-del" data-qual-del title="Remove">×</button>
          ${q.why ? `<p class="qual-why muted">${escapeHtml(q.why)}</p>` : ""}
        </div>`).join("")}
    </div>
    <div class="intake-actions">
      <button class="button button-primary" type="button" id="qualSave">Save these questions</button>
      <button class="button button-soft" type="button" id="qualAdd">Add another</button>
    </div>`;
}

function wireQualificationStep() {
  const gen = $("#qualGenerate");
  if (gen) {
    gen.onclick = async () => {
      qualState.loading = true;
      knowledgeBaseView();
      try {
        const result = await api("/api/intake/suggest-qualification", { method: "POST", body: {} });
        qualState.loading = false;
        if (!result.ok) { toast(result.error); knowledgeBaseView(); return; }
        qualState.suggestions = result.questions;
        qualState.fields = result.fields;
      } catch (error) {
        qualState.loading = false;
        toast(error.message);
      }
      knowledgeBaseView();
    };
  }

  document.querySelectorAll("[data-qual-question]").forEach((input) => {
    input.oninput = () => {
      const i = Number(input.closest("[data-qual-index]").dataset.qualIndex);
      qualState.suggestions[i].question = input.value;
    };
  });
  document.querySelectorAll("[data-qual-field]").forEach((sel) => {
    sel.onchange = () => {
      const i = Number(sel.closest("[data-qual-index]").dataset.qualIndex);
      qualState.suggestions[i].field_key = sel.value;
    };
  });
  document.querySelectorAll("[data-qual-del]").forEach((btn) => {
    btn.onclick = () => {
      const i = Number(btn.closest("[data-qual-index]").dataset.qualIndex);
      qualState.suggestions.splice(i, 1);
      knowledgeBaseView();
    };
  });

  const add = $("#qualAdd");
  if (add) {
    add.onclick = () => {
      qualState.suggestions.push({ question: "", field_key: "notes", required: true, why: "" });
      knowledgeBaseView();
    };
  }

  const save = $("#qualSave");
  if (save) {
    save.onclick = async () => {
      const questions = qualState.suggestions
        .filter((q) => String(q.question || "").trim())
        .map((q) => ({ question: q.question.trim(), field_key: q.field_key }));
      if (!questions.length) { toast("Add at least one question, or skip this step"); return; }
      // Writes to the same QualificationQuestion table the standalone
      // Qualification Questions screen reads, so the two never diverge.
      await api("/api/intake/qualification", { method: "POST", body: { questions, replace: true } });
      toast(`Saved ${questions.length} questions — Closer asks these from now on`);
      qualState.suggestions = null;
      intakeState.activeStepId = null;
      knowledgeBaseView();
    };
  }
}

(function injectSuggestionStyles() {
  const css = `
  .faq-summary { display: flex; gap: 12px; align-items: baseline; padding: 12px 14px; border-radius: 10px; background: #f4f2ff; border: 1px solid #e0dbff; margin-bottom: 14px; }
  .faq-gap-count { color: #8a5a00; font-weight: 700; }
  .faq-ok { color: #22694a; font-weight: 700; }
  .faq-list { display: grid; gap: 12px; margin-bottom: 16px; }
  .faq-item { padding: 12px 14px; border: 1px solid #e3e8f0; border-left: 3px solid #d99b24; border-radius: 8px; background: #fff; }
  .faq-q { margin: 0 0 8px; font-weight: 600; }
  .faq-item textarea { width: 100%; font: inherit; font-size: 13px; }
  .faq-covered { margin: 8px 0 16px; }
  .faq-covered summary { cursor: pointer; font-weight: 700; padding: 8px 0; color: #22694a; }
  .faq-covered ul { margin: 6px 0 0; padding-left: 18px; font-size: 13px; line-height: 1.7; }
  .qual-list { display: grid; gap: 10px; margin-bottom: 16px; }
  .qual-item { display: grid; grid-template-columns: 1fr 200px 32px; gap: 8px; align-items: center; }
  .qual-item input, .qual-item select { font: inherit; font-size: 13px; }
  .qual-why { grid-column: 1 / -1; margin: 0; font-size: 12px; }
  @media (max-width: 900px) { .qual-item { grid-template-columns: 1fr 32px; } .qual-item select { grid-column: 1; } }
  `;
  const tag = document.createElement("style");
  tag.textContent = css;
  document.head.appendChild(tag);
})();

/* ===========================================================================
 * Knowledge gaps — real questions Closer could not answer (2026-08-18)
 *
 * Shown ABOVE the wizard because it outranks everything else on the screen:
 * predicted questions are a guess, these are evidence. Someone already asked,
 * and already did not get an answer.
 * ========================================================================= */

function intakeGapsPanel(gaps) {
  if (!gaps || !gaps.length) return "";
  return `
    <section class="panel gaps-panel">
      <h2>Your customers asked these — Closer could not answer</h2>
      <p class="muted settings-lede">Real questions from real conversations, most asked first. Answer one and Closer can handle it from the next message onward.</p>
      <div class="faq-list">
        ${gaps.map((g) => `
          <div class="faq-item" data-gap-id="${g.id}">
            <p class="faq-q">${escapeHtml(g.question)}
              ${g.times_asked > 1 ? `<span class="gap-count">asked ${g.times_asked}×</span>` : ""}
            </p>
            <textarea rows="2" data-gap-answer placeholder="Your answer…"></textarea>
            <div class="intake-actions">
              <button type="button" class="button button-primary button-sm" data-gap-save>Save answer</button>
              <button type="button" class="intake-link" data-gap-dismiss>Not needed</button>
            </div>
          </div>`).join("")}
      </div>
    </section>`;
}

function wireGapsPanel() {
  document.querySelectorAll("[data-gap-save]").forEach((btn) => {
    btn.onclick = async () => {
      const wrap = btn.closest("[data-gap-id]");
      const answer = wrap.querySelector("[data-gap-answer]").value.trim();
      if (!answer) { toast("Type an answer first, or mark it not needed"); return; }
      await api(`/api/knowledge-gaps/${wrap.dataset.gapId}/answer`, { method: "POST", body: { answer } });
      toast("Saved — Closer can answer this now");
      knowledgeBaseView();
    };
  });
  document.querySelectorAll("[data-gap-dismiss]").forEach((btn) => {
    btn.onclick = async () => {
      const wrap = btn.closest("[data-gap-id]");
      await api(`/api/knowledge-gaps/${wrap.dataset.gapId}/dismiss`, { method: "POST", body: {} });
      knowledgeBaseView();
    };
  });
}

(function injectGapStyles() {
  const css = `
  .gaps-panel { border-left: 3px solid #d99b24; }
  .gap-count { display: inline-block; margin-left: 8px; padding: 2px 8px; border-radius: 99px;
    background: #fff3d6; color: #8a5a00; font: 800 11px inherit; }
  .button-sm { padding: 6px 12px; font-size: 13px; }
  `;
  const tag = document.createElement("style");
  tag.textContent = css;
  document.head.appendChild(tag);
})();

(function injectMediaStyles() {
  const css = `
  .entry-media { display: grid; gap: 8px; margin: 8px 0 14px; }
  .entry-media-item { display: flex; align-items: center; gap: 12px; padding: 8px 10px;
    border: 1px solid #e3e8f0; border-radius: 8px; background: #fff; }
  .entry-media-item img { width: 56px; height: 56px; object-fit: cover; border-radius: 6px; flex: 0 0 auto; border: 1px solid #eef1f6; }
  .entry-media-doc { width: 56px; height: 56px; display: grid; place-items: center; border-radius: 6px;
    background: #f2f4f8; color: #6a7382; font: 800 11px inherit; flex: 0 0 auto; }
  .entry-media-meta { flex: 1; display: grid; gap: 2px; font-size: 12px; min-width: 0; }
  .entry-media-meta b { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .entry-media-meta a { color: #4b3ecf; }
  .entry-media-upload { padding: 12px; border: 1px dashed #cfd6e4; border-radius: 8px; background: #fafbfe; }
  .entry-media-upload p { margin: 8px 0 0; font-size: 12px; }
  `;
  const tag = document.createElement("style");
  tag.textContent = css;
  document.head.appendChild(tag);
})();
