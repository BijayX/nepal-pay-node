# nepal-pay — shared specification

Both packages (`@bijayx/nepal-pay` for Node.js, `bijayx/nepal-pay-laravel` for Laravel) implement
this contract. Names below are given in camelCase (Node); PHP uses the same names
(camelCase methods/properties, `snake_case` config keys).

Sources (checked 2026-11-18):

- Khalti KPG-2 web checkout: https://docs.khalti.com/khalti-epayment/
- eSewa ePay v2: https://developer.esewa.com.np/pages/Epay (raw markdown: /api/pages/Epay)

---

## 1. Money

- **All amounts in the public API are integers in paisa** (Rs 1 = 100 paisa). Never floats.
- Reject non-integer, non-finite, zero or negative amounts with a validation error.
- Khalti uses paisa natively. Khalti minimum is **1000 paisa (Rs 10)** — enforce locally.
- eSewa uses rupees as strings. Conversion `paisaToRupeeString(p)`:
  - `p % 100 === 0` → integer string (`11000` → `"110"`)
  - otherwise → two decimals (`11050` → `"110.50"`)
- eSewa returns amounts as strings like `"1,000.0"` or numbers like `100.0`.
  `parseRupees(x)`: strip commas, parse decimal, `round(value * 100)` → paisa. Invalid → error.

## 2. Environments

`environment: "sandbox" | "production"` (default `"sandbox"`; never guess production).

|                 | sandbox                                                | production                                          |
| --------------- | ------------------------------------------------------ | --------------------------------------------------- |
| Khalti API base | `https://dev.khalti.com/api/v2/`                       | `https://khalti.com/api/v2/`                        |
| eSewa form      | `https://rc-epay.esewa.com.np/api/epay/main/v2/form`   | `https://epay.esewa.com.np/api/epay/main/v2/form`   |
| eSewa status    | `https://rc.esewa.com.np/api/epay/transaction/status/` | `https://esewa.com.np/api/epay/transaction/status/` |

Allow overriding base URLs in config (for proxies/tests).

## 3. Gateway configuration

Khalti: `secretKey` (required), `websiteUrl` (required, absolute URL), `environment`.
eSewa: `productCode` (required), `secretKey` (required), `environment`.
Sandbox convenience: eSewa sandbox may default `productCode = "EPAYTEST"`,
`secretKey = "8gBm/:&EnhH.1/q"` **only when environment is sandbox**. Production must be
explicit; missing values → configuration error at construction time (fail fast).

Shared HTTP options: `timeoutMs` (default 15000), `retries` (default 2, only for idempotent
read calls — lookup/status — on network errors, timeouts and 5xx; exponential backoff
200ms·2^n). `initiate` is **never** retried automatically.

## 4. Unified API (every gateway implements this)

```
interface PaymentGateway {
  readonly name: string;                       // "khalti" | "esewa"
  initiate(input: InitiatePaymentInput): Promise<InitiatedPayment>;
  verify(input: VerifyPaymentInput): Promise<PaymentResult>;
  lookup(input: LookupPaymentInput): Promise<PaymentResult>;
}
```

### InitiatePaymentInput

| field       | type                                                       | notes                                                                                                              |
| ----------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| amount      | int paisa                                                  | total payable                                                                                                      |
| orderId     | string                                                     | unique **per payment attempt**; 1–64 chars; `^[A-Za-z0-9-]+$` (eSewa rule; applied to both for consistency)        |
| orderName   | string                                                     | required, non-blank, ≤ 255                                                                                         |
| returnUrl   | string                                                     | absolute http(s) URL                                                                                               |
| failureUrl? | string                                                     | eSewa only; defaults to returnUrl                                                                                  |
| customer?   | `{ name?, email?, phone? }`                                | Khalti `customer_info`; ignored by eSewa                                                                           |
| breakdown?  | `{ tax?, serviceCharge?, deliveryCharge? }` paisa ints ≥ 0 | must be < amount                                                                                                   |
| metadata?   | `Record<string,string>`                                    | Khalti → `merchant_<key>`; eSewa → `properties[<key>]`, max 3 keys (validation error if more). keys `^[a-z0-9_]+$` |

### InitiatedPayment

```
{ gateway, reference, orderId, amount, redirect: RedirectInstruction, expiresAt?: Date|null, raw }
```

- Khalti `reference` = `pidx`; eSewa `reference` = `transaction_uuid` (= orderId).
- `RedirectInstruction` = `{ method: "GET", url }` (Khalti) or `{ method: "POST", url, fields }` (eSewa, all string values).
- **Store `reference` + `amount` against the order before redirecting** (needed for verify).

### Khalti initiate mapping

POST `{base}epayment/initiate/`, headers `Authorization: Key <secretKey>`, `Content-Type: application/json`.
Body: `return_url, website_url, amount, purchase_order_id, purchase_order_name`, optional
`customer_info`, `amount_breakdown` (when breakdown given: `[{label:"Amount",amount: base},{label:"Tax",...},{label:"Service charge",...},{label:"Delivery charge",...}]`, omit zero rows except Amount; sums to amount), and `merchant_<key>` fields.
Response `{ pidx, payment_url, expires_at, expires_in }` → GET redirect to `payment_url`.

### eSewa initiate mapping

No HTTP call. Build form fields:

- `tax_amount`, `product_service_charge`, `product_delivery_charge` from breakdown (default `"0"`),
- `amount` = total − tax − service − delivery (must be > 0),
- `total_amount` = total, all via `paisaToRupeeString`,
- `transaction_uuid` = orderId, `product_code`, `success_url` = returnUrl, `failure_url` = failureUrl ?? returnUrl,
- `signed_field_names` = `"total_amount,transaction_uuid,product_code"`,
- `signature` = HMAC-SHA256(secretKey, `"total_amount=<t>,transaction_uuid=<u>,product_code=<c>"`) → base64,
- metadata → `properties[<key>]`.
  `expiresAt` = null.

### VerifyPaymentInput

```
{ callback: Record<string, string | string[] | undefined>,   // raw query params of the return request
  expected?: { amount: number; reference?: string } }       // from your DB — strongly recommended
```

Rules (both gateways):

1. **Never trust callback values for the final decision.** Always confirm with the gateway's
   server (Khalti lookup / eSewa status API).
2. If `expected.reference` is given and differs from the callback/looked-up reference →
   `PaymentMismatchError` (code `REFERENCE_MISMATCH`).
3. If the confirmed status is `completed` and `expected.amount` is given and differs from the
   confirmed amount → `PaymentMismatchError` (code `AMOUNT_MISMATCH`). Never return a
   completed result with a mismatched amount.
4. Non-completed statuses are **returned**, not thrown (caller checks `result.isPaid`).

Khalti verify: reference = `callback.pidx` ?? `expected.reference`; missing → `InvalidCallbackError`.
Then `lookup`.

eSewa verify:

- If `callback.data` present: base64-decode → JSON (failure → `InvalidCallbackError`).
  Verify signature: message = `signed_field_names.split(",").map(n => n + "=" + decoded[n]).join(",")`
  using the raw string values exactly as received; constant-time compare with `decoded.signature`;
  mismatch → `InvalidSignatureError`. Check `decoded.product_code === config.productCode`
  (else `InvalidSignatureError`).
  A payload without `signature`/`signed_field_names` (or missing a signed field) → `InvalidSignatureError`.
  reference = `decoded.transaction_uuid`; amount for the status query = `parseRupees(decoded.total_amount)`
  (signed by eSewa = what was charged). If it differs from `expected.amount`, verify throws `AMOUNT_MISMATCH`
  (querying with the expected amount would only return NOT_FOUND and hide the fraud signal).
- If `data` absent (e.g. failure_url): requires `expected.reference` and `expected.amount`, else `InvalidCallbackError`.
- Then `lookup({ reference, amount })`.

### LookupPaymentInput

`{ reference: string; amount?: number }` — eSewa requires `amount` (validation error if missing).

Khalti lookup: POST `{base}epayment/lookup/` `{ pidx }`. Response `{ pidx, total_amount, status, transaction_id, fee, refunded }`.
**Khalti returns HTTP 400 with a normal lookup body for `Expired` and `User canceled`** — if the
body has a string `status` and `pidx`, parse it as a result regardless of HTTP code.
`{"detail":"Not found."}` → status `not_found`.

eSewa lookup: GET status URL `?product_code=&total_amount=<rupee string>&transaction_uuid=`.
Response `{ product_code, transaction_uuid, total_amount, status, ref_id }`.
`{ "code": 0, "error_message": "..." }` → `GatewayError` (retryable).

### PaymentResult

```
{ gateway, status: PaymentStatus, isPaid: boolean /* status === "completed" */,
  reference, transactionId: string|null, amount: int paisa, fee: int|null, raw }
```

### PaymentStatus mapping

| unified            | Khalti                  | eSewa          |
| ------------------ | ----------------------- | -------------- |
| completed          | Completed               | COMPLETE       |
| pending            | Pending                 | PENDING        |
| initiated          | Initiated               | —              |
| refunded           | Refunded                | FULL_REFUND    |
| partially_refunded | Partially Refunded      | PARTIAL_REFUND |
| expired            | Expired                 | —              |
| canceled           | User canceled, Canceled | CANCELED       |
| failed             | Failed                  | —              |
| ambiguous          | —                       | AMBIGUOUS      |
| not_found          | "Not found."            | NOT_FOUND      |
| unknown            | anything else           | anything else  |

Mapping is case-insensitive and whitespace-tolerant.

## 5. Errors

Base `NepalPayError` (PHP: `NepalPayException`) with `code` (string constant), `gateway` (nullable),
`details` (object/array), `cause`/previous. Subclasses:

| class                 | code(s)                                 | when                                                                              |
| --------------------- | --------------------------------------- | --------------------------------------------------------------------------------- |
| ConfigurationError    | `CONFIGURATION_ERROR`                   | bad/missing config, unknown gateway                                               |
| ValidationError       | `VALIDATION_ERROR`                      | invalid input, or gateway 400 field errors; has `fields: Record<string,string[]>` |
| AuthenticationError   | `AUTHENTICATION_FAILED`                 | 401/403 (bad secret key)                                                          |
| GatewayError          | `GATEWAY_ERROR`                         | unexpected status, 5xx, malformed response; has `statusCode`, `responseBody`      |
| NetworkError          | `NETWORK_ERROR`, `TIMEOUT`              | transport failure / timeout                                                       |
| InvalidCallbackError  | `INVALID_CALLBACK`                      | callback missing/garbled                                                          |
| InvalidSignatureError | `INVALID_SIGNATURE`                     | eSewa signature/product mismatch                                                  |
| PaymentMismatchError  | `AMOUNT_MISMATCH`, `REFERENCE_MISMATCH` | fraud signals; has `expected`, `actual`                                           |

Khalti error parsing: `{ "<field>": ["msg"], "error_key": "validation_error" }` → ValidationError
with `fields`; `{ "detail": "...", "status_code": 401 }` → AuthenticationError.
eSewa form errors look like `{"code":"ES104","message":"Invalid payload signature."}` (HTTP 400) — surfaced to users on eSewa's page, not to us.

**Never include secret keys in error messages, details or logs.**

## 6. Security checklist (README must document)

- Verify server-side; never mark paid from the return URL alone.
- Persist `reference` and `amount` at initiate; pass them as `expected` on verify.
- Make "mark order paid" idempotent (DB unique constraint / row lock); callbacks can repeat.
- Use a fresh `orderId` per attempt (both gateways require uniqueness).
- Secrets only from env; never ship them to the browser.

## 7. Test credentials (README)

- Khalti sandbox: merchant signup https://test-admin.khalti.com/#/join/merchant (OTP 987654);
  payer IDs 9800000000–9800000005, MPIN 1111, OTP 987654.
- eSewa UAT: product code `EPAYTEST`, secret `8gBm/:&EnhH.1/q`; payer IDs 9711111111 / 9711111112 / 9711111113,
  password `Nepal@123`, MPIN `1122`, token `123456`.

Note: the signature examples printed in eSewa's docs do not match their own key; our algorithm was
verified against the live UAT endpoint (valid signature → 302 to checkout; tampered → 400 ES104).
Use `fixtures/esewa.json` vectors (computed + live-verified), not the doc's example signatures.
