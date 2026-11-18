/** Built-in gateway names. Custom gateways may use any other string. */
export type BuiltInGateway = 'khalti' | 'esewa';

export type Environment = 'sandbox' | 'production';

/** Amount in paisa (Rs 1 = 100 paisa). Always a positive integer — never a float. */
export type Paisa = number;

export const PaymentStatus = {
  /** Money received. The only status that should fulfil an order. */
  COMPLETED: 'completed',
  PENDING: 'pending',
  INITIATED: 'initiated',
  REFUNDED: 'refunded',
  PARTIALLY_REFUNDED: 'partially_refunded',
  EXPIRED: 'expired',
  CANCELED: 'canceled',
  FAILED: 'failed',
  /** eSewa: payment is in a halted state — hold the order and re-check later. */
  AMBIGUOUS: 'ambiguous',
  NOT_FOUND: 'not_found',
  /** The gateway returned a status this library does not know; inspect `raw`. */
  UNKNOWN: 'unknown',
} as const;

export type PaymentStatus = (typeof PaymentStatus)[keyof typeof PaymentStatus];

export interface Customer {
  name?: string;
  email?: string;
  phone?: string;
}

/** Parts of `amount` (all in paisa). The remainder of `amount` is the base price. */
export interface AmountBreakdown {
  tax?: Paisa;
  serviceCharge?: Paisa;
  deliveryCharge?: Paisa;
}

export interface InitiatePaymentInput {
  /** Total payable, in paisa. */
  amount: Paisa;
  /** Your ID for this payment attempt. Must be unique per attempt; letters, digits and `-` only. */
  orderId: string;
  /** Shown to the customer on the gateway's page. */
  orderName: string;
  /** Absolute URL the customer is sent back to after paying. */
  returnUrl: string;
  /** eSewa only: where to send the customer on failure. Defaults to `returnUrl`. */
  failureUrl?: string;
  customer?: Customer;
  breakdown?: AmountBreakdown;
  /** Extra key/value data passed through to the gateway (eSewa allows at most 3 keys). */
  metadata?: Record<string, string>;
}

/** How to send the customer to the gateway. */
export type RedirectInstruction =
  | { method: 'GET'; url: string }
  | { method: 'POST'; url: string; fields: Readonly<Record<string, string>> };

export interface InitiatedPayment {
  gateway: string;
  /** Gateway-side reference (Khalti `pidx`, eSewa `transaction_uuid`). Persist it with your order. */
  reference: string;
  orderId: string;
  amount: Paisa;
  redirect: RedirectInstruction;
  expiresAt: Date | null;
  /** Raw gateway response, for debugging. */
  raw: unknown;
}

/** Values you stored at initiate time. Passing them turns on amount/reference fraud checks. */
export interface ExpectedPayment {
  amount: Paisa;
  reference?: string;
}

export type CallbackParams = Readonly<Record<string, string | readonly string[] | undefined>>;

export interface VerifyPaymentInput {
  /** Query parameters of the return-URL request, e.g. `req.query` or `Object.fromEntries(url.searchParams)`. */
  callback: CallbackParams;
  expected?: ExpectedPayment;
}

export interface LookupPaymentInput {
  reference: string;
  /** Required by eSewa (its status API is keyed on amount). */
  amount?: Paisa;
}

export interface PaymentResult {
  gateway: string;
  status: PaymentStatus;
  /** `true` only when `status === 'completed'`. */
  isPaid: boolean;
  reference: string;
  transactionId: string | null;
  amount: Paisa;
  /** Gateway fee in paisa, when the gateway reports it. */
  fee: Paisa | null;
  raw: unknown;
}

/** The contract every gateway implements. */
export interface PaymentGateway {
  readonly name: string;
  readonly environment: Environment;
  initiate(input: InitiatePaymentInput): Promise<InitiatedPayment>;
  verify(input: VerifyPaymentInput): Promise<PaymentResult>;
  lookup(input: LookupPaymentInput): Promise<PaymentResult>;
}

/** Minimal logger interface — compatible with `console`, pino and winston. */
export interface Logger {
  debug(message: string, context?: Record<string, unknown>): void;
  warn(message: string, context?: Record<string, unknown>): void;
}
