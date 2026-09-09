import { OrderStatus } from '@prisma/client';

/** Terminal business statuses — do not overwrite on carrier entity-gone. */
const KEEP_ON_CARRIER_GONE = new Set<OrderStatus>([
  OrderStatus.DONE,
  OrderStatus.CANCELLED,
  OrderStatus.ARCHIVED,
]);

/**
 * When the carrier no longer has the shipment (404 / purged / manual delete),
 * move active orders to ARCHIVED. Leave DONE/CANCELLED/ARCHIVED as-is.
 */
export function orderStatusAfterCarrierGone(
  status: OrderStatus,
): OrderStatus {
  if (KEEP_ON_CARRIER_GONE.has(status)) return status;
  return OrderStatus.ARCHIVED;
}
