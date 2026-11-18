import { ErrorCode, NepalPayError, type NepalPayErrorOptions } from './nepal-pay-error.js';

export { ErrorCode, NepalPayError, type NepalPayErrorOptions } from './nepal-pay-error.js';

/** Missing or invalid configuration, or an unknown gateway name. Thrown at construction time. */
export class ConfigurationError extends NepalPayError {
  readonly code = ErrorCode.CONFIGURATION_ERROR;
}

/** Invalid input — either caught locally before any request, or rejected by the gateway (HTTP 400). */
export class ValidationError extends NepalPayError {
  readonly code = ErrorCode.VALIDATION_ERROR;
  /** Field name → messages, e.g. `{ amount: ['must be an integer number of paisa'] }`. */
  readonly fields: Readonly<Record<string, readonly string[]>>;

  constructor(
    message: string,
    fields: Record<string, string[]> = {},
    options?: NepalPayErrorOptions,
  ) {
    super(message, { ...options, details: { ...options?.details, fields } });
    this.fields = Object.freeze({ ...fields });
  }

  /** Build from a field map; the message summarises the first problem. */
  static fromFields(
    fields: Record<string, string[]>,
    options?: NepalPayErrorOptions,
  ): ValidationError {
    const [field, messages] = Object.entries(fields)[0] ?? ['input', ['is invalid']];
    return new ValidationError(`Invalid ${field}: ${messages[0] ?? 'is invalid'}`, fields, options);
  }
}

/** The gateway rejected the credentials (HTTP 401/403). Usually a wrong or wrong-environment secret key. */
export class AuthenticationError extends NepalPayError {
  readonly code = ErrorCode.AUTHENTICATION_FAILED;
}

export interface GatewayErrorOptions extends NepalPayErrorOptions {
  statusCode?: number | null;
  responseBody?: unknown;
  /** Override the default (`statusCode` is null or ≥ 500). */
  retryable?: boolean;
}

/** The gateway answered with something unexpected: 5xx, unknown 4xx, or a malformed body. */
export class GatewayError extends NepalPayError {
  readonly code = ErrorCode.GATEWAY_ERROR;
  readonly statusCode: number | null;
  readonly responseBody: unknown;
  /** True when trying again later may succeed (5xx, or the gateway says it is unavailable). */
  readonly retryable: boolean;

  constructor(message: string, options: GatewayErrorOptions = {}) {
    super(message, {
      ...options,
      details: { ...options.details, statusCode: options.statusCode ?? null },
    });
    this.statusCode = options.statusCode ?? null;
    this.responseBody = options.responseBody;
    this.retryable = options.retryable ?? (this.statusCode === null || this.statusCode >= 500);
  }
}

/** The request never got a response: DNS, connection reset, TLS failure or timeout. */
export class NetworkError extends NepalPayError {
  readonly code: typeof ErrorCode.NETWORK_ERROR | typeof ErrorCode.TIMEOUT;

  constructor(message: string, options: NepalPayErrorOptions & { timeout?: boolean } = {}) {
    super(message, options);
    this.code = options.timeout === true ? ErrorCode.TIMEOUT : ErrorCode.NETWORK_ERROR;
  }
}

/** The return-URL callback is missing required parameters or cannot be decoded. */
export class InvalidCallbackError extends NepalPayError {
  readonly code = ErrorCode.INVALID_CALLBACK;
}

/** The callback's signature does not match — treat as tampering. */
export class InvalidSignatureError extends NepalPayError {
  readonly code = ErrorCode.INVALID_SIGNATURE;
}

/**
 * The gateway confirmed a payment, but not the one you expected (different amount or reference).
 * Treat as a fraud signal: do not fulfil the order.
 */
export class PaymentMismatchError extends NepalPayError {
  readonly code: typeof ErrorCode.AMOUNT_MISMATCH | typeof ErrorCode.REFERENCE_MISMATCH;
  readonly expected: string | number;
  readonly actual: string | number;

  constructor(
    code: typeof ErrorCode.AMOUNT_MISMATCH | typeof ErrorCode.REFERENCE_MISMATCH,
    expected: string | number,
    actual: string | number,
    options?: NepalPayErrorOptions,
  ) {
    const what = code === ErrorCode.AMOUNT_MISMATCH ? 'amount' : 'reference';
    super(`Payment ${what} mismatch: expected ${String(expected)}, got ${String(actual)}`, {
      ...options,
      details: { ...options?.details, expected, actual },
    });
    this.code = code;
    this.expected = expected;
    this.actual = actual;
  }
}

/** Type guard for any error raised by this library. */
export function isNepalPayError(error: unknown): error is NepalPayError {
  return error instanceof NepalPayError;
}
