const { BUSINESS_IDENTITY } = require("./payments");

function baseEmail({ title, orderNumber, packageName, amount, paymentReference, body }) {
  return {
    subject: `${title} | ${BUSINESS_IDENTITY.brandName} ${orderNumber}`,
    text: [
      `${BUSINESS_IDENTITY.brandName}`,
      title,
      "",
      `Order number: ${orderNumber}`,
      `Package: ${packageName}`,
      `Amount: ${amount}`,
      `Payment reference: ${paymentReference || "Pending"}`,
      "",
      body,
      "",
      `Support: ${BUSINESS_IDENTITY.supportEmail}`,
      `Website: ${BUSINESS_IDENTITY.website}`
    ].join("\n")
  };
}

const emailTemplates = {
  orderCreated: (data) => baseEmail({ title: "Order Created", body: "Your order has been created. Please complete payment to begin onboarding.", ...data }),
  paymentPending: (data) => baseEmail({ title: "Payment Pending", body: "Your payment is pending. Follow the checkout instructions and wait for confirmation before activation.", ...data }),
  paymentSuccessful: (data) => baseEmail({ title: "Payment Successful", body: "We have received your payment. We will email your login/setup instructions, and you may message or email us with your preferred setup day and time if you want onboarding assistance.", ...data }),
  paymentFailed: (data) => baseEmail({ title: "Payment Failed", body: "Your payment was not completed. You may retry checkout or contact support.", ...data }),
  subscriptionActivated: (data) => baseEmail({ title: "Subscription Activated", body: "Your subscription is active. Onboarding proceeds according to the service fulfillment policy.", ...data }),
  renewalReminder: (data) => baseEmail({ title: "Subscription Renewal Reminder", body: "Your subscription is scheduled to renew on the next billing date unless cancelled before renewal.", ...data }),
  paymentPastDue: (data) => baseEmail({ title: "Payment Past Due", body: "Your payment is past due. Please update payment or contact support to avoid suspension.", ...data }),
  subscriptionCancelled: (data) => baseEmail({ title: "Subscription Cancelled", body: "Your subscription cancellation has been recorded. Future renewals are stopped according to the cancellation policy.", ...data }),
  refundProcessed: (data) => baseEmail({ title: "Refund Processed", body: "Your refund has been processed. Timing depends on the original payment provider.", ...data }),
  onboardingInstructions: (data) => baseEmail({ title: "Onboarding Instructions", body: "Please complete your onboarding form, provide Facebook Page or website access, and submit business knowledge so setup can begin. If you want us to help set up Closer for you, send your products/services, prices, promos, FAQs, files, payment or booking rules, policies, qualification questions, and handoff rules.", ...data })
};

module.exports = { emailTemplates };
