export type ProductVariantDto = {
  weight: string;
  price: number;
};

export function parseVariants(raw: unknown): ProductVariantDto[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .map((v) => {
      if (!v || typeof v !== 'object') return null;
      const weight = String((v as { weight?: unknown }).weight ?? '').trim();
      const price = Number((v as { price?: unknown }).price);
      if (!weight || !Number.isFinite(price) || price < 0) return null;
      return { weight, price: Math.round(price) };
    })
    .filter((v): v is ProductVariantDto => v !== null);
}

export function minPrice(variants: ProductVariantDto[]): number {
  if (!variants.length) return 0;
  return Math.min(...variants.map((v) => v.price));
}

export function slugify(input: string): string {
  return input
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9а-яё]+/gi, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80) || `product-${Date.now()}`;
}
