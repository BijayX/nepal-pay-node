import { BaseGateway, callbackValue } from '../../core/gateway.js';
import {
  ConfigurationError,
  GatewayError,
  InvalidCallbackError,
  InvalidSignatureError,
  ValidationError,
} from '../../core/errors/index.js';
import type { HttpResponse } from '../../core/http/http-client.js';
import { assertPaisa, paisaToRupeeString, parseRupees } from '../../core/money.js';
import { validateInitiateInput } from '../../core/validation/validate-initiate.js';
import type {
  InitiatePaymentInput,
  InitiatedPayment,
  LookupPaymentInput,
  PaymentResult,
  VerifyPaymentInput,
} from '../../core/types.js';
import { decodeEsewaCallback } from './esewa.callback.js';
import {
  ESEWA,
  ESEWA_MAX_PROPERTIES,
  ESEWA_REQUEST_SIGNED_FIELDS,
  ESEWA_SANDBOX_CREDENTIALS,
  ESEWA_URLS,
  type EsewaOptions,
} from './esewa.config.js';
import { buildSignatureMessage, signEsewa, verifyEsewaSignature } from './esewa.signature.js';
import { mapEsewaStatus } from './esewa.status.js';
import type { EsewaStatusResponse } from './esewa.types.js';

/**
 * eSewa ePay v2.
 *
 * Flow: `initiate()` returns a signed form → POST it from the browser → eSewa sends the
 * customer to `returnUrl?data=<base64>` → `verify()` checks the signature, then confirms
 * through the status API (the source of truth).
 */
export class EsewaGateway extends BaseGateway {
  readonly name = ESEWA;
  private readonly productCode: string;
  private readonly secretKey: string;
  private readonly formUrl: string;
  private readonly statusUrl: string;

  constructor(options: EsewaOptions = {}) {
    super(ESEWA, options);
    const fallback = this.isSandbox ? ESEWA_SANDBOX_CREDENTIALS : undefined;
    const productCode = options.productCode ?? fallback?.productCode;
    const secretKey = options.secretKey ?? fallback?.secretKey;

    if (!productCode?.trim() || !secretKey?.trim()) {
      throw new ConfigurationError(
        'esewa: "productCode" and "secretKey" are required in production (ESEWA_PRODUCT_CODE, ESEWA_SECRET_KEY)',
        { gateway: ESEWA },
      );
    }
    this.productCode = productCode;
    this.secretKey = secretKey;
    this.formUrl = options.formUrl ?? ESEWA_URLS[this.environment].form;
    this.statusUrl = options.statusUrl ?? ESEWA_URLS[this.environment].status;
  }

  initiate(input: InitiatePaymentInput): Promise<InitiatedPayment> {
    // Synchronous work, but the async API keeps gateways interchangeable.
    // The Promise constructor turns validation throws into rejections.
    return new Promise((resolve) => {
      resolve(this.buildPayment(input));
    });
  }

  async verify({ callback, expected }: VerifyPaymentInput): Promise<PaymentResult> {
    const data = callbackValue(callback, 'data');

    let reference: string | undefined;
    let amount: number | undefined;

    if (data !== undefined) {
      const decoded = decodeEsewaCallback(data);
      if (!verifyEsewaSignature(this.secretKey, decoded)) {
        throw new InvalidSignatureError('eSewa callback signature is invalid', { gateway: ESEWA });
      }
      if (decoded.product_code !== this.productCode) {
        throw new InvalidSignatureError('eSewa callback is for a different product code', {
          gateway: ESEWA,
        });
      }
      reference = decoded.transaction_uuid;
      // Signed by eSewa, so it is what was actually charged; compared with `expected` below.
      amount = parseRupees(decoded.total_amount);
    } else {
      // e.g. failure_url, which carries no signed data: fall back to what the caller stored.
      reference = expected?.reference;
      amount = expected?.amount;
    }

    if (reference === undefined || amount === undefined) {
      throw new InvalidCallbackError(
        'eSewa callback has no "data"; pass expected.reference and expected.amount to check the status',
        { gateway: ESEWA },
      );
    }

    const result = await this.lookup({ reference, amount });
    return this.assertExpected(result, expected);
  }

  async lookup({ reference, amount }: LookupPaymentInput): Promise<PaymentResult> {
    const fields: Record<string, string[]> = {};
    if (typeof reference !== 'string' || reference.trim() === '')
      fields.reference = ['is required'];
    if (amount === undefined) fields.amount = ['is required by eSewa status checks'];
    if (Object.keys(fields).length > 0)
      throw ValidationError.fromFields(fields, { gateway: ESEWA });

    const total = paisaToRupeeString(assertPaisa(amount));
    const query = new URLSearchParams({
      product_code: this.productCode,
      total_amount: total,
      transaction_uuid: reference,
    });

    const response = await this.http.send({
      method: 'GET',
      url: `${this.statusUrl}?${query.toString()}`,
      idempotent: true,
    });
    return this.toResult(response, reference);
  }

  private buildPayment(input: InitiatePaymentInput): InitiatedPayment {
    const payment = validateInitiateInput(input, ESEWA, { maxMetadataKeys: ESEWA_MAX_PROPERTIES });
    const { tax, serviceCharge, deliveryCharge } = payment.breakdown;

    const fields: Record<string, string> = {
      amount: paisaToRupeeString(payment.baseAmount),
      tax_amount: paisaToRupeeString(tax),
      total_amount: paisaToRupeeString(payment.amount),
      transaction_uuid: payment.orderId,
      product_code: this.productCode,
      product_service_charge: paisaToRupeeString(serviceCharge),
      product_delivery_charge: paisaToRupeeString(deliveryCharge),
      success_url: payment.returnUrl,
      failure_url: payment.failureUrl,
      signed_field_names: ESEWA_REQUEST_SIGNED_FIELDS.join(','),
    };
    // Always defined: every signed field is set just above.
    const message = buildSignatureMessage(ESEWA_REQUEST_SIGNED_FIELDS, fields) ?? '';
    fields.signature = signEsewa(this.secretKey, message);

    for (const [key, value] of Object.entries(payment.metadata)) {
      fields[`properties[${key}]`] = value;
    }

    return {
      gateway: ESEWA,
      reference: payment.orderId,
      orderId: payment.orderId,
      amount: payment.amount,
      redirect: { method: 'POST', url: this.formUrl, fields: Object.freeze(fields) },
      expiresAt: null,
      raw: null,
    };
  }

  private toResult(response: HttpResponse, reference: string): PaymentResult {
    const { status, body } = response;

    if (isRecord(body) && typeof body.error_message === 'string') {
      throw new GatewayError(`eSewa status check failed: ${body.error_message}`, {
        gateway: ESEWA,
        statusCode: status,
        responseBody: body,
        retryable: true,
      });
    }
    if (status !== 200 || !isStatusBody(body)) {
      throw new GatewayError(
        `eSewa status check returned an unexpected response (HTTP ${status})`,
        {
          gateway: ESEWA,
          statusCode: status,
          responseBody: body,
        },
      );
    }

    let amount: number;
    try {
      amount = parseRupees(body.total_amount);
    } catch (error) {
      throw new GatewayError('eSewa status check returned an invalid total_amount', {
        gateway: ESEWA,
        statusCode: status,
        responseBody: body,
        cause: error,
      });
    }

    return this.result({
      status: mapEsewaStatus(body.status),
      reference: typeof body.transaction_uuid === 'string' ? body.transaction_uuid : reference,
      transactionId: typeof body.ref_id === 'string' && body.ref_id !== '' ? body.ref_id : null,
      amount,
      fee: null,
      raw: body,
    });
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStatusBody(body: unknown): body is EsewaStatusResponse {
  return isRecord(body) && typeof body.status === 'string' && body.total_amount !== undefined;
}
