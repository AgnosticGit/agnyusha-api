/** Carrier codes that mean tracking is finished — stop polling. */
export const FINAL_DELIVERY_STATUS_CODES = new Set([
  'DELIVERED',
  'NOT_DELIVERED',
  'REMOVED',
  'INVALID',
  'DESTROYED',
  'DELIVERED_FINISH',
  'RETURNED_FINISH',
  'CANCELLED',
  'CANCELLED_USER',
  'SORTING_CENTER_CANCELLED',
  'DELIVERY_TRACKING_FINISHED',
]);

export const FINAL_DELIVERY_STATUS_CODE_LIST = [...FINAL_DELIVERY_STATUS_CODES];

/**
 * Carrier still returns the entity, but the shipment is dead
 * (CDEK INVALID, Yandex CANCELLED after shop cancel, etc.).
 * Treat like 404 entity-gone: archive and stop polling.
 */
export const CARRIER_ABANDONED_STATUS_CODES = new Set([
  'INVALID',
  'DESTROYED',
  'CANCELLED',
  'CANCELLED_USER',
  'SORTING_CENTER_CANCELLED',
]);

export function isCarrierAbandonedStatus(
  code: string | null | undefined,
): boolean {
  return Boolean(code && CARRIER_ABANDONED_STATUS_CODES.has(code));
}
