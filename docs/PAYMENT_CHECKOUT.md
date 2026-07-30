# AIStaff Payment Checkout

This project prepares AIChat Sales Agent checkout for Xendit, Stripe, and manual bank transfer.

Real payments are not activated unless these server-side credentials are configured:

- `XENDIT_SECRET_KEY`
- `XENDIT_PUBLIC_KEY`
- `XENDIT_WEBHOOK_TOKEN`
- `STRIPE_SECRET_KEY`
- `STRIPE_PUBLISHABLE_KEY`
- `STRIPE_WEBHOOK_SECRET`
- `PAYMENT_MODE`
- `APP_URL`
- `CHECKOUT_SUCCESS_URL`
- `CHECKOUT_CANCEL_URL`

When credentials are missing, checkout returns a clearly labeled test-mode payment session. Do not claim a method is live until the provider account, credentials, webhook endpoint, and reconciliation flow have been verified.

## Public Flow

1. `/pricing/`
2. Select Starter, Growth, or Scale
3. Add optional add-ons
4. Complete customer and business information
5. Select payment method
6. Submit checkout
7. Review `/checkout/pending/`, `/checkout/success/`, or `/checkout/failure/`

Enterprise requests stay outside the cart and use the consultation form.

## API Routes

- `GET /api/pricing`
- `POST /api/cart`
- `GET /api/cart/:id`
- `PATCH /api/cart/:id`
- `DELETE /api/cart/:id/items/:itemId`
- `POST /api/checkout`
- `POST /api/checkout/xendit`
- `POST /api/checkout/stripe`
- `POST /api/checkout/manual-bank-transfer`
- `GET /api/orders/:orderNumber`
- `GET /api/orders/:orderNumber/status`
- `POST /api/orders/:orderNumber/manual-payment-proof`
- `POST /api/subscriptions/:id/cancel`
- `POST /api/subscriptions/:id/reactivate`
- `POST /api/webhooks/xendit`
- `POST /api/webhooks/stripe`
- `GET /api/admin/payments/dashboard`

## Webhook Testing

Xendit test:

```bash
curl -X POST "$APP_URL/api/webhooks/xendit" \
  -H "Content-Type: application/json" \
  -H "x-callback-token: $XENDIT_WEBHOOK_TOKEN" \
  -d '{"id":"evt_test_001","status":"PAID","external_id":"xendit_test_AS-ORDER"}'
```

Stripe test:

```bash
curl -X POST "$APP_URL/api/webhooks/stripe" \
  -H "Content-Type: application/json" \
  -H "stripe-signature: test_signature" \
  -d '{"id":"evt_test_001","type":"checkout.session.completed","data":{"object":{"id":"stripe_test_AS-ORDER"}}}'
```

Before production, replace mock provider behavior with verified provider SDK/API calls, confirm provider signatures with official libraries, and run end-to-end sandbox checkout including duplicate webhook delivery.

## Activation Rule

Do not activate subscriptions at checkout submission time. Subscription status remains `pending` until a verified webhook or authorized manual payment approval confirms payment.

## Security Rules

- Never trust browser-submitted prices.
- Never store card information.
- Never expose secret keys to frontend code.
- Use server-side total calculation from the pricing catalog.
- Verify webhook signatures.
- Store webhook events with idempotency protection.
- Restrict finance actions to `admin`, `finance`, or `owner` roles.
