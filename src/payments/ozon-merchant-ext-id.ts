/** Ozon Pay `extId` shown in bank as «Оплата по заказу {extId}». */
export function ozonMerchantExtId(orderNumber: number): string {
  return String(orderNumber);
}

/** Parse public order number from Ozon merchant extId (digits only). */
export function parseOzonMerchantOrderNumber(
  extId: string | null | undefined,
): number | null {
  const raw = (extId ?? '').trim();
  if (!/^\d+$/.test(raw)) return null;
  const n = Number.parseInt(raw, 10);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}
