import { describe, expect, it } from 'vitest';
import { validateInitiateInput } from '../../src/core/validation/validate-initiate.js';
import { mapEsewaStatus } from '../../src/gateways/esewa/esewa.status.js';
import { mapKhaltiStatus } from '../../src/gateways/khalti/khalti.status.js';
import { ValidationError, type InitiatePaymentInput } from '../../src/index.js';

const valid: InitiatePaymentInput = {
  amount: 5000,
  orderId: 'ORD-1',
  orderName: 'Item',
  returnUrl: 'https://shop.test/return',
};

function fieldsOf(input: Partial<InitiatePaymentInput>, rules = {}): string[] {
  try {
    validateInitiateInput({ ...valid, ...input }, 'test', rules);
    return [];
  } catch (error) {
    if (!(error instanceof ValidationError)) throw error;
    return Object.keys(error.fields);
  }
}

describe('validateInitiateInput', () => {
  it('normalises a valid input', () => {
    expect(validateInitiateInput({ ...valid, orderName: '  Item  ' }, 'test')).toMatchObject({
      orderName: 'Item',
      baseAmount: 5000,
      failureUrl: valid.returnUrl,
      breakdown: { tax: 0, serviceCharge: 0, deliveryCharge: 0 },
    });
  });

  it.each<[string, Partial<InitiatePaymentInput>, Record<string, number>, string]>([
    ['below gateway minimum', { amount: 999 }, { minAmount: 1000 }, 'amount'],
    ['non-URL failureUrl', { failureUrl: 'ftp://x' }, {}, 'failureUrl'],
    ['float breakdown', { breakdown: { tax: 1.5 } }, {}, 'breakdown.tax'],
    ['long orderName', { orderName: 'x'.repeat(256) }, {}, 'orderName'],
    ['bad email', { customer: { email: 'not-an-email' } }, {}, 'customer.email'],
    ['bad metadata key', { metadata: { 'Bad Key': 'v' } }, {}, 'metadata.Bad Key'],
    ['orderId too long', { orderId: 'a'.repeat(65) }, {}, 'orderId'],
  ])('rejects %s', (_label, input, rules, field) => {
    expect(fieldsOf(input, rules)).toContain(field);
  });
});

describe('status mapping', () => {
  it.each([
    ['Completed', 'completed'],
    ['  user  canceled ', 'canceled'],
    ['Partially Refunded', 'partially_refunded'],
    ['Failed', 'failed'],
    ['Something New', 'unknown'],
  ])('Khalti "%s" → %s', (raw, expected) => {
    expect(mapKhaltiStatus(raw)).toBe(expected);
  });

  it.each([
    ['COMPLETE', 'completed'],
    ['full_refund', 'refunded'],
    ['PARTIAL-REFUND', 'partially_refunded'],
    ['AMBIGUOUS', 'ambiguous'],
    ['WHATEVER', 'unknown'],
  ])('eSewa "%s" → %s', (raw, expected) => {
    expect(mapEsewaStatus(raw)).toBe(expected);
  });
});
