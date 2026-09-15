import { DeliveryMethodCode, OrderStatus } from '@prisma/client';
import {
  isOrderStatusUpgrade,
  orderStatusFromCarrierCode,
  resolveOrderStatusAfterCarrier,
} from '../../src/orders/carrier-order-status';

describe('carrier-order-status', () => {
  it('maps CDEK lifecycle', () => {
    expect(
      orderStatusFromCarrierCode(DeliveryMethodCode.CDEK, 'ACCEPTED'),
    ).toBe(OrderStatus.CONFIRMED);
    expect(
      orderStatusFromCarrierCode(
        DeliveryMethodCode.CDEK,
        'SENT_TO_RECIPIENT_CITY',
      ),
    ).toBe(OrderStatus.SHIPPED);
    expect(
      orderStatusFromCarrierCode(
        DeliveryMethodCode.CDEK,
        'ACCEPTED_AT_PICK_UP_POINT',
      ),
    ).toBe(OrderStatus.READY_FOR_PICKUP);
    expect(
      orderStatusFromCarrierCode(DeliveryMethodCode.CDEK, 'DELIVERED'),
    ).toBe(OrderStatus.DONE);
  });

  it('maps Yandex PVZ lifecycle', () => {
    expect(
      orderStatusFromCarrierCode(DeliveryMethodCode.YANDEX, 'CREATED'),
    ).toBe(OrderStatus.CONFIRMED);
    expect(
      orderStatusFromCarrierCode(
        DeliveryMethodCode.YANDEX,
        'DELIVERY_TRANSPORTATION',
      ),
    ).toBe(OrderStatus.SHIPPED);
    expect(
      orderStatusFromCarrierCode(
        DeliveryMethodCode.YANDEX,
        'DELIVERY_ARRIVED_PICKUP_POINT',
      ),
    ).toBe(OrderStatus.READY_FOR_PICKUP);
    expect(
      orderStatusFromCarrierCode(
        DeliveryMethodCode.YANDEX,
        'DELIVERY_DELIVERED',
      ),
    ).toBe(OrderStatus.DONE);
  });

  it('does not map Pochta yet', () => {
    expect(
      orderStatusFromCarrierCode(DeliveryMethodCode.POST, 'SHIPMENT'),
    ).toBeNull();
  });

  it('only upgrades forward', () => {
    expect(isOrderStatusUpgrade(OrderStatus.PAID, OrderStatus.SHIPPED)).toBe(
      true,
    );
    expect(
      isOrderStatusUpgrade(OrderStatus.READY_FOR_PICKUP, OrderStatus.SHIPPED),
    ).toBe(false);
    expect(
      resolveOrderStatusAfterCarrier(
        OrderStatus.SHIPPED,
        DeliveryMethodCode.CDEK,
        'ACCEPTED',
      ),
    ).toBeNull();
    expect(
      resolveOrderStatusAfterCarrier(
        OrderStatus.PAID,
        DeliveryMethodCode.CDEK,
        'DELIVERED',
      ),
    ).toBe(OrderStatus.DONE);
    expect(
      resolveOrderStatusAfterCarrier(
        OrderStatus.CANCELLED,
        DeliveryMethodCode.CDEK,
        'DELIVERED',
      ),
    ).toBeNull();
  });
});
