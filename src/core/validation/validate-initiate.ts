import { ValidationError } from '../errors/index.js';
import type { AmountBreakdown, Customer, InitiatePaymentInput, Paisa } from '../types.js';

export const ORDER_ID_PATTERN = /^[A-Za-z0-9-]{1,64}$/;
const METADATA_KEY_PATTERN = /^[a-z0-9_]{1,50}$/;

/** Validated, normalised initiate input. Breakdown parts are always present (0 when unused). */
export interface NormalizedInitiateInput {
  amount: Paisa;
  baseAmount: Paisa;
  orderId: string;
  orderName: string;
  returnUrl: string;
  failureUrl: string;
  customer: Customer | null;
  breakdown: Required<AmountBreakdown>;
  metadata: Record<string, string>;
}

/** Collects every problem instead of stopping at the first, so callers can fix input in one go. */
class FieldErrors {
  private readonly errors: Record<string, string[]> = {};

  add(field: string, message: string): void {
    (this.errors[field] ??= []).push(message);
  }

  throwIfAny(gateway: string): void {
    if (Object.keys(this.errors).length > 0) {
      throw ValidationError.fromFields(this.errors, { gateway });
    }
  }
}

export function isAbsoluteHttpUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

function isPaisa(value: unknown, allowZero: boolean): value is number {
  return (
    typeof value === 'number' && Number.isSafeInteger(value) && (allowZero ? value >= 0 : value > 0)
  );
}

function nonBlank(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

export function validateInitiateInput(
  input: InitiatePaymentInput,
  gateway: string,
  rules: { minAmount?: Paisa; maxMetadataKeys?: number } = {},
): NormalizedInitiateInput {
  const errors = new FieldErrors();

  if (!isPaisa(input.amount, false)) {
    errors.add('amount', 'must be a positive integer number of paisa');
  } else if (rules.minAmount !== undefined && input.amount < rules.minAmount) {
    errors.add('amount', `must be at least ${rules.minAmount} paisa`);
  }

  if (typeof input.orderId !== 'string' || !ORDER_ID_PATTERN.test(input.orderId)) {
    errors.add('orderId', 'must be 1-64 characters: letters, digits and hyphens only');
  }

  if (!nonBlank(input.orderName)) {
    errors.add('orderName', 'is required');
  } else if (input.orderName.length > 255) {
    errors.add('orderName', 'must be at most 255 characters');
  }

  if (!isAbsoluteHttpUrl(input.returnUrl))
    errors.add('returnUrl', 'must be an absolute http(s) URL');
  if (input.failureUrl !== undefined && !isAbsoluteHttpUrl(input.failureUrl)) {
    errors.add('failureUrl', 'must be an absolute http(s) URL');
  }

  const breakdown = {
    tax: input.breakdown?.tax ?? 0,
    serviceCharge: input.breakdown?.serviceCharge ?? 0,
    deliveryCharge: input.breakdown?.deliveryCharge ?? 0,
  };
  for (const [key, value] of Object.entries(breakdown)) {
    if (!isPaisa(value, true))
      errors.add(`breakdown.${key}`, 'must be a non-negative integer number of paisa');
  }
  const extras = breakdown.tax + breakdown.serviceCharge + breakdown.deliveryCharge;
  const baseAmount = (isPaisa(input.amount, false) ? input.amount : 0) - extras;
  if (isPaisa(input.amount, false) && extras > 0 && baseAmount <= 0) {
    errors.add('breakdown', 'tax + service + delivery charges must be less than amount');
  }

  const metadata = input.metadata ?? {};
  const metadataKeys = Object.keys(metadata);
  if (rules.maxMetadataKeys !== undefined && metadataKeys.length > rules.maxMetadataKeys) {
    errors.add('metadata', `${gateway} accepts at most ${rules.maxMetadataKeys} metadata keys`);
  }
  for (const key of metadataKeys) {
    if (!METADATA_KEY_PATTERN.test(key)) errors.add(`metadata.${key}`, 'key must match [a-z0-9_]');
    if (typeof metadata[key] !== 'string') errors.add(`metadata.${key}`, 'value must be a string');
  }

  if (input.customer?.email !== undefined && !/^[^\s@]+@[^\s@]+$/.test(input.customer.email)) {
    errors.add('customer.email', 'must be a valid email address');
  }

  errors.throwIfAny(gateway);

  return {
    amount: input.amount,
    baseAmount,
    orderId: input.orderId,
    orderName: input.orderName.trim(),
    returnUrl: input.returnUrl,
    failureUrl: input.failureUrl ?? input.returnUrl,
    customer: input.customer ?? null,
    breakdown,
    metadata: { ...metadata },
  };
}
