export type PromoType = 'PERCENT' | 'FIXED';

export type PromoLineInput = {
  productId: string;
  price: number;
  qty: number;
};

export type PromoDefinition = {
  type: PromoType;
  value: number;
  appliesToAllProducts: boolean;
  productIds: string[];
};

export function normalizePromoCode(code: string): string {
  return code.trim().toUpperCase();
}

/** Discount applied only to eligible lines; never exceeds eligible subtotal. */
export function computePromoDiscount(
  promo: PromoDefinition,
  lines: PromoLineInput[],
): { discountAmount: number; eligibleSubtotal: number; subtotal: number } {
  const subtotal = lines.reduce((s, l) => s + l.price * l.qty, 0);
  const eligible = lines.filter(
    (l) =>
      promo.appliesToAllProducts || promo.productIds.includes(l.productId),
  );
  const eligibleSubtotal = eligible.reduce((s, l) => s + l.price * l.qty, 0);
  if (eligibleSubtotal <= 0) {
    return { discountAmount: 0, eligibleSubtotal: 0, subtotal };
  }

  let discount = 0;
  if (promo.type === 'PERCENT') {
    const pct = Math.min(100, Math.max(0, promo.value));
    discount = (eligibleSubtotal * pct) / 100;
  } else {
    discount = Math.min(eligibleSubtotal, Math.max(0, promo.value));
  }
  discount = Math.round(discount * 100) / 100;
  return { discountAmount: discount, eligibleSubtotal, subtotal };
}
