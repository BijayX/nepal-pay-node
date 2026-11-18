/**
 * Stable, machine-readable error codes. Match on `error.code` (or use `instanceof`)
 * instead of parsing messages — messages may change between releases.
 */
export const ErrorCode = {
  CONFIGURATION_ERROR: 'CONFIGURATION_ERROR',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  AUTHENTICATION_FAILED: 'AUTHENTICATION_FAILED',
  GATEWAY_ERROR: 'GATEWAY_ERROR',
  NETWORK_ERROR: 'NETWORK_ERROR',
  TIMEOUT: 'TIMEOUT',
  INVALID_CALLBACK: 'INVALID_CALLBACK',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  AMOUNT_MISMATCH: 'AMOUNT_MISMATCH',
  REFERENCE_MISMATCH: 'REFERENCE_MISMATCH',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];

export interface NepalPayErrorOptions {
  gateway?: string | null;
  details?: Record<string, unknown>;
  cause?: unknown;
}

/**
 * Base class for every error thrown by this library.
 *
 * Secrets are never placed in `message` or `details`, so errors are safe to log.
 */
export abstract class NepalPayError extends Error {
  abstract readonly code: ErrorCode;
  readonly gateway: string | null;
  readonly details: Readonly<Record<string, unknown>>;

  constructor(message: string, options: NepalPayErrorOptions = {}) {
    super(message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = new.target.name;
    this.gateway = options.gateway ?? null;
    this.details = Object.freeze({ ...(options.details ?? {}) });
  }

  /** Plain-object form for structured logging / API error responses. */
  toJSON(): Record<string, unknown> {
    return {
      name: this.name,
      code: this.code,
      message: this.message,
      gateway: this.gateway,
      details: this.details,
    };
  }
}
