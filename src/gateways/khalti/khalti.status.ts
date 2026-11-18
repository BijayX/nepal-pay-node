import { PaymentStatus } from '../../core/types.js';

const STATUS_MAP: Readonly<Record<string, PaymentStatus>> = {
  completed: PaymentStatus.COMPLETED,
  pending: PaymentStatus.PENDING,
  initiated: PaymentStatus.INITIATED,
  refunded: PaymentStatus.REFUNDED,
  'partially refunded': PaymentStatus.PARTIALLY_REFUNDED,
  expired: PaymentStatus.EXPIRED,
  'user canceled': PaymentStatus.CANCELED,
  'user cancelled': PaymentStatus.CANCELED,
  canceled: PaymentStatus.CANCELED,
  cancelled: PaymentStatus.CANCELED,
  failed: PaymentStatus.FAILED,
};

/** Khalti status text (e.g. `"User canceled"`) → unified status. Unknown values map to `unknown`. */
export function mapKhaltiStatus(status: string): PaymentStatus {
  const key = status
    .trim()
    .toLowerCase()
    .replace(/[\s_]+/g, ' ');
  return STATUS_MAP[key] ?? PaymentStatus.UNKNOWN;
}
