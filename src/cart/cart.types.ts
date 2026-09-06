export type CartRemovalReason = 'inactive' | 'missing' | 'out_of_stock';

export type CartLineView = {
  productId: string;
  variantId: string;
  name: string;
  image: string;
  weight: string;
  price: number;
  qty: number;
  stock: number;
};

export type CartAdjustments = {
  removed: Array<{ variantId: string; reason: CartRemovalReason }>;
  capped: Array<{ variantId: string; from: number; to: number }>;
};

export type CartResponse = {
  items: CartLineView[];
  adjustments: CartAdjustments;
};

export function emptyAdjustments(): CartAdjustments {
  return { removed: [], capped: [] };
}
