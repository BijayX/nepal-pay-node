import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/khalti.json' with { type: 'json' };
import {
  AuthenticationError,
  ConfigurationError,
  ErrorCode,
  GatewayError,
  InvalidCallbackError,
  KhaltiGateway,
  NetworkError,
  PaymentMismatchError,
  ValidationError,
  type KhaltiOptions,
} from '../../src/index.js';
import { mockFetch } from '../helpers/mock-fetch.js';

const SECRET = 'test_secret_key_abc123';

function khalti(fetch: ReturnType<typeof mockFetch>, options: Partial<KhaltiOptions> = {}) {
  return new KhaltiGateway({
    secretKey: SECRET,
    websiteUrl: 'https://shop.test',
    fetch,
    retryDelayMs: 0,
    ...options,
  });
}

const lookup = fixture.lookup;

describe('KhaltiGateway configuration', () => {
  it('requires secretKey and websiteUrl', () => {
    expect(() => new KhaltiGateway({ secretKey: '', websiteUrl: 'https://shop.test' })).toThrow(
      ConfigurationError,
    );
    expect(() => new KhaltiGateway({ secretKey: SECRET, websiteUrl: 'shop.test' })).toThrow(
      ConfigurationError,
    );
  });

  it('rejects an unknown environment', () => {
    expect(
      () =>
        new KhaltiGateway({
          secretKey: SECRET,
          websiteUrl: 'https://shop.test',
          environment: 'live' as never,
        }),
    ).toThrow(ConfigurationError);
  });

  it('uses the sandbox by default and production when asked', async () => {
    const fetch = mockFetch(
      { status: 200, body: lookup.completed.body },
      { status: 200, body: lookup.completed.body },
    );
    await khalti(fetch).lookup({ reference: 'x' });
    await khalti(fetch, { environment: 'production' }).lookup({ reference: 'x' });
    expect(fetch.calls.map((c) => c.url)).toEqual([
      'https://dev.khalti.com/api/v2/epayment/lookup/',
      'https://khalti.com/api/v2/epayment/lookup/',
    ]);
  });
});

describe('KhaltiGateway.initiate', () => {
  it('sends the mapped request and returns a GET redirect', async () => {
    const fetch = mockFetch({ status: 200, body: fixture.initiateResponse });
    const payment = await khalti(fetch).initiate({
      ...fixture.initiateRequest,
      breakdown: { tax: 10_000 },
    });

    const [call] = fetch.calls;
    expect(call?.method).toBe('POST');
    expect(call?.url).toBe('https://dev.khalti.com/api/v2/epayment/initiate/');
    expect(call?.headers.Authorization).toBe(`Key ${SECRET}`);
    expect(call?.body).toEqual({
      return_url: 'https://shop.test/pay/return',
      website_url: 'https://shop.test',
      amount: 110_000,
      purchase_order_id: 'ORD-1001-a1',
      purchase_order_name: 'Charging session',
      customer_info: { name: 'Ram Bahadur', email: 'ram@example.com', phone: '9800000001' },
      amount_breakdown: [
        { label: 'Amount', amount: 100_000 },
        { label: 'Tax', amount: 10_000 },
      ],
      merchant_station: 'ktm-01',
    });

    expect(payment).toMatchObject({
      gateway: 'khalti',
      reference: fixture.initiateResponse.pidx,
      orderId: 'ORD-1001-a1',
      amount: 110_000,
      redirect: { method: 'GET', url: fixture.initiateResponse.payment_url },
    });
    expect(payment.expiresAt?.toISOString()).toBe('2026-11-18T10:41:16.471Z');
  });

  it('validates locally before calling Khalti, reporting every problem', async () => {
    const fetch = mockFetch();
    const error = await khalti(fetch)
      .initiate({ amount: 500, orderId: 'bad id!', orderName: ' ', returnUrl: '/relative' })
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ValidationError);
    expect(Object.keys((error as ValidationError).fields).sort()).toEqual([
      'amount',
      'orderId',
      'orderName',
      'returnUrl',
    ]);
    expect(fetch.calls).toHaveLength(0);
  });

  it('maps Khalti field errors to ValidationError', async () => {
    const fetch = mockFetch({ status: 400, body: fixture.validationError });
    const error = await khalti(fetch)
      .initiate(fixture.initiateRequest)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ValidationError);
    expect((error as ValidationError).fields.amount).toEqual([fixture.validationError.amount[0]]);
  });

  it('maps 401 to AuthenticationError without leaking the key', async () => {
    const fetch = mockFetch({ status: 401, body: fixture.invalidToken });
    const error = await khalti(fetch)
      .initiate(fixture.initiateRequest)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(AuthenticationError);
    expect(JSON.stringify(error)).not.toContain(SECRET);
    expect((error as Error).message).not.toContain(SECRET);
  });

  it('never retries initiate (it is not idempotent)', async () => {
    const fetch = mockFetch({ status: 502, body: 'Bad Gateway' });
    const error = await khalti(fetch)
      .initiate(fixture.initiateRequest)
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GatewayError);
    expect((error as GatewayError).retryable).toBe(true);
    expect(fetch.calls).toHaveLength(1);
  });

  it('rejects a 200 response without pidx/payment_url', async () => {
    const fetch = mockFetch({ status: 200, body: { pidx: 'x' } });
    await expect(khalti(fetch).initiate(fixture.initiateRequest)).rejects.toBeInstanceOf(
      GatewayError,
    );
  });
});

describe('KhaltiGateway.lookup', () => {
  it.each([
    ['completed', lookup.completed, 'completed', true],
    ['pending', lookup.pending, 'pending', false],
    ['initiated', lookup.initiated, 'initiated', false],
    ['refunded', lookup.refunded, 'refunded', false],
    ['expired (HTTP 400)', lookup.expired, 'expired', false],
    ['user canceled (HTTP 400)', lookup.userCanceled, 'canceled', false],
  ])('%s', async (_label, reply, status, isPaid) => {
    const result = await khalti(mockFetch({ status: reply.httpStatus, body: reply.body })).lookup({
      reference: 'x',
    });
    expect(result).toMatchObject({ gateway: 'khalti', status, isPaid, amount: 110_000 });
  });

  it('returns not_found for an unknown pidx', async () => {
    const reply = lookup.notFound;
    const result = await khalti(mockFetch({ status: reply.httpStatus, body: reply.body })).lookup({
      reference: 'nope',
    });
    expect(result).toMatchObject({ status: 'not_found', reference: 'nope', isPaid: false });
  });

  it('retries on 5xx and network errors, then succeeds', async () => {
    const fetch = mockFetch({ status: 503 }, new TypeError('fetch failed'), {
      status: 200,
      body: lookup.completed.body,
    });
    const result = await khalti(fetch).lookup({ reference: 'x' });
    expect(result.isPaid).toBe(true);
    expect(fetch.calls).toHaveLength(3);
  });

  it('gives up with NetworkError after the configured retries', async () => {
    const fetch = mockFetch(new TypeError('a'), new TypeError('b'));
    const error = await khalti(fetch, { retries: 1 })
      .lookup({ reference: 'x' })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(NetworkError);
    expect((error as NetworkError).code).toBe(ErrorCode.NETWORK_ERROR);
  });

  it('reports timeouts as NetworkError with code TIMEOUT', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    const error = await khalti(mockFetch(timeout), { retries: 0 })
      .lookup({ reference: 'x' })
      .catch((e: unknown) => e);
    expect((error as NetworkError).code).toBe(ErrorCode.TIMEOUT);
  });

  it('requires a reference', async () => {
    await expect(khalti(mockFetch()).lookup({ reference: '' })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('KhaltiGateway.verify', () => {
  it('confirms through lookup and ignores the callback status', async () => {
    const fetch = mockFetch({ status: 200, body: lookup.pending.body });
    const result = await khalti(fetch).verify({ callback: fixture.callbackCompleted });
    expect(fetch.calls[0]?.body).toEqual({ pidx: fixture.callbackCompleted.pidx });
    expect(result.status).toBe('pending');
    expect(result.isPaid).toBe(false);
  });

  it('returns a paid result when amount and reference match', async () => {
    const result = await khalti(mockFetch({ status: 200, body: lookup.completed.body })).verify({
      callback: fixture.callbackCompleted,
      expected: { amount: 110_000, reference: fixture.callbackCompleted.pidx },
    });
    expect(result).toMatchObject({
      isPaid: true,
      transactionId: 'GFq9PFS7b2iYvL8Lir9oXe',
      fee: 3300,
    });
  });

  it('throws AMOUNT_MISMATCH when Khalti confirms a different amount', async () => {
    const error = await khalti(mockFetch({ status: 200, body: lookup.completed.body }))
      .verify({ callback: fixture.callbackCompleted, expected: { amount: 999_000 } })
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(PaymentMismatchError);
    expect((error as PaymentMismatchError).code).toBe(ErrorCode.AMOUNT_MISMATCH);
  });

  it('throws REFERENCE_MISMATCH when the callback is for another payment', async () => {
    const error = await khalti(mockFetch({ status: 200, body: lookup.completed.body }))
      .verify({
        callback: fixture.callbackCompleted,
        expected: { amount: 110_000, reference: 'other-pidx' },
      })
      .catch((e: unknown) => e);
    expect((error as PaymentMismatchError).code).toBe(ErrorCode.REFERENCE_MISMATCH);
  });

  it('returns canceled (not an error) when the user cancels', async () => {
    const result = await khalti(mockFetch({ status: 400, body: lookup.userCanceled.body })).verify({
      callback: fixture.callbackCanceled,
      expected: { amount: 110_000 },
    });
    expect(result.status).toBe('canceled');
  });

  it('accepts array query values (Express) and falls back to expected.reference', async () => {
    const fetch = mockFetch(
      { status: 200, body: lookup.completed.body },
      { status: 200, body: lookup.completed.body },
    );
    await khalti(fetch).verify({ callback: { pidx: ['abc', 'def'] } });
    await khalti(fetch).verify({
      callback: {},
      expected: { amount: 110_000, reference: 'bZQLD9wRVWo4CdESSfuSsB' },
    });
    expect(fetch.calls.map((c) => c.body)).toEqual([
      { pidx: 'abc' },
      { pidx: 'bZQLD9wRVWo4CdESSfuSsB' },
    ]);
  });

  it('throws InvalidCallbackError without a pidx', async () => {
    await expect(khalti(mockFetch()).verify({ callback: { pidx: ' ' } })).rejects.toBeInstanceOf(
      InvalidCallbackError,
    );
  });
});
