import { OrderStatus } from '@prisma/client';
import {
  OPEN_ORDER_STATUSES,
  orderStatusAfterCarrierGone,
} from '../../src/orders/order-status.util';

describe('OPEN_ORDER_STATUSES', () => {
  it('includes only in-progress statuses', () => {
    expect(OPEN_ORDER_STATUSES).toEqual([
      OrderStatus.NEW,
      OrderStatus.PAID,
      OrderStatus.CONFIRMED,
      OrderStatus.SHIPPED,
    ]);
    expect(OPEN_ORDER_STATUSES).not.toContain(OrderStatus.DONE);
    expect(OPEN_ORDER_STATUSES).not.toContain(OrderStatus.CANCELLED);
    expect(OPEN_ORDER_STATUSES).not.toContain(OrderStatus.ARCHIVED);
  });
});

describe('orderStatusAfterCarrierGone', () => {
  it('archives active orders', () => {
    expect(orderStatusAfterCarrierGone(OrderStatus.NEW)).toBe(
      OrderStatus.ARCHIVED,
    );
    expect(orderStatusAfterCarrierGone(OrderStatus.PAID)).toBe(
      OrderStatus.ARCHIVED,
    );
    expect(orderStatusAfterCarrierGone(OrderStatus.CONFIRMED)).toBe(
      OrderStatus.ARCHIVED,
    );
    expect(orderStatusAfterCarrierGone(OrderStatus.SHIPPED)).toBe(
      OrderStatus.ARCHIVED,
    );
  });

  it('keeps terminal business statuses', () => {
    expect(orderStatusAfterCarrierGone(OrderStatus.DONE)).toBe(
      OrderStatus.DONE,
    );
    expect(orderStatusAfterCarrierGone(OrderStatus.CANCELLED)).toBe(
      OrderStatus.CANCELLED,
    );
    expect(orderStatusAfterCarrierGone(OrderStatus.ARCHIVED)).toBe(
      OrderStatus.ARCHIVED,
    );
  });
});
