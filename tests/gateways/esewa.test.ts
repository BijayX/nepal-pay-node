import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/esewa.json' with { type: 'json' };
import type { PaymentMismatchError } from '../../src/index.js';
import {
  ConfigurationError,
  ErrorCode,
  EsewaGateway,
  GatewayError,
  InvalidCallbackError,
  InvalidSignatureError,
  ValidationError,
  type EsewaOptions,
} from '../../src/index.js';
import { mockFetch } from '../helpers/mock-fetch.js';

function esewa(fetch = mockFetch(), options: EsewaOptions = {}) {
  return new EsewaGateway({ fetch, retryDelayMs: 0, ...options });
}

const status = fixture.statusResponses;

describe('EsewaGateway configuration', () => {
  it('uses the public UAT credentials in sandbox', () => {
    expect(() => esewa()).not.toThrow();
  });

  it('requires real credentials in production', () => {
    expect(() => new EsewaGateway({ environment: 'production' })).toThrow(ConfigurationError);
    expect(
      () => new EsewaGateway({ environment: 'production', productCode: 'NP-1', secretKey: 'k' }),
    ).not.toThrow();
  });
});

describe('EsewaGateway.initiate', () => {
  it('builds the signed form exactly as eSewa expects (no HTTP call)', async () => {
    const fetch = mockFetch();
    const payment = await esewa(fetch).initiate(fixture.initiate.input);

    expect(fetch.calls).toHaveLength(0);
    expect(payment.redirect).toEqual({
      method: 'POST',
      url: 'https://rc-epay.esewa.com.np/api/epay/main/v2/form',
      fields: fixture.initiate.expectedFields,
    });
    expect(payment).toMatchObject({
      gateway: 'esewa',
      reference: 'ORD-1001-a1',
      amount: 110_000,
      expiresAt: null,
    });
  });

  it('formats paisa amounts with two decimals and passes metadata as properties', async () => {
    const payment = await esewa().initiate({
      amount: 11_050,
      orderId: 'ORD-2',
      orderName: 'Test',
      returnUrl: 'https://shop.test/r',
      metadata: { user_id: '42' },
    });
    if (payment.redirect.method !== 'POST') throw new Error('expected POST');
    expect(payment.redirect.fields).toMatchObject({
      amount: '110.50',
      total_amount: '110.50',
      failure_url: 'https://shop.test/r',
      'properties[user_id]': '42',
    });
  });

  it('uses the production form URL in production', async () => {
    const payment = await esewa(mockFetch(), {
      environment: 'production',
      productCode: 'NP-1',
      secretKey: 'k',
    }).initiate(fixture.initiate.input);
    expect(payment.redirect.url).toBe('https://epay.esewa.com.np/api/epay/main/v2/form');
  });

  it('rejects more than 3 metadata keys and breakdowns that exceed the amount', async () => {
    const base = { amount: 1000, orderId: 'A-1', orderName: 'x', returnUrl: 'https://shop.test' };
    await expect(
      esewa().initiate({ ...base, metadata: { a: '1', b: '2', c: '3', d: '4' } }),
    ).rejects.toBeInstanceOf(ValidationError);
    await expect(esewa().initiate({ ...base, breakdown: { tax: 1000 } })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('EsewaGateway.lookup', () => {
  it('queries the status API with rupee amounts', async () => {
    const fetch = mockFetch({ status: 200, body: status.COMPLETE });
    const result = await esewa(fetch).lookup({ reference: 'ORD-1001-a1', amount: 110_000 });
    expect(fetch.calls[0]?.url).toBe(
      'https://rc.esewa.com.np/api/epay/transaction/status/?product_code=EPAYTEST&total_amount=1100&transaction_uuid=ORD-1001-a1',
    );
    expect(result).toMatchObject({
      status: 'completed',
      isPaid: true,
      amount: 110_000,
      transactionId: '000AE01',
    });
  });

  it.each([
    ['PENDING', 'pending'],
    ['NOT_FOUND', 'not_found'],
    ['CANCELED', 'canceled'],
  ] as const)('maps %s', async (code, expected) => {
    const result = await esewa(mockFetch({ status: 200, body: status[code] })).lookup({
      reference: 'r',
      amount: 110_000,
    });
    expect(result.status).toBe(expected);
    expect(result.isPaid).toBe(false);
  });

  it('requires an amount', async () => {
    await expect(esewa().lookup({ reference: 'r' })).rejects.toBeInstanceOf(ValidationError);
  });

  it('treats "service unavailable" as a retryable GatewayError', async () => {
    const error = await esewa(mockFetch({ status: 200, body: status.serviceUnavailable }), {
      retries: 0,
    })
      .lookup({ reference: 'r', amount: 100 })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).retryable).toBe(true);
  });

  it('rejects unexpected bodies', async () => {
    await expect(
      esewa(mockFetch({ status: 200, body: '<html>maintenance</html>' })).lookup({
        reference: 'r',
        amount: 100,
      }),
    ).rejects.toBeInstanceOf(GatewayError);
  });
});

describe('EsewaGateway.verify', () => {
  it('checks the signature, then confirms via the status API', async () => {
    const fetch = mockFetch({ status: 200, body: status.COMPLETE });
    const result = await esewa(fetch).verify({
      callback: { data: fixture.callback.data },
      expected: { amount: 110_000, reference: 'ORD-1001-a1' },
    });
    expect(fetch.calls[0]?.url).toContain('total_amount=1100&transaction_uuid=ORD-1001-a1');
    expect(result.isPaid).toBe(true);
  });

  it('does not trust the callback status: PENDING from the API wins', async () => {
    const result = await esewa(mockFetch({ status: 200, body: status.PENDING })).verify({
      callback: { data: fixture.callback.data },
    });
    expect(result.status).toBe('pending');
  });

  it('rejects tampered data before any HTTP call', async () => {
    const fetch = mockFetch();
    await expect(
      esewa(fetch).verify({ callback: { data: fixture.tamperedCallback.data } }),
    ).rejects.toBeInstanceOf(InvalidSignatureError);
    expect(fetch.calls).toHaveLength(0);
  });

  it('rejects a genuine callback for a different merchant', async () => {
    // Same secret, different product code: the signature is valid but the payment is not ours.
    const gateway = esewa(mockFetch(), { productCode: 'NP-OTHER', secretKey: fixture.secretKey });
    await expect(
      gateway.verify({ callback: { data: fixture.callback.data } }),
    ).rejects.toBeInstanceOf(InvalidSignatureError);
  });

  it('throws AMOUNT_MISMATCH when the paid amount differs from the order', async () => {
    const error = await esewa(mockFetch({ status: 200, body: status.COMPLETE }))
      .verify({ callback: { data: fixture.callback.data }, expected: { amount: 500_000 } })
      .catch((e: unknown) => e);
    expect((error as PaymentMismatchError).code).toBe(ErrorCode.AMOUNT_MISMATCH);
  });

  it('throws REFERENCE_MISMATCH for a callback belonging to another order', async () => {
    const error = await esewa(mockFetch({ status: 200, body: status.COMPLETE }))
      .verify({
        callback: { data: fixture.callback.data },
        expected: { amount: 110_000, reference: 'ORD-9' },
      })
      .catch((e: unknown) => e);
    expect((error as PaymentMismatchError).code).toBe(ErrorCode.REFERENCE_MISMATCH);
  });

  it('without data (failure_url) it checks status using the expected values', async () => {
    const fetch = mockFetch({ status: 200, body: status.CANCELED });
    const result = await esewa(fetch).verify({
      callback: {},
      expected: { amount: 110_000, reference: 'ORD-1001-a1' },
    });
    expect(result.status).toBe('canceled');
  });

  it('without data or expected values it cannot verify', async () => {
    await expect(esewa().verify({ callback: {} })).rejects.toBeInstanceOf(InvalidCallbackError);
  });
});

describe('EsewaGateway.verify with an unsigned payload', () => {
  it('treats a missing signature as INVALID_SIGNATURE', async () => {
    const unsigned: Record<string, string | undefined> = { ...fixture.callback.decoded };
    delete unsigned.signature;
    const data = Buffer.from(JSON.stringify(unsigned)).toString('base64');
    await expect(esewa().verify({ callback: { data } })).rejects.toBeInstanceOf(
      InvalidSignatureError,
    );
  });
});
