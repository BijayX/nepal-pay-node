import { hmacSha256Base64, safeEqual } from '../../core/crypto/hmac.js';

/** Builds `"a=1,b=2"` from the listed field names, in that order, using values exactly as given. */
export function buildSignatureMessage(
  fieldNames: readonly string[],
  values: Readonly<Record<string, string | undefined>>,
): string | null {
  const parts: string[] = [];
  for (const name of fieldNames) {
    const value = values[name];
    if (value === undefined) return null;
    parts.push(`${name}=${value}`);
  }
  return parts.join(',');
}

export function signEsewa(secretKey: string, message: string): string {
  return hmacSha256Base64(secretKey, message);
}

/** Verifies a payload that names its own signed fields (eSewa callbacks). */
export function verifyEsewaSignature(
  secretKey: string,
  payload: Readonly<Record<string, string | undefined>>,
): boolean {
  const signature = payload.signature;
  const signedFieldNames = payload.signed_field_names;
  if (!signature || !signedFieldNames) return false;

  const names = signedFieldNames
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0 || names.includes('signature')) return false;

  const message = buildSignatureMessage(names, payload);
  return message !== null && safeEqual(signEsewa(secretKey, message), signature);
}
