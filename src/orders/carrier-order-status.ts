import { DeliveryMethodCode, OrderStatus } from '@prisma/client';

/** Forward-only ladder for logistics-driven order statuses. */
const STATUS_RANK: Partial<Record<OrderStatus, number>> = {
  [OrderStatus.NEW]: 0,
  [OrderStatus.PAID]: 1,
  [OrderStatus.CONFIRMED]: 2,
  [OrderStatus.SHIPPED]: 3,
  [OrderStatus.READY_FOR_PICKUP]: 4,
  [OrderStatus.DONE]: 5,
};

export function orderStatusRank(status: OrderStatus): number | null {
  const rank = STATUS_RANK[status];
  return typeof rank === 'number' ? rank : null;
}

/** True when `next` is strictly further along the logistics ladder than `current`. */
export function isOrderStatusUpgrade(
  current: OrderStatus,
  next: OrderStatus,
): boolean {
  const from = orderStatusRank(current);
  const to = orderStatusRank(next);
  if (from == null || to == null) return false;
  return to > from;
}

/**
 * Map a carrier tracking code to a site OrderStatus.
 * Pochta is intentionally omitted until Tracking API is wired.
 */
export function orderStatusFromCarrierCode(
  deliveryCode: DeliveryMethodCode,
  carrierStatusCode: string | null | undefined,
): OrderStatus | null {
  const code = carrierStatusCode?.trim();
  if (!code) return null;

  if (deliveryCode === DeliveryMethodCode.CDEK) {
    return mapCdek(code);
  }
  if (deliveryCode === DeliveryMethodCode.YANDEX) {
    return mapYandex(code);
  }
  return null;
}

/**
 * Desired status after a carrier poll: upgrade-only, never touches
 * CANCELLED / ARCHIVED / unknown ranks.
 */
export function resolveOrderStatusAfterCarrier(
  current: OrderStatus,
  deliveryCode: DeliveryMethodCode,
  carrierStatusCode: string | null | undefined,
): OrderStatus | null {
  const mapped = orderStatusFromCarrierCode(deliveryCode, carrierStatusCode);
  if (!mapped) return null;
  if (!isOrderStatusUpgrade(current, mapped)) return null;
  return mapped;
}

const CDEK_DONE = new Set([
  'DELIVERED',
  'POSTOMAT_RECEIVED',
]);

const CDEK_READY = new Set([
  'ACCEPTED_AT_PICK_UP_POINT',
  'READY_FOR_RECIPIENT_CITY_DELIVERY',
  'POSTOMAT_POSTED',
  'ACCEPTED_AT_WAREHOUSE_ON_DEMAND',
  'ENTERED_TO_WAREHOUSE_ON_DEMAND',
]);

const CDEK_SHIPPED = new Set([
  'READY_FOR_SHIPMENT_IN_SENDER_CITY',
  'READY_TO_SHIP_AT_SENDING_OFFICE',
  'READY_TO_SHIP_IN_TRANSIT_OFFICE',
  'TAKEN_BY_TRANSPORTER_FROM_SENDER_CITY',
  'TAKEN_BY_TRANSPORTER_FROM_TRANSIT_CITY',
  'SENT_TO_TRANSIT_CITY',
  'SENT_TO_TRANSIT_OFFICE',
  'SENT_TO_RECIPIENT_CITY',
  'SENT_TO_RECIPIENT_OFFICE',
  'SENT_TO_SENDING_OFFICE',
  'ARRIVED_AT_TRANSIT_CITY',
  'ARRIVED_AT_RECIPIENT_CITY',
  'ACCEPTED_IN_TRANSIT_CITY',
  'ACCEPTED_IN_RECIPIENT_CITY',
  'ACCEPTED_AT_TRANSIT_WAREHOUSE',
  'ACCEPTED_TO_OFFICE_TRANSIT_WAREHOUSE',
  'ACCEPTED_AT_DELIVERY_WAREHOUSE',
  'ENTERED_TO_OFFICE_TRANSIT_WAREHOUSE',
  'ENTERED_TO_DELIVERY_WAREHOUSE',
  'PASSED_TO_CARRIER_AT_SENDING_OFFICE',
  'PASSED_TO_CARRIER_AT_TRANSIT_OFFICE',
  'PASSED_TO_TRANSIT_CARRIER',
  'SHIPPED_TO_DESTINATION',
  'ISSUED_FOR_DELIVERY',
  'TAKEN_BY_COURIER',
  'MET_AT_TRANSIT_OFFICE',
  'MET_AT_SENDING_OFFICE',
  'MET_AT_RECIPIENT_OFFICE',
  'DELIVERED_SENDER_CITY_CDEK',
]);

/** CDEK: only after the parcel is physically received at the drop-off warehouse. */
const CDEK_CONFIRMED = new Set([
  'RECEIVED_AT_SHIPMENT_WAREHOUSE',
]);

function mapCdek(code: string): OrderStatus | null {
  if (CDEK_DONE.has(code)) return OrderStatus.DONE;
  if (CDEK_READY.has(code)) return OrderStatus.READY_FOR_PICKUP;
  if (CDEK_SHIPPED.has(code)) return OrderStatus.SHIPPED;
  if (CDEK_CONFIRMED.has(code)) return OrderStatus.CONFIRMED;
  // CREATED / ACCEPTED = API booking only — stay on PAID («Собирается»).
  return null;
}

const YANDEX_DONE = new Set([
  'DELIVERY_DELIVERED',
  'DELIVERY_TRANSMITTED_TO_RECIPIENT',
  'PARTICULARLY_DELIVERED',
]);

const YANDEX_READY = new Set([
  'DELIVERY_ARRIVED_PICKUP_POINT',
]);

const YANDEX_SHIPPED = new Set([
  'SORTING_CENTER_TRANSMITTED',
  'SORTING_CENTER_PREPARED',
  'DELIVERY_AT_START',
  'DELIVERY_AT_START_SORT',
  'DELIVERY_TRANSPORTATION',
  'DELIVERY_TRANSPORTATION_RECIPIENT',
  'DELIVERY_ATTEMPT_FAILED',
  'DELIVERY_TIME_INTERVALS_UPDATED',
  'CONFIRMATION_CODE_RECEIVED',
]);

/** Yandex: parcel arrived at / accepted by the sorting center (not just draft created). */
const YANDEX_CONFIRMED = new Set([
  'SORTING_CENTER_LOADED',
  'SORTING_CENTER_AT_START',
]);

function mapYandex(code: string): OrderStatus | null {
  if (YANDEX_DONE.has(code)) return OrderStatus.DONE;
  if (YANDEX_READY.has(code)) return OrderStatus.READY_FOR_PICKUP;
  if (YANDEX_SHIPPED.has(code)) return OrderStatus.SHIPPED;
  if (YANDEX_CONFIRMED.has(code)) return OrderStatus.CONFIRMED;
  // CREATED / DELIVERY_PROCESSING_STARTED = booking — stay on PAID.
  return null;
}
