import type { BaseGatewayOptions } from '../../core/gateway.js';
import type { Environment } from '../../core/types.js';

export const ESEWA = 'esewa';

export const ESEWA_URLS: Readonly<Record<Environment, { form: string; status: string }>> = {
  sandbox: {
    form: 'https://rc-epay.esewa.com.np/api/epay/main/v2/form',
    status: 'https://rc.esewa.com.np/api/epay/transaction/status/',
  },
  production: {
    form: 'https://epay.esewa.com.np/api/epay/main/v2/form',
    status: 'https://esewa.com.np/api/epay/transaction/status/',
  },
};

/** Public UAT credentials published by eSewa. Used only when `environment` is `"sandbox"`. */
export const ESEWA_SANDBOX_CREDENTIALS = {
  productCode: 'EPAYTEST',
  secretKey: '8gBm/:&EnhH.1/q',
} as const;

/** eSewa accepts at most three `properties[...]` fields. */
export const ESEWA_MAX_PROPERTIES = 3;

export const ESEWA_REQUEST_SIGNED_FIELDS = [
  'total_amount',
  'transaction_uuid',
  'product_code',
] as const;

export interface EsewaOptions extends BaseGatewayOptions {
  /** Merchant/product code from eSewa. Defaults to `EPAYTEST` in sandbox. */
  productCode?: string;
  /** HMAC secret key from eSewa. Defaults to the public UAT key in sandbox. */
  secretKey?: string;
  /** Override the checkout form URL. */
  formUrl?: string;
  /** Override the transaction status API URL. */
  statusUrl?: string;
}
