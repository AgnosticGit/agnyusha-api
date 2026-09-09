import { OrderStatus } from '@prisma/client';
import { orderStatusAfterCarrierGone } from '../../src/orders/order-status.util';

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
