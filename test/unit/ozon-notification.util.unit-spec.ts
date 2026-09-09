import {
  asOzonFieldString,
  parseOzonNotification,
} from '../../src/payments/ozon-notification.util';

describe('parseOzonNotification', () => {
  it('parses flat extId + Completed', () => {
    expect(
      parseOzonNotification({
        extId: 'ord-1',
        status: 'Completed',
        id: 'ozon-1',
      }),
    ).toEqual(
      expect.objectContaining({
        extId: 'ord-1',
        ozonId: 'ozon-1',
        status: 'Completed',
      }),
    );
  });

  it('parses real Ozon bank notification shape (extOrderID + orderID)', () => {
    expect(
      parseOzonNotification({
        orderID: '01a08802-365e-7678-a56c-6698bce490d9',
        extOrderID: 'cmtulep6r00037k5syjmyyp12',
        transactionID: 'tx-1',
        transactionUID: 'tx-uid-1',
        amount: 10000,
        currencyCode: '643',
        paymentTime: '2026-09-09T21:10:52Z',
        testMode: false,
        status: 'Completed',
        operationType: 'Payment',
        paymentMethod: 'Card',
        requestSign: 'abc',
        paidWithBonuses: 0,
        items: [],
      }),
    ).toEqual(
      expect.objectContaining({
        extId: 'cmtulep6r00037k5syjmyyp12',
        ozonId: '01a08802-365e-7678-a56c-6698bce490d9',
        status: 'Completed',
      }),
    );
  });

  it('does not treat bare orderID as our merchant extId', () => {
    const parsed = parseOzonNotification({
      orderID: '01a08802-365e-7678-a56c-6698bce490d9',
      status: 'Completed',
    });
    expect(parsed.extId).toBeNull();
    expect(parsed.ozonId).toBe('01a08802-365e-7678-a56c-6698bce490d9');
    expect(parsed.status).toBe('Completed');
  });

  it('parses PascalCase and snake_case aliases', () => {
    expect(
      parseOzonNotification({
        ExtId: 'ord-2',
        OrderStatus: 'STATUS_PAID',
        Id: 'ozon-2',
      }),
    ).toEqual(
      expect.objectContaining({
        extId: 'ord-2',
        ozonId: 'ozon-2',
        status: 'STATUS_PAID',
      }),
    );

    expect(
      parseOzonNotification({
        external_id: 'ord-3',
        payment_status: 'Completed',
        payment_id: 'ozon-3',
      }),
    ).toEqual(
      expect.objectContaining({
        extId: 'ord-3',
        ozonId: 'ozon-3',
        status: 'Completed',
      }),
    );
  });

  it('parses nested order/item/data envelopes', () => {
    expect(
      parseOzonNotification({
        data: {
          order: {
            extId: 'ord-4',
            status: 'Completed',
            id: 'ozon-4',
          },
        },
      }),
    ).toEqual(
      expect.objectContaining({
        extId: 'ord-4',
        ozonId: 'ozon-4',
        status: 'Completed',
      }),
    );
  });

  it('keeps status when only Ozon id is present (no extId)', () => {
    expect(
      parseOzonNotification({
        id: 'ozon-only',
        status: 'Completed',
      }),
    ).toEqual(
      expect.objectContaining({
        extId: null,
        ozonId: 'ozon-only',
        status: 'Completed',
      }),
    );
  });

  it('parses JSON string bodies and numeric ids', () => {
    expect(asOzonFieldString(42)).toBe('42');
    expect(
      parseOzonNotification(
        JSON.stringify({ ext_id: 1001, status: 'Completed', id: 55 }),
      ),
    ).toEqual(
      expect.objectContaining({
        extId: '1001',
        ozonId: '55',
        status: 'Completed',
      }),
    );
  });
});
