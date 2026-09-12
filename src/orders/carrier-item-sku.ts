/** Prefer readable ProductVariant.sku for carrier article / ware_key. */
export function carrierItemSku(input: {
  sku?: string | null;
  variantId?: string | null;
  id?: string | null;
}): string {
  const sku = input.sku?.trim();
  if (sku) return sku;
  const fallback = (input.variantId || input.id || 'item').trim();
  return fallback || 'item';
}
