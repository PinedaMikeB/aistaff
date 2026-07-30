const commerceState = {
  pricing: null,
  billing: "monthly",
  selectedPlan: null,
  addOns: new Set(),
  cart: null,
  guestToken: localStorage.getItem("aistaff_guest_token") || "",
  selectedProvider: "xendit",
  processing: false
};

const qs = (selector) => document.querySelector(selector);
const peso = (value) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value || 0));
const safe = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

async function api(path, options = {}) {
  const response = await fetch(path, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
    ...options,
    body: options.body && typeof options.body !== "string" ? JSON.stringify(options.body) : options.body
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.error || "Request failed");
  return payload;
}

function planPrice(plan) {
  return commerceState.billing === "annual" ? plan.annualPrice : plan.monthlyPrice;
}

function billingLabel() {
  return commerceState.billing === "annual" ? "Billed annually" : "Billed monthly";
}

function renderPricing() {
  const cards = qs("#pricingCards");
  cards.innerHTML = commerceState.pricing.plans.map((plan) => `
    <article class="commerce-price-card ${plan.badge ? "popular" : ""}">
      ${plan.badge ? `<span class="plan-badge">${safe(plan.badge)}</span>` : ""}
      <h3>${safe(plan.name)}</h3>
      <strong>${peso(planPrice(plan))}</strong>
      <small>${billingLabel()}</small>
      <p>${safe(plan.bestFor)}</p>
      <dl>
        <div><dt>Conversation limit</dt><dd>${Number(plan.conversationLimit).toLocaleString("en-PH")} / ${commerceState.billing === "annual" ? "year equivalent" : "month"}</dd></div>
        <div><dt>Facebook Pages</dt><dd>Up to ${plan.facebookPageLimit}</dd></div>
        <div><dt>Onboarding</dt><dd>${safe(plan.onboarding)}</dd></div>
      </dl>
      <ul>${plan.features.slice(0, 9).map((feature) => `<li>${safe(feature)}</li>`).join("")}</ul>
      <button type="button" class="button button-primary full" data-select-plan="${plan.slug}">${safe(plan.cta)}</button>
    </article>
  `).join("");
  cards.querySelectorAll("[data-select-plan]").forEach((button) => {
    button.onclick = () => selectPlan(button.dataset.selectPlan);
  });
}

function renderPaymentMethods(country = "Philippines") {
  const isPH = country.toLowerCase().includes("philippines");
  const methods = isPH ? [
    ["xendit", "Xendit local payments", "GCash, Maya, QR Ph, online banking, cards, bank transfer when configured"],
    ["manual_bank_transfer", "Manual bank transfer", "Available for verification by admin"]
  ] : [
    ["stripe", "Stripe international payments", "Visa, Mastercard, American Express, Apple Pay, Google Pay when configured"],
    ["manual_bank_transfer", "Manual bank transfer", "Available for verification by admin"]
  ];
  commerceState.selectedProvider = methods[0][0];
  qs("#paymentMethods").innerHTML = methods.map(([id, label, detail]) => `
    <label class="payment-method ${commerceState.selectedProvider === id ? "selected" : ""}">
      <input type="radio" name="payment_provider" value="${id}" ${commerceState.selectedProvider === id ? "checked" : ""} />
      <span><b>${label}</b><small>${detail}</small></span>
    </label>
  `).join("");
  qs("#paymentModeNote").textContent = commerceState.pricing.paymentMode === "test"
    ? "Secure online payment integration is currently in test mode."
    : "Payment integration is configured for the current environment.";
  qs("#paymentMethods").querySelectorAll("input").forEach((input) => {
    input.onchange = () => {
      commerceState.selectedProvider = input.value;
      renderPaymentMethods(qs("[name='country']").value || "Philippines");
    };
  });
}

function addOnPrice(addon) {
  if (addon.billingType === "custom_quotation") return 0;
  if (addon.billingType === "monthly_recurring" && commerceState.billing === "annual") return addon.price * 12 * 0.9;
  return addon.price;
}

async function selectPlan(planSlug) {
  commerceState.selectedPlan = planSlug;
  await syncCart();
  qs("#cart").scrollIntoView({ behavior: "smooth", block: "start" });
}

async function syncCart() {
  if (!commerceState.selectedPlan) return;
  const payload = {
    planSlug: commerceState.selectedPlan,
    billingFrequency: commerceState.billing,
    addOnSlugs: [...commerceState.addOns],
    guestToken: commerceState.guestToken || null
  };
  const result = commerceState.cart
    ? await api(`/api/cart/${commerceState.cart.id}`, { method: "PATCH", body: payload })
    : await api("/api/cart", { method: "POST", body: payload });
  commerceState.cart = result.cart || result;
  if (result.guestToken) {
    commerceState.guestToken = result.guestToken;
    localStorage.setItem("aistaff_guest_token", result.guestToken);
  }
  renderSummary();
}

function renderSummary() {
  const summary = qs("#orderSummary");
  if (!commerceState.cart?.items?.length) {
    summary.innerHTML = "<p>Select a package to begin checkout.</p>";
    qs("#checkoutBtn").disabled = true;
    return;
  }
  const plan = commerceState.cart.items.find((item) => item.item_type === "pricing_plan");
  const renewal = new Date();
  if (commerceState.billing === "annual") renewal.setFullYear(renewal.getFullYear() + 1);
  else renewal.setMonth(renewal.getMonth() + 1);
  summary.innerHTML = `
    <div class="summary-selected"><b>${safe(plan.item_name)}</b><span>${safe(plan.billing_frequency)}</span></div>
    <div class="add-on-picker">
      <b>Optional add-ons</b>
      ${commerceState.pricing.addOns.map((addon) => `
        <label>
          <input type="checkbox" value="${addon.slug}" ${commerceState.addOns.has(addon.slug) ? "checked" : ""} />
          <span>${safe(addon.name)} <small>${addon.billingType === "custom_quotation" ? "Custom quotation, excluded from total" : `${peso(addOnPrice(addon))} · ${addon.billingType.replaceAll("_", " ")}`}</small></span>
        </label>
      `).join("")}
    </div>
    <div class="summary-line"><span>Package and add-ons</span><b>${peso(commerceState.cart.subtotal)}</b></div>
    <div class="summary-line"><span>Applicable tax</span><b>${peso(commerceState.cart.tax)}</b></div>
    <div class="summary-total"><span>Total</span><b>${peso(commerceState.cart.total)}</b></div>
    <div class="summary-line"><span>Billing period</span><b>${commerceState.billing === "annual" ? "Annual" : "Monthly"}</b></div>
    <div class="summary-line"><span>Renewal estimate</span><b>${renewal.toLocaleDateString("en-PH", { year: "numeric", month: "short", day: "numeric" })}</b></div>
  `;
  summary.querySelectorAll(".add-on-picker input").forEach((input) => {
    input.onchange = async () => {
      input.checked ? commerceState.addOns.add(input.value) : commerceState.addOns.delete(input.value);
      await syncCart();
    };
  });
  validateCheckout();
}

function validateCheckout() {
  const form = qs("#checkoutForm");
  const ready = commerceState.cart?.items?.length && form.checkValidity();
  qs("#checkoutBtn").disabled = !ready || commerceState.processing;
}

async function submitCheckout() {
  const form = qs("#checkoutForm");
  if (!form.reportValidity() || !commerceState.cart) return;
  commerceState.processing = true;
  qs("#checkoutBtn").textContent = "Preparing checkout...";
  validateCheckout();
  const data = Object.fromEntries(new FormData(form));
  try {
    const result = await api("/api/checkout", {
      method: "POST",
      body: {
        cartId: commerceState.cart.id,
        requestedProvider: commerceState.selectedProvider,
        paymentMethod: data.payment_provider || commerceState.selectedProvider,
        customer: {
          full_name: data.full_name,
          company_name: data.company_name || null,
          business_name: data.business_name || null,
          email: data.email,
          mobile_number: data.mobile_number,
          billing_address: data.billing_address,
          city: data.city,
          province: data.province,
          postal_code: data.postal_code,
          country: data.country,
          tax_id: data.tax_id || null,
          company_registration_number: data.company_registration_number || null,
          business_website: data.business_website || null,
          facebook_page_url: data.facebook_page_url || null,
          industry: data.industry || null,
          estimated_monthly_inquiries: data.estimated_monthly_inquiries || null,
          main_products_or_services: data.main_products_or_services || null,
          preferred_onboarding_date: data.preferred_onboarding_date || null
        },
        agreements: {
          terms: Boolean(data.terms),
          privacy: Boolean(data.privacy),
          renewal: Boolean(data.renewal),
          correct: Boolean(data.correct)
        }
      }
    });
    localStorage.setItem("aistaff_last_order", result.order.order_number);
    location.href = result.checkout.status === "paid"
      ? `/checkout/success/?order=${encodeURIComponent(result.order.order_number)}`
      : `/checkout/pending/?order=${encodeURIComponent(result.order.order_number)}`;
  } catch (error) {
    location.href = `/checkout/failure/?reason=${encodeURIComponent(error.message)}`;
  }
}

async function init() {
  commerceState.pricing = await api("/api/pricing");
  renderPricing();
  renderPaymentMethods();
  qs("[name='country']").addEventListener("input", (event) => renderPaymentMethods(event.target.value));
  document.querySelectorAll("[data-billing]").forEach((button) => {
    button.onclick = async () => {
      commerceState.billing = button.dataset.billing;
      document.querySelectorAll("[data-billing]").forEach((item) => item.classList.toggle("active", item === button));
      renderPricing();
      if (commerceState.selectedPlan) await syncCart();
    };
  });
  qs("#checkoutForm").addEventListener("input", validateCheckout);
  qs("#checkoutBtn").onclick = submitCheckout;
  qs("#clearCartBtn").onclick = () => {
    if (commerceState.cart && !confirm("Remove the selected package and add-ons from this cart?")) return;
    commerceState.selectedPlan = null;
    commerceState.addOns.clear();
    commerceState.cart = null;
    renderSummary();
  };
  qs("#enterpriseForm").onsubmit = (event) => {
    event.preventDefault();
    event.currentTarget.querySelector(".success-message").hidden = false;
    event.currentTarget.reset();
  };
  qs("#mobileSummaryBtn").onclick = () => qs(".order-summary").scrollIntoView({ behavior: "smooth" });
  window.addEventListener("beforeunload", (event) => {
    if (!commerceState.cart || commerceState.processing) return;
    event.preventDefault();
    event.returnValue = "";
  });
  renderSummary();
}

init().catch((error) => {
  qs("#pricingCards").innerHTML = `<p class="error-message">${safe(error.message)}</p>`;
});
