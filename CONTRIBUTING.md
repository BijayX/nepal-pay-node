# Contributing

Thanks for helping. Bug reports, gateway changes and new gateways are all welcome.

## Setup

```bash
npm install
npm run check   # typecheck + lint + format check + tests
npm run build
```

## Layout

```
src/
  index.ts                 public exports (semver applies to everything here)
  nepal-pay.ts             gateway manager + env factory
  core/                    gateway-independent building blocks
    types.ts               unified API types
    gateway.ts             BaseGateway: environment, HTTP, fraud checks
    errors/                error hierarchy and codes
    http/                  fetch wrapper (timeouts, retries, safe logging)
    validation/            input validation
    money.ts               paisa ↔ rupee conversion
    crypto/                HMAC + constant-time compare
  gateways/<name>/         one folder per gateway
    <name>.gateway.ts      maps the unified API to the gateway's wire format
    <name>.config.ts       URLs, constants, options type
    <name>.types.ts        raw request/response shapes (internal)
    <name>.status.ts       status mapping
  helpers/                 optional framework-agnostic helpers
tests/
  fixtures/                shared with the Laravel package — keep both in sync
  unit/  gateways/
```

## Rules

- Amounts are integer paisa in every public API.
- Never put secrets in error messages, `details` or logs. There is a test for this; extend it when adding a gateway.
- Never trust callback data for the payment decision; always confirm with the gateway's API.
- Tests must not touch the network. Use the injectable `fetch` (`tests/helpers/mock-fetch.ts`).
- Gateway behaviour must match `SPEC.md` in the `nepal-pay` workspace so the Node and Laravel packages stay consistent.

## Adding a gateway

1. Create `src/gateways/<name>/` following the existing ones and extend `BaseGateway`.
2. Register it in `NepalPay` and export it from `src/index.ts`.
3. Add fixtures and tests (happy path, every status, error mapping, signature/fraud cases).
4. Document it in the README and CHANGELOG.

## Commits and releases

Use clear, imperative commit messages. Releases follow semver; update `CHANGELOG.md` in the same PR.
