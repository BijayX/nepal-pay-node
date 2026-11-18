# @bijayx/nepal-pay

Khalti and eSewa payments for Node.js, behind one typed API.

- **One interface** for both gateways: `initiate()`, `verify()`, `lookup()`.
- **Verification done right**: callbacks are never trusted; every payment is confirmed with the gateway's server, eSewa signatures are checked in constant time, and amount/reference mismatches throw.
- **Typed errors** with stable codes, safe to log (secret keys never appear in messages or logs).
- **Money in paisa** everywhere. No floats, no rupee/paisa mix-ups.
- **Zero runtime dependencies.** Node.js 20+, ESM and CommonJS, full TypeScript types.

```bash
npm install @bijayx/nepal-pay
```

## Contents

- [Quick start](#quick-start)
- [Configuration](#configuration)
- [The payment flow](#the-payment-flow)
- [API](#api)
- [Statuses](#statuses)
- [Errors](#errors)
- [Framework examples](#framework-examples)
- [Security checklist](#security-checklist)
- [Sandbox credentials](#sandbox-credentials)
- [Custom gateways](#custom-gateways)
- [Testing your app](#testing-your-app)

## Quick start

```ts
import { createNepalPayFromEnv, renderRedirectPage } from '@bijayx/nepal-pay';

const pay = createNepalPayFromEnv();

// 1. Start a payment
const payment = await pay.gateway('esewa').initiate({
  amount: 150_000, // Rs 1,500 in paisa
  orderId: 'ORD-1001-a1', // unique per payment attempt
  orderName: 'Charging session',
  returnUrl: 'https://example.com/payments/esewa/return',
});
await db.orders.update(order.id, { paymentReference: payment.reference });
res.type('html').send(renderRedirectPage(payment.redirect));

// 2. When the customer returns
const result = await pay.gateway('esewa').verify({
  callback: req.query,
  expected: { amount: order.amount, reference: order.paymentReference },
});

if (result.isPaid) {
  // fulfil the order (idempotently, see the security checklist)
}
```

## Configuration

### From environment variables

```bash
NEPAL_PAY_ENV=sandbox            # or production
NEPAL_PAY_DEFAULT=khalti         # optional: gateway used by pay.gateway()
KHALTI_SECRET_KEY=...            # "live secret key" from the Khalti merchant dashboard
KHALTI_WEBSITE_URL=https://example.com
ESEWA_PRODUCT_CODE=...           # optional in sandbox (defaults to EPAYTEST)
ESEWA_SECRET_KEY=...             # optional in sandbox (defaults to the public UAT key)
```

```ts
const pay = createNepalPayFromEnv(process.env, { timeoutMs: 10_000 });
```

A gateway without credentials is simply not configured. In sandbox mode eSewa is always available, using eSewa's public test credentials.

### Explicit

```ts
import { NepalPay } from '@bijayx/nepal-pay';

const pay = new NepalPay({
  environment: 'production',
  default: 'khalti',
  http: { timeoutMs: 15_000, retries: 2, logger: console },
  gateways: {
    khalti: { secretKey: process.env.KHALTI_SECRET_KEY!, websiteUrl: 'https://example.com' },
    esewa: {
      productCode: process.env.ESEWA_PRODUCT_CODE!,
      secretKey: process.env.ESEWA_SECRET_KEY!,
    },
  },
});
```

Or use a single gateway directly:

```ts
import { KhaltiGateway } from '@bijayx/nepal-pay';

const khalti = new KhaltiGateway({ secretKey, websiteUrl: 'https://example.com' });
```

| Option                                              | Default        | Notes                                                                                                                           |
| --------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `environment`                                       | `'sandbox'`    | Production must be chosen explicitly.                                                                                           |
| `timeoutMs`                                         | `15000`        | Per attempt.                                                                                                                    |
| `retries`                                           | `2`            | Only for `lookup`/`verify` (read-only calls), on network errors and 5xx, with exponential backoff. `initiate` is never retried. |
| `retryDelayMs`                                      | `200`          | Backoff base.                                                                                                                   |
| `fetch`                                             | global `fetch` | Inject for proxies, tracing or tests.                                                                                           |
| `logger`                                            | none           | Any object with `debug` and `warn` (`console`, pino, winston). Logs method, URL without query string, status and duration only. |
| `baseUrl` (Khalti), `formUrl` / `statusUrl` (eSewa) | official URLs  | Override for proxies or mocks.                                                                                                  |

Missing or invalid configuration throws `ConfigurationError` as soon as the gateway is created, not in the middle of a checkout.

## The payment flow

```
Your server                      Customer's browser                Gateway
───────────                      ──────────────────                ───────
initiate()  ─── redirect ──────▶  Khalti: GET payment_url    ───▶  pays
 store reference + amount         eSewa:  POST signed form
                                                                     │
verify()  ◀── returnUrl?pidx=… / ?data=… ◀───────────────────────────┘
 └─ lookup / status API (source of truth) ─────────────────────────▶
```

1. **Initiate** on your server. Compute the amount server-side, never from the browser.
2. **Persist** `payment.reference` and `payment.amount` on your order.
3. **Redirect.** Khalti uses a plain GET redirect; eSewa needs a form POST. `renderRedirectPage(payment.redirect)` handles both, or use `payment.redirect` to build your own.
4. **Verify** on your return URL with `expected` taken from your database. The library confirms the payment with the gateway's API; the callback's own status and amount are never trusted.
5. **Settle** the order once, using `result.isPaid`.

## API

### `initiate(input): Promise<InitiatedPayment>`

| Field         | Type                                        |                                                               |
| ------------- | ------------------------------------------- | ------------------------------------------------------------- |
| `amount`      | `number`                                    | Paisa, positive integer. Khalti minimum is 1000 (Rs 10).      |
| `orderId`     | `string`                                    | Unique per attempt. 1–64 characters, letters, digits and `-`. |
| `orderName`   | `string`                                    | Shown on the gateway's page.                                  |
| `returnUrl`   | `string`                                    | Absolute URL.                                                 |
| `failureUrl?` | `string`                                    | eSewa only. Defaults to `returnUrl`.                          |
| `customer?`   | `{ name?, email?, phone? }`                 | Sent to Khalti as `customer_info`.                            |
| `breakdown?`  | `{ tax?, serviceCharge?, deliveryCharge? }` | Paisa. Parts of `amount`, not added to it.                    |
| `metadata?`   | `Record<string, string>`                    | Khalti `merchant_*` fields; eSewa `properties[*]` (max 3).    |

Returns `{ gateway, reference, orderId, amount, redirect, expiresAt, raw }`, where `redirect` is either `{ method: 'GET', url }` or `{ method: 'POST', url, fields }`.

Input is validated before any request, and every invalid field is reported at once in `ValidationError.fields`.

### `verify({ callback, expected? }): Promise<PaymentResult>`

- `callback`: the return request's query parameters (`req.query`, `Object.fromEntries(url.searchParams)`, ...).
- `expected`: `{ amount, reference? }` from your database. **Always pass it**: it turns on the amount and reference checks.

Khalti: reads `pidx` and confirms it through the lookup API.
eSewa: decodes `data`, verifies its HMAC signature and product code, then confirms through the status API. Without `data` (for example on `failureUrl`), it falls back to `expected`.

Non-completed payments are **returned**, not thrown. Fraud signals (bad signature, amount or reference mismatch) are **thrown**.

### `lookup({ reference, amount? }): Promise<PaymentResult>`

Re-checks a payment at any time, for example from a job that reconciles `pending` orders. eSewa requires `amount`.

### `PaymentResult`

```ts
{
  gateway: 'khalti' | 'esewa' | string;
  status: PaymentStatus;
  isPaid: boolean; // status === 'completed'
  reference: string; // pidx / transaction_uuid
  transactionId: string | null;
  amount: number; // paisa, as confirmed by the gateway
  fee: number | null; // paisa (Khalti only)
  raw: unknown; // gateway response, for debugging
}
```

## Statuses

| `status`             | Khalti             | eSewa          | What to do                                   |
| -------------------- | ------------------ | -------------- | -------------------------------------------- |
| `completed`          | Completed          | COMPLETE       | Fulfil the order.                            |
| `pending`            | Pending            | PENDING        | Hold; check again later with `lookup()`.     |
| `initiated`          | Initiated          |                | Customer has not paid yet.                   |
| `ambiguous`          |                    | AMBIGUOUS      | Hold; check again later.                     |
| `refunded`           | Refunded           | FULL_REFUND    | Do not fulfil.                               |
| `partially_refunded` | Partially Refunded | PARTIAL_REFUND | Review manually.                             |
| `expired`            | Expired            |                | Let the customer retry with a new `orderId`. |
| `canceled`           | User canceled      | CANCELED       | Let the customer retry.                      |
| `failed`             | Failed             |                | Let the customer retry.                      |
| `not_found`          | not found          | NOT_FOUND      | Unknown or abandoned payment.                |
| `unknown`            | anything else      | anything else  | Inspect `raw`; hold the order.               |

## Errors

Every error extends `NepalPayError` and has a stable `code`, a `gateway` and safe-to-log `details`. Use `instanceof` or `error.code`.

| Class                   | `code`                                  | Meaning                                                                         | Typical response               |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------------------- | ------------------------------ |
| `ConfigurationError`    | `CONFIGURATION_ERROR`                   | Missing or invalid config, unknown gateway.                                     | Fix deployment.                |
| `ValidationError`       | `VALIDATION_ERROR`                      | Invalid input, or the gateway rejected fields. See `.fields`.                   | 422                            |
| `AuthenticationError`   | `AUTHENTICATION_FAILED`                 | Wrong secret key, or a sandbox key used in production (or the other way round). | Fix config, alert.             |
| `GatewayError`          | `GATEWAY_ERROR`                         | Unexpected response or 5xx. `.statusCode`, `.responseBody`, `.retryable`.       | 503, retry later.              |
| `NetworkError`          | `NETWORK_ERROR`, `TIMEOUT`              | No response.                                                                    | 503, retry later.              |
| `InvalidCallbackError`  | `INVALID_CALLBACK`                      | Return URL is missing parameters or they cannot be decoded.                     | 400                            |
| `InvalidSignatureError` | `INVALID_SIGNATURE`                     | eSewa data was altered or is for another merchant.                              | 400, **alert**.                |
| `PaymentMismatchError`  | `AMOUNT_MISMATCH`, `REFERENCE_MISMATCH` | Gateway confirmed a different payment than expected. `.expected`, `.actual`.    | 400, **do not fulfil, alert**. |

```ts
import { ErrorCode, NepalPayError } from '@bijayx/nepal-pay';

try {
  await gateway.verify({ callback, expected });
} catch (error) {
  if (error instanceof NepalPayError && error.code === ErrorCode.AMOUNT_MISMATCH) {
    alertSecurityTeam(error.toJSON());
  }
  throw error;
}
```

## Framework examples

### Express

A complete app (checkout, return route, idempotent settlement, central error handler) is in [`examples/express`](examples/express).

### Next.js (App Router)

```ts
// app/payments/[gateway]/return/route.ts
import { NextResponse, type NextRequest } from 'next/server';
import { pay } from '@/lib/payments'; // createNepalPayFromEnv()

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ gateway: string }> },
) {
  const { gateway } = await params;
  const order = await getOrder(request.nextUrl.searchParams.get('order'));

  const result = await pay.gateway(gateway).verify({
    callback: Object.fromEntries(request.nextUrl.searchParams),
    expected: { amount: order.amount, reference: order.paymentReference },
  });

  if (result.isPaid) await markOrderPaidOnce(order.id);
  return NextResponse.redirect(new URL(`/orders/${order.id}`, request.url));
}
```

For eSewa checkout from a route handler, return the redirect page:

```ts
return new Response(renderRedirectPage(payment.redirect), {
  headers: { 'content-type': 'text/html' },
});
```

### NestJS

Register one `NepalPay` instance as a provider (`useFactory: () => createNepalPayFromEnv()`) and inject it into your payments service.

## Security checklist

- **Verify server-side.** Never mark an order paid because the return URL says `status=Completed`.
- **Store `reference` and `amount` at initiate time** and pass them as `expected` to `verify()`.
- **Settle idempotently.** Return URLs can be hit twice (refresh, back button, retries). Use a conditional update (`UPDATE orders SET status='paid' WHERE id=? AND status='pending'`) or a row lock.
- **Use a fresh `orderId` per attempt.** Both gateways reject reused IDs. `ORD-1001-a1`, `ORD-1001-a2`, and so on.
- **Compute amounts on the server.** Never accept a price from the browser.
- **Keep keys server-side** in environment variables. Never ship them to the browser or commit them.
- **Reconcile.** Run a job that calls `lookup()` for orders stuck in `pending`/`ambiguous`, because customers sometimes close the tab before returning.

## Sandbox credentials

**Khalti**

- Merchant sign-up: <https://test-admin.khalti.com/#/join/merchant> (OTP `987654`). Copy the "live secret key" from the sandbox dashboard into `KHALTI_SECRET_KEY`.
- Test payer: Khalti ID `9800000000` to `9800000005`, MPIN `1111`, OTP `987654`.

**eSewa**

- No sign-up needed. Product code `EPAYTEST` and the UAT secret key are built in for `environment: 'sandbox'`.
- Test payer: eSewa ID `9711111111`, `9711111112` or `9711111113`, password `Nepal@123`, MPIN `1122`, token `123456`.

For production, request merchant credentials from each gateway. Signing up is free; they charge a fee per transaction.

## Custom gateways

Implement `PaymentGateway` (or extend `BaseGateway` to get the shared HTTP client and fraud checks) and register it:

```ts
const pay = new NepalPay({
  gateways: { fonepay: { merchantCode: 'M1', secretKey: '...' } },
}).extend('fonepay', (options) => new FonepayGateway(options));
```

## Testing your app

Inject `fetch` to keep tests offline:

```ts
const fetch = async () =>
  new Response(
    JSON.stringify({ pidx: 'p1', total_amount: 150000, status: 'Completed', transaction_id: 't1' }),
  );

const khalti = new KhaltiGateway({ secretKey: 'test', websiteUrl: 'https://example.test', fetch });
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Report security issues privately as described in [SECURITY.md](SECURITY.md).

## License

MIT © Bijay Shrestha
