import {
  AuthenticationError,
  GatewayError,
  ValidationError,
  type NepalPayError,
} from '../../core/errors/index.js';
import type { HttpResponse } from '../../core/http/http-client.js';
import { KHALTI } from './khalti.config.js';

const NON_FIELD_KEYS = new Set(['error_key', 'detail', 'status_code']);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Turns a failed Khalti response into a typed error.
 * Khalti formats: `{ field: ["msg"], error_key: "validation_error" }` and `{ detail, status_code }`.
 */
export function toKhaltiError(response: HttpResponse, operation: string): NepalPayError {
  const { status, body } = response;
  const detail = isRecord(body) && typeof body.detail === 'string' ? body.detail : undefined;

  if (status === 401 || status === 403) {
    return new AuthenticationError(
      `Khalti rejected the secret key${detail ? `: ${detail}` : ''}. Check KHALTI_SECRET_KEY and that it matches the environment.`,
      { gateway: KHALTI, details: { statusCode: status } },
    );
  }

  if (status === 400 && isRecord(body)) {
    const fields: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(body)) {
      if (NON_FIELD_KEYS.has(key)) continue;
      fields[key] = Array.isArray(value) ? value.map(String) : [String(value)];
    }
    if (Object.keys(fields).length === 0 && detail) fields.request = [detail];
    if (Object.keys(fields).length > 0) {
      return ValidationError.fromFields(fields, { gateway: KHALTI });
    }
  }

  return new GatewayError(
    `Khalti ${operation} failed with HTTP ${status}${detail ? `: ${detail}` : ''}`,
    {
      gateway: KHALTI,
      statusCode: status,
      responseBody: body,
    },
  );
}
