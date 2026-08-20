const out = document.querySelector("#statusContent");
const params = new URLSearchParams(location.search);
const orderNumber = params.get("order") || localStorage.getItem("aistaff_last_order") || "";
const pesoStatus = (value) => new Intl.NumberFormat("en-PH", { style: "currency", currency: "PHP" }).format(Number(value || 0));
const safeStatus = (value) => String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[char]));

async function loadOrder() {
  if (!orderNumber) {
    out.innerHTML = `<div class="status-card"><h1>Order Not Found</h1><p>No order number was provided.</p><a class="button button-primary" href="/pricing/">Return to Pricing</a></div>`;
    return;
  }
  const response = await fetch(`/api/orders/${encodeURIComponent(orderNumber)}`);
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Order could not be loaded");
  const order = payload.order;
  const payment = order.payments?.[0] || {};
  const subscription = order.subscriptions?.[0] || {};
  const invoice = order.invoices?.[0] || {};
  const plan = order.items?.find((item) => item.item_type === "pricing_plan") || order.items?.[0] || {};
  const paid = order.payment_status === "paid";
  const pending = location.pathname.includes("/pending") || order.payment_status === "pending" || order.payment_status === "processing";
  const failed = location.pathname.includes("/failure") || ["failed", "cancelled", "expired"].includes(order.payment_status);
  const manualTransfer = order.payment_provider === "manual_bank_transfer";
  const title = paid ? "Payment Successful" : failed ? "Payment Was Not Completed" : "Payment Pending";
  const nextBilling = paid ? new Date(order.paid_at || order.created_at) : null;
  if (nextBilling) {
    order.billing_frequency === "annual" ? nextBilling.setFullYear(nextBilling.getFullYear() + 1) : nextBilling.setMonth(nextBilling.getMonth() + 1);
  }
  out.innerHTML = `
    <div class="status-card ${paid ? "paid" : failed ? "failed" : "pending"}">
      <p class="eyebrow">${safeStatus(order.payment_provider || "checkout")}</p>
      <h1>${title}</h1>
      <p>${paid ? "We have sent your payment confirmation and setup instructions to your email. You may reply with your preferred setup day and time, or send us your business details if you want us to help set up Closer for you." : pending ? (manualTransfer ? "Your proof is awaiting admin verification." : "Finish the QRPh payment on PayMongo. Once the payment is confirmed, this order updates automatically.") : safeStatus(params.get("reason") || "The payment was cancelled, expired, or not completed.")}</p>
      <div class="status-grid">
        <div><span>Order number</span><b>${safeStatus(order.order_number)}</b></div>
        <div><span>Package</span><b>${safeStatus(plan.item_name)}</b></div>
        <div><span>Amount</span><b>${pesoStatus(order.total)}</b></div>
        <div><span>Billing frequency</span><b>${safeStatus(order.billing_frequency)}</b></div>
        <div><span>Payment method</span><b>${safeStatus(payment.payment_method || order.payment_provider)}</b></div>
        <div><span>Payment reference</span><b>${safeStatus(payment.provider_payment_id || order.external_payment_id || "Pending")}</b></div>
        <div><span>Payment date</span><b>${order.paid_at ? new Date(order.paid_at).toLocaleString("en-PH") : "Pending"}</b></div>
        <div><span>Customer email</span><b>${safeStatus(order.customer.email)}</b></div>
        <div><span>Next billing date</span><b>${nextBilling ? nextBilling.toLocaleDateString("en-PH") : "After activation"}</b></div>
        <div><span>Onboarding status</span><b>${paid ? "Onboarding required" : "Awaiting payment confirmation"}</b></div>
        <div><span>Subscription status</span><b>${safeStatus(subscription.status || "pending")}</b></div>
        <div><span>Invoice</span><b>${safeStatus(invoice.invoice_number || "Pending")}</b></div>
      </div>
      ${pending && manualTransfer ? `<form id="proofForm" class="manual-proof-form">
        <h2>Manual bank transfer proof</h2>
        <input required name="transaction_reference" placeholder="Transaction reference" />
        <input required type="date" name="payment_date" />
        <input required name="sender_name" placeholder="Sender name" />
        <input required type="number" min="1" step="0.01" name="amount_sent" placeholder="Amount sent" />
        <input name="proof_file_url" placeholder="Payment proof file URL, if already uploaded" />
        <button class="button button-soft" type="submit">Submit payment proof</button>
        <p class="success-message" hidden>Payment proof submitted. Awaiting Payment Verification.</p>
      </form>` : ""}
      <div class="status-actions">
        <a class="button button-primary" href="/admin/onboarding">Continue to Onboarding</a>
        <a class="button button-soft" href="/checkout/pending/?order=${encodeURIComponent(order.order_number)}">View Order</a>
        <a class="button button-soft" href="${safeStatus(invoice.invoice_url || "#")}">Download Invoice</a>
        <a class="button button-soft" href="/admin/dashboard">Go to Dashboard</a>
        ${failed ? `<a class="button button-primary" href="/pricing/#cart">Retry QRPh payment</a><a class="button button-soft" href="/pricing/#packages">Choose another plan</a>` : ""}
        ${pending ? `<button id="refreshStatus" class="button button-soft" type="button">Refresh payment status</button><a class="button button-soft" href="/support/">Contact support</a>` : ""}
      </div>
    </div>
  `;
  const refresh = document.querySelector("#refreshStatus");
  if (refresh) refresh.onclick = () => location.reload();
  const proofForm = document.querySelector("#proofForm");
  if (proofForm) {
    proofForm.onsubmit = async (event) => {
      event.preventDefault();
      const data = Object.fromEntries(new FormData(proofForm));
      const proofResponse = await fetch(`/api/orders/${encodeURIComponent(order.order_number)}/manual-payment-proof`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...data, amount_sent: Number(data.amount_sent) })
      });
      if (!proofResponse.ok) throw new Error("Could not submit payment proof");
      proofForm.querySelector(".success-message").hidden = false;
      proofForm.reset();
    };
  }
}

loadOrder().catch((error) => {
  out.innerHTML = `<div class="status-card failed"><h1>Payment Was Not Completed</h1><p>${safeStatus(error.message)}</p><div class="status-actions"><a class="button button-primary" href="/pricing/">Retry payment</a><a class="button button-soft" href="/support/">Contact support</a></div></div>`;
});
