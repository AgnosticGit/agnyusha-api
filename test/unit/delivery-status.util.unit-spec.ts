import {
  FINAL_DELIVERY_STATUS_CODES,
  isCarrierAbandonedStatus,
} from '../../src/orders/delivery-status.util';

describe('delivery-status.util', () => {
  it('treats INVALID and DESTROYED as abandoned carrier statuses', () => {
    expect(isCarrierAbandonedStatus('INVALID')).toBe(true);
    expect(isCarrierAbandonedStatus('DESTROYED')).toBe(true);
    expect(isCarrierAbandonedStatus('CANCELLED')).toBe(true);
    expect(isCarrierAbandonedStatus('CANCELLED_USER')).toBe(true);
    expect(isCarrierAbandonedStatus('SORTING_CENTER_CANCELLED')).toBe(true);
    expect(isCarrierAbandonedStatus('DELIVERED')).toBe(false);
    expect(isCarrierAbandonedStatus('REMOVED')).toBe(false);
    expect(isCarrierAbandonedStatus(null)).toBe(false);
  });

  it('keeps abandoned codes in the final set so polling stops', () => {
    expect(FINAL_DELIVERY_STATUS_CODES.has('INVALID')).toBe(true);
    expect(FINAL_DELIVERY_STATUS_CODES.has('DESTROYED')).toBe(true);
  });
});
