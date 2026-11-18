/**
 * In-memory order store standing in for your database.
 * In production, `markPaid` must be atomic: a conditional UPDATE
 * (`... WHERE id = ? AND status = 'pending'`) or a row lock.
 */
export interface Order {
  id: string;
  amount: number; // paisa
  status: 'pending' | 'paid' | 'failed';
  gateway?: string;
  paymentReference?: string;
}

const orders = new Map<string, Order>();

export const Orders = {
  create(amount: number): Order {
    const order: Order = { id: `ORD-${Date.now()}`, amount, status: 'pending' };
    orders.set(order.id, order);
    return order;
  },
  find(id: string): Order | undefined {
    return orders.get(id);
  },
  attachPayment(id: string, gateway: string, reference: string): void {
    const order = orders.get(id);
    if (order) Object.assign(order, { gateway, paymentReference: reference });
  },
  /** Returns false when the order was already settled — callbacks can arrive twice. */
  markPaid(id: string): boolean {
    const order = orders.get(id);
    if (order?.status !== 'pending') return false;
    order.status = 'paid';
    return true;
  },
  markFailed(id: string): void {
    const order = orders.get(id);
    if (order?.status === 'pending') order.status = 'failed';
  },
};
