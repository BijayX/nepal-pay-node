import { createHmac, timingSafeEqual } from 'node:crypto';

/** HMAC-SHA256 of `message`, base64-encoded. */
export function hmacSha256Base64(secret: string, message: string): string {
  return createHmac('sha256', secret).update(message, 'utf8').digest('base64');
}

/** Constant-time string comparison (does not leak where two signatures differ). */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a, 'utf8');
  const right = Buffer.from(b, 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}
