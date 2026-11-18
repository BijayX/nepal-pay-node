import { describe, expect, it } from 'vitest';
import {
  ConfigurationError,
  EsewaGateway,
  KhaltiGateway,
  NepalPay,
  createNepalPayFromEnv,
  type PaymentGateway,
} from '../../src/index.js';

const khaltiConfig = { secretKey: 'k', websiteUrl: 'https://shop.test' };

describe('NepalPay manager', () => {
  it('creates typed gateways lazily and caches them', () => {
    const pay = new NepalPay({ gateways: { khalti: khaltiConfig, esewa: {} } });
    const khalti = pay.gateway('khalti');
    expect(khalti).toBeInstanceOf(KhaltiGateway);
    expect(pay.gateway('khalti')).toBe(khalti);
    expect(pay.gateway('esewa')).toBeInstanceOf(EsewaGateway);
  });

  it('uses the explicit default, else the first configured gateway', () => {
    expect(new NepalPay({ gateways: { esewa: {}, khalti: khaltiConfig } }).gateway().name).toBe(
      'esewa',
    );
    expect(
      new NepalPay({ default: 'khalti', gateways: { esewa: {}, khalti: khaltiConfig } }).gateway()
        .name,
    ).toBe('khalti');
  });

  it('applies the shared environment unless a gateway overrides it', () => {
    const pay = new NepalPay({
      environment: 'production',
      gateways: { khalti: khaltiConfig, esewa: { environment: 'sandbox' } },
    });
    expect(pay.gateway('khalti').environment).toBe('production');
    expect(pay.gateway('esewa').environment).toBe('sandbox');
  });

  it('fails clearly for unknown, unconfigured or missing gateways', () => {
    const pay = new NepalPay({ gateways: { esewa: {} } });
    expect(() => pay.gateway('stripe')).toThrow(ConfigurationError);
    expect(() => pay.gateway('khalti')).toThrow(/not configured/);
    expect(() => new NepalPay({ gateways: {} }).gateway()).toThrow(ConfigurationError);
    expect(() => new NepalPay(undefined as never)).toThrow(ConfigurationError);
  });

  it('supports custom gateways via extend()', () => {
    const fake = { name: 'fonepay' } as PaymentGateway;
    const pay = new NepalPay({ gateways: { fonepay: { merchantCode: 'M1' } } }).extend(
      'fonepay',
      (options) => {
        expect(options).toMatchObject({ merchantCode: 'M1', environment: 'sandbox' });
        return fake;
      },
    );
    expect(pay.gateway('fonepay')).toBe(fake);
    expect(pay.configured).toEqual(['fonepay']);
  });
});

describe('createNepalPayFromEnv', () => {
  it('configures gateways that have credentials; eSewa is always on in sandbox', () => {
    const pay = createNepalPayFromEnv({
      KHALTI_SECRET_KEY: 'k',
      KHALTI_WEBSITE_URL: 'https://shop.test',
    });
    expect(pay.configured).toEqual(['khalti', 'esewa']);
    expect(createNepalPayFromEnv({}).configured).toEqual(['esewa']);
  });

  it('needs explicit eSewa credentials in production', () => {
    expect(createNepalPayFromEnv({ NEPAL_PAY_ENV: 'production' }).configured).toEqual([]);
    const pay = createNepalPayFromEnv({
      NEPAL_PAY_ENV: 'production',
      NEPAL_PAY_DEFAULT: 'esewa',
      ESEWA_PRODUCT_CODE: 'NP-1',
      ESEWA_SECRET_KEY: 's',
    });
    expect(pay.gateway().environment).toBe('production');
  });
});
