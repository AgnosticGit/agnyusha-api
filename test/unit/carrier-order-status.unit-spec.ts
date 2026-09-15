import { DeliveryMethodCode, OrderStatus } from '@prisma/client';
import {
  isOrderStatusUpgrade,
  orderStatusFromCarrierCode,
  resolveOrderStatusAfterCarrier,
} from '../../src/orders/carrier-order-status';

describe('carrier-order-status', () => {
  it('maps CDEK lifecycle (handover only after warehouse receive)', () => {
    expect(
      orderStatusFromCarrierCode(DeliveryMethodCode.CDEK, 'CREATED'),
    ).toBeNull();
    expect(
      orderStatusFromCarrierCode(DeliveryMethodCode.CDEK, 'ACCEPTED'),
    ).toBeNull();
    expect(
      orderStatusFromCarrierCode(
        DeliveryMethodCode.CDEK,
        'RECEIVED_AT_SHIPMENT_WAREHOUSE',
      ),
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

  it('maps Yandex PVZ lifecycle (handover at sorting center)', () => {
    expect(
      orderStatusFromCarrierCode(DeliveryMethodCode.YANDEX, 'CREATED'),
    ).toBeNull();
    expect(
      orderStatusFromCarrierCode(
        DeliveryMethodCode.YANDEX,
        'DELIVERY_PROCESSING_STARTED',
      ),
    ).toBeNull();
    expect(
      orderStatusFromCarrierCode(
        DeliveryMethodCode.YANDEX,
        'SORTING_CENTER_AT_START',
      ),
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
        OrderStatus.PAID,
        DeliveryMethodCode.CDEK,
        'ACCEPTED',
      ),
    ).toBeNull();
    expect(
      resolveOrderStatusAfterCarrier(
        OrderStatus.SHIPPED,
        DeliveryMethodCode.CDEK,
        'RECEIVED_AT_SHIPMENT_WAREHOUSE',
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
