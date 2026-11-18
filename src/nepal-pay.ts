import { ConfigurationError } from './core/errors/index.js';
import type { HttpOptions } from './core/http/http-client.js';
import type { Environment, PaymentGateway } from './core/types.js';
import { EsewaGateway } from './gateways/esewa/esewa.gateway.js';
import type { EsewaOptions } from './gateways/esewa/esewa.config.js';
import { KhaltiGateway } from './gateways/khalti/khalti.gateway.js';
import type { KhaltiOptions } from './gateways/khalti/khalti.config.js';

type WithoutShared<T> = Omit<T, 'environment' | keyof HttpOptions> &
  Partial<Pick<T, Extract<keyof T, 'environment' | keyof HttpOptions>>>;

export interface NepalPayConfig {
  /** Gateway used by `gateway()` with no name. Defaults to the first configured one. */
  default?: string;
  /** Applies to every gateway unless overridden per gateway. Default `"sandbox"`. */
  environment?: Environment;
  /** Shared transport options (timeout, retries, fetch, logger). */
  http?: HttpOptions;
  gateways: {
    khalti?: WithoutShared<KhaltiOptions>;
    esewa?: WithoutShared<EsewaOptions>;
    /** Options for gateways registered with `extend()`. */
    [custom: string]: Record<string, unknown> | undefined;
  };
}

/** Shared settings handed to custom gateway factories, merged with that gateway's own options. */
export type GatewayFactory = (
  options: Record<string, unknown> & { environment: Environment } & HttpOptions,
) => PaymentGateway;

/**
 * Registry of configured gateways. Instances are created lazily and cached,
 * so configuration errors surface the first time a gateway is used.
 *
 * ```ts
 * const pay = new NepalPay({ gateways: { khalti: { secretKey, websiteUrl }, esewa: {} } });
 * await pay.gateway('khalti').initiate({ ... });
 * ```
 */
export class NepalPay {
  private readonly factories = new Map<string, GatewayFactory>([
    ['khalti', (options) => new KhaltiGateway(options as unknown as KhaltiOptions)],
    ['esewa', (options) => new EsewaGateway(options)],
  ]);
  private readonly instances = new Map<string, PaymentGateway>();

  constructor(private readonly config: NepalPayConfig) {
    if (typeof config !== 'object' || typeof config.gateways !== 'object') {
      throw new ConfigurationError('NepalPay: "gateways" config is required');
    }
  }

  /** Names of gateways that have configuration. */
  get configured(): string[] {
    return Object.entries(this.config.gateways)
      .filter(([, options]) => options !== undefined)
      .map(([name]) => name);
  }

  gateway(name: 'khalti'): KhaltiGateway;
  gateway(name: 'esewa'): EsewaGateway;
  gateway(name?: string): PaymentGateway;
  gateway(name?: string): PaymentGateway {
    const gatewayName = name ?? this.defaultGateway();
    const cached = this.instances.get(gatewayName);
    if (cached) return cached;

    const factory = this.factories.get(gatewayName);
    if (!factory) {
      throw new ConfigurationError(`Unknown gateway "${gatewayName}". Register it with extend().`, {
        gateway: gatewayName,
      });
    }
    const own = this.config.gateways[gatewayName];
    if (own === undefined) {
      throw new ConfigurationError(`Gateway "${gatewayName}" is not configured`, {
        gateway: gatewayName,
      });
    }

    const instance = factory({
      ...this.config.http,
      environment: this.config.environment ?? 'sandbox',
      ...own,
    });
    this.instances.set(gatewayName, instance);
    return instance;
  }

  /** Register a custom gateway (or replace a built-in one). Returns `this` for chaining. */
  extend(name: string, factory: GatewayFactory): this {
    this.factories.set(name, factory);
    this.instances.delete(name);
    return this;
  }

  private defaultGateway(): string {
    const name = this.config.default ?? this.configured[0];
    if (name === undefined) throw new ConfigurationError('NepalPay: no gateway is configured');
    return name;
  }
}

/**
 * Builds a `NepalPay` from environment variables:
 * `NEPAL_PAY_ENV`, `NEPAL_PAY_DEFAULT`, `KHALTI_SECRET_KEY`, `KHALTI_WEBSITE_URL`,
 * `ESEWA_PRODUCT_CODE`, `ESEWA_SECRET_KEY`. Gateways without credentials are skipped
 * (eSewa is always available in sandbox, using the public test credentials).
 */
export function createNepalPayFromEnv(
  env: Readonly<Record<string, string | undefined>> = process.env,
  http: HttpOptions = {},
): NepalPay {
  const environment = (env.NEPAL_PAY_ENV ?? 'sandbox') as Environment;
  const gateways: NepalPayConfig['gateways'] = {};

  if (env.KHALTI_SECRET_KEY) {
    gateways.khalti = {
      secretKey: env.KHALTI_SECRET_KEY,
      websiteUrl: env.KHALTI_WEBSITE_URL ?? '',
    };
  }
  if ((env.ESEWA_PRODUCT_CODE && env.ESEWA_SECRET_KEY) || environment === 'sandbox') {
    gateways.esewa = {
      ...(env.ESEWA_PRODUCT_CODE && { productCode: env.ESEWA_PRODUCT_CODE }),
      ...(env.ESEWA_SECRET_KEY && { secretKey: env.ESEWA_SECRET_KEY }),
    };
  }

  return new NepalPay({
    environment,
    http,
    gateways,
    ...(env.NEPAL_PAY_DEFAULT && { default: env.NEPAL_PAY_DEFAULT }),
  });
}
