import { InvalidCallbackError } from '../../core/errors/index.js';
import { ESEWA } from './esewa.config.js';
import type { EsewaCallbackData } from './esewa.types.js';

// `signature` / `signed_field_names` are checked by the verifier, so a missing
// signature surfaces as INVALID_SIGNATURE rather than a malformed callback.
const REQUIRED_FIELDS = ['total_amount', 'transaction_uuid', 'product_code'] as const;

/**
 * Decodes eSewa's base64 `data` parameter.
 *
 * Tolerates the usual transport damage: `+` turned into spaces by query-string
 * parsing, base64url alphabet, and missing padding.
 */
export function decodeEsewaCallback(data: string): EsewaCallbackData {
  const base64 = data.trim().replace(/ /g, '+').replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'));
  } catch (error) {
    throw new InvalidCallbackError('eSewa callback "data" is not valid base64-encoded JSON', {
      gateway: ESEWA,
      cause: error,
    });
  }

  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new InvalidCallbackError('eSewa callback "data" must decode to a JSON object', {
      gateway: ESEWA,
    });
  }

  // Keep values as the exact strings eSewa signed; numbers are stringified the way JSON wrote them.
  const record: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      record[key] = String(value);
    }
  }

  const missing = REQUIRED_FIELDS.filter((field) => record[field] === undefined);
  if (missing.length > 0) {
    throw new InvalidCallbackError(`eSewa callback is missing: ${missing.join(', ')}`, {
      gateway: ESEWA,
      details: { missing },
    });
  }
  return record as EsewaCallbackData;
}
