# Changelog

All notable changes to this project are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project uses
[Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] - unreleased

### Added

- Khalti KPG-2 web checkout: initiate, lookup, verify.
- eSewa ePay v2: signed form initiate, callback signature verification, status API lookup.
- `NepalPay` gateway manager with `extend()` for custom gateways, and `createNepalPayFromEnv()`.
- Typed error hierarchy with stable error codes.
- Amount and reference mismatch checks on verify.
- HTTP layer with timeouts, retries for read-only calls, injectable `fetch` and a logger that redacts secrets.
- `renderRedirectPage()` helper for GET and POST gateway redirects.
