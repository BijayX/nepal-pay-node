import { ValidationError } from './errors/index.js';
import type { Paisa } from './types.js';

/** Throws unless `value` is a positive, safe integer number of paisa. */
export function assertPaisa(value: unknown, field = 'amount', { allowZero = false } = {}): Paisa {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
    throw ValidationError.fromFields({ [field]: ['must be an integer number of paisa'] });
  }
  if (value < 0 || (!allowZero && value === 0)) {
    throw ValidationError.fromFields({
      [field]: [allowZero ? 'must not be negative' : 'must be greater than zero'],
    });
  }
  return value;
}

/**
 * Paisa → rupee string as eSewa expects it.
 * `11000` → `"110"`, `11050` → `"110.50"`.
 */
export function paisaToRupeeString(paisa: Paisa): string {
  assertPaisa(paisa, 'amount', { allowZero: true });
  const rupees = Math.trunc(paisa / 100);
  const rest = paisa % 100;
  return rest === 0 ? String(rupees) : `${rupees}.${String(rest).padStart(2, '0')}`;
}

const RUPEE_PATTERN = /^\d+(\.\d+)?$/;

/**
 * Rupee amount from a gateway (`"1,000.0"`, `"110"`, `100.5`) → paisa.
 * Throws when the value is not a non-negative decimal.
 */
export function parseRupees(value: unknown, field = 'total_amount'): Paisa {
  const text = typeof value === 'number' ? String(value) : typeof value === 'string' ? value : '';
  const normalized = text.replace(/,/g, '').trim();
  if (!RUPEE_PATTERN.test(normalized)) {
    throw ValidationError.fromFields({ [field]: [`is not a valid rupee amount`] });
  }
  const [whole = '0', fraction = ''] = normalized.split('.');
  // Integer maths on the digits avoids float rounding (e.g. 1.005 * 100).
  const paisa = Number(whole) * 100 + Math.round(Number(`0.${fraction || '0'}`) * 100);
  return assertPaisa(paisa, field, { allowZero: true });
}
