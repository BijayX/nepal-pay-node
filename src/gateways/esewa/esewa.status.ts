import { PaymentStatus } from '../../core/types.js';

const STATUS_MAP: Readonly<Record<string, PaymentStatus>> = {
  COMPLETE: PaymentStatus.COMPLETED,
  COMPLETED: PaymentStatus.COMPLETED,
  PENDING: PaymentStatus.PENDING,
  FULL_REFUND: PaymentStatus.REFUNDED,
  PARTIAL_REFUND: PaymentStatus.PARTIALLY_REFUNDED,
  AMBIGUOUS: PaymentStatus.AMBIGUOUS,
  NOT_FOUND: PaymentStatus.NOT_FOUND,
  CANCELED: PaymentStatus.CANCELED,
  CANCELLED: PaymentStatus.CANCELED,
};

/** eSewa status (e.g. `"FULL_REFUND"`) → unified status. Unknown values map to `unknown`. */
export function mapEsewaStatus(status: string): PaymentStatus {
  const key = status
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');
  return STATUS_MAP[key] ?? PaymentStatus.UNKNOWN;
}
