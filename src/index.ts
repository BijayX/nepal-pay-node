// Entry point: everything exported here is public API and follows semver.

export {
  NepalPay,
  createNepalPayFromEnv,
  type NepalPayConfig,
  type GatewayFactory,
} from './nepal-pay.js';

export { KhaltiGateway } from './gateways/khalti/khalti.gateway.js';
export { KHALTI_MIN_AMOUNT, type KhaltiOptions } from './gateways/khalti/khalti.config.js';
export { EsewaGateway } from './gateways/esewa/esewa.gateway.js';
export { ESEWA_SANDBOX_CREDENTIALS, type EsewaOptions } from './gateways/esewa/esewa.config.js';

export { BaseGateway, type BaseGatewayOptions } from './core/gateway.js';
export type { HttpOptions, FetchLike } from './core/http/http-client.js';
export { paisaToRupeeString, parseRupees } from './core/money.js';
export { renderRedirectPage, type RedirectPageOptions } from './helpers/redirect-page.js';

export {
  PaymentStatus,
  type AmountBreakdown,
  type BuiltInGateway,
  type CallbackParams,
  type Customer,
  type Environment,
  type ExpectedPayment,
  type InitiatePaymentInput,
  type InitiatedPayment,
  type Logger,
  type LookupPaymentInput,
  type Paisa,
  type PaymentGateway,
  type PaymentResult,
  type RedirectInstruction,
  type VerifyPaymentInput,
} from './core/types.js';

export {
  AuthenticationError,
  ConfigurationError,
  ErrorCode,
  GatewayError,
  InvalidCallbackError,
  InvalidSignatureError,
  NepalPayError,
  NetworkError,
  PaymentMismatchError,
  ValidationError,
  isNepalPayError,
  type GatewayErrorOptions,
  type NepalPayErrorOptions,
} from './core/errors/index.js';
