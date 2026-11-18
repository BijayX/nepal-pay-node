import { describe, expect, it, vi } from 'vitest';
import {
  ConfigurationError,
  EsewaGateway,
  KhaltiGateway,
  NetworkError,
  ValidationError,
  isNepalPayError,
  renderRedirectPage,
} from '../../src/index.js';
import { mockFetch } from '../helpers/mock-fetch.js';

describe('logging', () => {
  it('logs method, URL and status but never the secret key or bodies', async () => {
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const fetch = mockFetch(
      { status: 503 },
      {
        status: 200,
        body: { pidx: 'p', total_amount: 1000, status: 'Completed', transaction_id: 't' },
      },
    );
    const gateway = new KhaltiGateway({
      secretKey: 'super-secret',
      websiteUrl: 'https://shop.test',
      fetch,
      logger,
      retryDelayMs: 0,
    });
    await gateway.lookup({ reference: 'p' });

    const logged = JSON.stringify([...logger.debug.mock.calls, ...logger.warn.mock.calls]);
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logged).toContain('epayment/lookup');
    expect(logged).not.toContain('super-secret');
    expect(logged).not.toContain('Completed');
  });

  it('strips query strings (which may hold order data) from logged URLs', async () => {
    const logger = { debug: vi.fn(), warn: vi.fn() };
    const fetch = mockFetch({
      status: 200,
      body: { status: 'COMPLETE', total_amount: 1, transaction_uuid: 'r', ref_id: 'x' },
    });
    await new EsewaGateway({ fetch, logger }).lookup({ reference: 'r', amount: 100 });
    expect(JSON.stringify(logger.debug.mock.calls)).not.toContain('transaction_uuid');
  });
});

describe('errors', () => {
  it('serialise to safe JSON and are recognisable', () => {
    const error = ValidationError.fromFields({ amount: ['too small'] }, { gateway: 'khalti' });
    expect(isNepalPayError(error)).toBe(true);
    expect(isNepalPayError(new Error('x'))).toBe(false);
    expect(error.toJSON()).toEqual({
      name: 'ValidationError',
      code: 'VALIDATION_ERROR',
      message: 'Invalid amount: too small',
      gateway: 'khalti',
      details: { fields: { amount: ['too small'] } },
    });
  });

  it('keep the original cause', () => {
    const cause = new TypeError('socket hang up');
    expect(new NetworkError('x', { cause }).cause).toBe(cause);
    expect(new ConfigurationError('x').gateway).toBeNull();
  });
});

describe('renderRedirectPage', () => {
  it('renders an auto-submitting, escaped POST form', () => {
    const html = renderRedirectPage(
      {
        method: 'POST',
        url: 'https://pay.test/form',
        fields: { a: '1', evil: '"><script>alert(1)</script>' },
      },
      { nonce: 'abc' },
    );
    expect(html).toContain(
      '<form id="nepal-pay-redirect" method="POST" action="https://pay.test/form">',
    );
    expect(html).toContain('<input type="hidden" name="a" value="1">');
    expect(html).not.toContain('<script>alert(1)');
    expect(html).toContain('&quot;&gt;&lt;script&gt;');
    expect(html).toContain('<script nonce="abc">');
    expect(html).toContain('<noscript>');
  });

  it('renders a refresh + link for GET redirects, keeping the query string', () => {
    const html = renderRedirectPage({ method: 'GET', url: 'https://pay.test/?pidx=a&b=1' });
    expect(html).toContain('content="0;url=https://pay.test/?pidx=a&amp;b=1"');
    expect(html).not.toContain('<form');
  });
});
