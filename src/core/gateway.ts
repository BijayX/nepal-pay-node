import { ConfigurationError, ErrorCode, PaymentMismatchError } from './errors/index.js';
import { HttpClient, type HttpOptions } from './http/http-client.js';
import {
  PaymentStatus,
  type CallbackParams,
  type Environment,
  type ExpectedPayment,
  type InitiatePaymentInput,
  type InitiatedPayment,
  type LookupPaymentInput,
  type PaymentGateway,
  type PaymentResult,
  type VerifyPaymentInput,
} from './types.js';

/** Options every gateway accepts in addition to its own credentials. */
export interface BaseGatewayOptions extends HttpOptions {
  /** Default `"sandbox"`. Production must be chosen explicitly. */
  environment?: Environment;
}

/**
 * Shared behaviour for gateways: environment handling, HTTP transport and the
 * fraud checks that every `verify()` must apply. Subclasses only translate
 * between the unified API and their gateway's wire format.
 */
export abstract class BaseGateway implements PaymentGateway {
  abstract readonly name: string;
  readonly environment: Environment;
  protected readonly http: HttpClient;

  protected constructor(gatewayName: string, options: BaseGatewayOptions) {
    // Typed as string: plain-JS callers can pass anything.
    const environment: string = options.environment ?? 'sandbox';
    if (environment !== 'sandbox' && environment !== 'production') {
      throw new ConfigurationError(`environment must be "sandbox" or "production"`, {
        gateway: gatewayName,
      });
    }
    this.environment = environment;
    this.http = new HttpClient(gatewayName, options);
  }

  abstract initiate(input: InitiatePaymentInput): Promise<InitiatedPayment>;
  abstract verify(input: VerifyPaymentInput): Promise<PaymentResult>;
  abstract lookup(input: LookupPaymentInput): Promise<PaymentResult>;

  protected get isSandbox(): boolean {
    return this.environment === 'sandbox';
  }

  /**
   * Applies the expectations stored at initiate time.
   * Reference is always checked; amount only matters once money has moved.
   */
  protected assertExpected(
    result: PaymentResult,
    expected: ExpectedPayment | undefined,
  ): PaymentResult {
    if (!expected) return result;

    if (expected.reference !== undefined && expected.reference !== result.reference) {
      throw new PaymentMismatchError(
        ErrorCode.REFERENCE_MISMATCH,
        expected.reference,
        result.reference,
        {
          gateway: this.name,
        },
      );
    }
    if (result.status === PaymentStatus.COMPLETED && expected.amount !== result.amount) {
      throw new PaymentMismatchError(ErrorCode.AMOUNT_MISMATCH, expected.amount, result.amount, {
        gateway: this.name,
      });
    }
    return result;
  }

  protected result(fields: Omit<PaymentResult, 'gateway' | 'isPaid'>): PaymentResult {
    return { gateway: this.name, isPaid: fields.status === PaymentStatus.COMPLETED, ...fields };
  }
}

/** First value of a query parameter (frameworks give `string | string[]`). Blank → undefined. */
export function callbackValue(params: CallbackParams, key: string): string | undefined {
  const value = params[key];
  const first = Array.isArray(value)
    ? (value[0] as string | undefined)
    : (value as string | undefined);
  return first === undefined || first.trim() === '' ? undefined : first;
}

/** Reads a required string option, failing fast with a helpful message. */
export function requireOption(
  value: unknown,
  name: string,
  gateway: string,
  envHint: string,
): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new ConfigurationError(`${gateway}: "${name}" is required (usually from ${envHint})`, {
      gateway,
    });
  }
  return value;
}
