import { BaseGateway, callbackValue, requireOption } from '../../core/gateway.js';
import {
  ConfigurationError,
  GatewayError,
  InvalidCallbackError,
  ValidationError,
} from '../../core/errors/index.js';
import type { HttpResponse } from '../../core/http/http-client.js';
import {
  isAbsoluteHttpUrl,
  validateInitiateInput,
  type NormalizedInitiateInput,
} from '../../core/validation/validate-initiate.js';
import {
  PaymentStatus,
  type InitiatePaymentInput,
  type InitiatedPayment,
  type LookupPaymentInput,
  type PaymentResult,
  type VerifyPaymentInput,
} from '../../core/types.js';
import {
  KHALTI,
  KHALTI_BASE_URLS,
  KHALTI_MIN_AMOUNT,
  type KhaltiOptions,
} from './khalti.config.js';
import { toKhaltiError } from './khalti.errors.js';
import { mapKhaltiStatus } from './khalti.status.js';
import type {
  KhaltiInitiateRequest,
  KhaltiInitiateResponse,
  KhaltiLookupResponse,
} from './khalti.types.js';

/**
 * Khalti KPG-2 web checkout.
 *
 * Flow: `initiate()` → redirect the customer (GET) → Khalti sends them to `returnUrl`
 * with `?pidx=...` → `verify()` confirms through the lookup API (the source of truth).
 */
export class KhaltiGateway extends BaseGateway {
  readonly name = KHALTI;
  private readonly secretKey: string;
  private readonly websiteUrl: string;
  private readonly baseUrl: string;

  constructor(options: KhaltiOptions) {
    super(KHALTI, options);
    this.secretKey = requireOption(options.secretKey, 'secretKey', KHALTI, 'KHALTI_SECRET_KEY');
    this.websiteUrl = requireOption(options.websiteUrl, 'websiteUrl', KHALTI, 'KHALTI_WEBSITE_URL');
    if (!isAbsoluteHttpUrl(this.websiteUrl)) {
      throw new ConfigurationError('khalti: "websiteUrl" must be an absolute http(s) URL', {
        gateway: KHALTI,
      });
    }
    const baseUrl = options.baseUrl ?? KHALTI_BASE_URLS[this.environment];
    this.baseUrl = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  }

  async initiate(input: InitiatePaymentInput): Promise<InitiatedPayment> {
    const payment = validateInitiateInput(input, KHALTI, { minAmount: KHALTI_MIN_AMOUNT });

    const response = await this.http.send({
      method: 'POST',
      url: `${this.baseUrl}epayment/initiate/`,
      headers: this.authHeaders(),
      json: this.buildInitiateBody(payment),
      idempotent: false,
    });

    if (response.status !== 200 && response.status !== 201) {
      throw toKhaltiError(response, 'initiate');
    }
    const body = parseInitiateResponse(response);

    return {
      gateway: KHALTI,
      reference: body.pidx,
      orderId: payment.orderId,
      amount: payment.amount,
      redirect: { method: 'GET', url: body.payment_url },
      expiresAt: parseDate(body.expires_at),
      raw: body,
    };
  }

  async verify({ callback, expected }: VerifyPaymentInput): Promise<PaymentResult> {
    const pidx = callbackValue(callback, 'pidx') ?? expected?.reference;
    if (pidx === undefined) {
      throw new InvalidCallbackError('Khalti callback is missing "pidx"', { gateway: KHALTI });
    }
    // The callback's own `status`/`amount` are ignored on purpose: anyone can forge a URL.
    const result = await this.lookup({ reference: pidx });
    return this.assertExpected(result, expected);
  }

  async lookup({ reference }: LookupPaymentInput): Promise<PaymentResult> {
    if (typeof reference !== 'string' || reference.trim() === '') {
      throw ValidationError.fromFields({ reference: ['is required'] }, { gateway: KHALTI });
    }

    const response = await this.http.send({
      method: 'POST',
      url: `${this.baseUrl}epayment/lookup/`,
      headers: this.authHeaders(),
      json: { pidx: reference },
      idempotent: true,
    });

    // Khalti answers Expired / User canceled with HTTP 400 but a normal lookup body.
    if (isLookupBody(response.body) && response.status < 500) {
      return this.toResult(response.body);
    }
    if (isNotFound(response)) {
      return this.result({
        status: PaymentStatus.NOT_FOUND,
        reference,
        transactionId: null,
        amount: 0,
        fee: null,
        raw: response.body,
      });
    }
    throw toKhaltiError(response, 'lookup');
  }

  private toResult(body: KhaltiLookupResponse): PaymentResult {
    const amount = Number(body.total_amount);
    if (!Number.isSafeInteger(amount) || amount < 0) {
      throw new GatewayError('Khalti lookup returned an invalid total_amount', {
        gateway: KHALTI,
        responseBody: body,
      });
    }
    return this.result({
      status: mapKhaltiStatus(body.status),
      reference: body.pidx,
      transactionId: body.transaction_id ?? null,
      amount,
      fee: typeof body.fee === 'number' ? body.fee : null,
      raw: body,
    });
  }

  private buildInitiateBody(payment: NormalizedInitiateInput): KhaltiInitiateRequest {
    const body: KhaltiInitiateRequest = {
      return_url: payment.returnUrl,
      website_url: this.websiteUrl,
      amount: payment.amount,
      purchase_order_id: payment.orderId,
      purchase_order_name: payment.orderName,
    };

    if (payment.customer) {
      const { name, email, phone } = payment.customer;
      body.customer_info = {
        ...(name !== undefined && { name }),
        ...(email !== undefined && { email }),
        ...(phone !== undefined && { phone }),
      };
    }

    const { tax, serviceCharge, deliveryCharge } = payment.breakdown;
    if (tax + serviceCharge + deliveryCharge > 0) {
      body.amount_breakdown = [
        { label: 'Amount', amount: payment.baseAmount },
        { label: 'Tax', amount: tax },
        { label: 'Service charge', amount: serviceCharge },
        { label: 'Delivery charge', amount: deliveryCharge },
      ].filter((row, index) => index === 0 || row.amount > 0);
    }

    for (const [key, value] of Object.entries(payment.metadata)) {
      body[`merchant_${key}`] = value;
    }
    return body;
  }

  private authHeaders(): Record<string, string> {
    return { Authorization: `Key ${this.secretKey}` };
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isLookupBody(body: unknown): body is KhaltiLookupResponse {
  return isRecord(body) && typeof body.pidx === 'string' && typeof body.status === 'string';
}

function isNotFound(response: HttpResponse): boolean {
  const { status, body } = response;
  return (
    (status === 404 || status === 400) &&
    isRecord(body) &&
    typeof body.detail === 'string' &&
    body.detail.trim().toLowerCase().replace(/\.$/, '') === 'not found'
  );
}

function parseInitiateResponse(response: HttpResponse): KhaltiInitiateResponse {
  const { body } = response;
  if (
    !isRecord(body) ||
    typeof body.pidx !== 'string' ||
    typeof body.payment_url !== 'string' ||
    !isAbsoluteHttpUrl(body.payment_url)
  ) {
    throw new GatewayError('Khalti initiate returned an unexpected response', {
      gateway: KHALTI,
      statusCode: response.status,
      responseBody: body,
    });
  }
  return body as unknown as KhaltiInitiateResponse;
}

function parseDate(value: string | undefined): Date | null {
  if (value === undefined) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}
