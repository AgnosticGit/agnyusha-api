export type ProductVariantDto = {
  weight: string;
  price: number;
};

const DEFAULT_PRODUCT_IMAGE = '/assets/product-turkey.png';

/** Normalize cover + gallery; cover is always images[0]. */
export function normalizeProductImages(
  images?: string[] | null,
  image?: string | null,
): { image: string; images: string[] } {
  const fromGallery = (images ?? [])
    .map((item) => String(item ?? '').trim())
    .filter(Boolean);
  if (fromGallery.length) {
    return { images: fromGallery, image: fromGallery[0] };
  }
  const cover = String(image ?? DEFAULT_PRODUCT_IMAGE).trim() || DEFAULT_PRODUCT_IMAGE;
  return { image: cover, images: [cover] };
}

const CYR_TO_LAT: Record<string, string> = {
  а: 'a',
  б: 'b',
  в: 'v',
  г: 'g',
  д: 'd',
  е: 'e',
  ё: 'yo',
  ж: 'zh',
  з: 'z',
  и: 'i',
  й: 'y',
  к: 'k',
  л: 'l',
  м: 'm',
  н: 'n',
  о: 'o',
  п: 'p',
  р: 'r',
  с: 's',
  т: 't',
  у: 'u',
  ф: 'f',
  х: 'h',
  ц: 'ts',
  ч: 'ch',
  ш: 'sh',
  щ: 'sch',
  ъ: '',
  ы: 'y',
  ь: '',
  э: 'e',
  ю: 'yu',
  я: 'ya',
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

/** Decode URI slug safely (handles accidental double-encoding). */
export function normalizeSlug(slug: string): string {
  let current = slug.trim();
  for (let i = 0; i < 3; i += 1) {
    try {
      const next = decodeURIComponent(current);
      if (next === current) break;
      current = next;
    } catch {
      break;
    }
  }
  return current;
}

export function slugify(input: string): string {
  const transliterated = input
    .trim()
    .toLowerCase()
    .split('')
    .map((ch) => CYR_TO_LAT[ch] ?? ch)
    .join('');

  return (
    transliterated
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 80) || `product-${Date.now()}`
  );
}
