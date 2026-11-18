import type { BaseGatewayOptions } from '../../core/gateway.js';
import type { Environment } from '../../core/types.js';

export const KHALTI = 'khalti';

/** Khalti rejects payments below Rs 10. */
export const KHALTI_MIN_AMOUNT = 1000;

export const KHALTI_BASE_URLS: Readonly<Record<Environment, string>> = {
  sandbox: 'https://dev.khalti.com/api/v2/',
  production: 'https://khalti.com/api/v2/',
};

export interface KhaltiOptions extends BaseGatewayOptions {
  /** "Live secret key" from test-admin.khalti.com (sandbox) or admin.khalti.com (production). */
  secretKey: string;
  /** Your site's URL — Khalti requires it on every payment. */
  websiteUrl: string;
  /** Override the API base URL (proxies, mocks). Must end with `/`. */
  baseUrl?: string;
}
