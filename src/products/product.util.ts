export type ProductVariantDto = {
  id?: string;
  sku: string;
  weight: string;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  price: number;
  stock: number;
  sortOrder?: number;
};

const DEFAULT_LENGTH_CM = 20;
const DEFAULT_WIDTH_CM = 15;
const DEFAULT_HEIGHT_CM = 10;

const DEFAULT_PRODUCT_IMAGE = '/assets/product-turkey.png';

function toOptionalString(value: unknown): string | undefined {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed || undefined;
  }
  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }
  return undefined;
}

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
  const cover =
    String(image ?? DEFAULT_PRODUCT_IMAGE).trim() || DEFAULT_PRODUCT_IMAGE;
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

export function parseVariantInputs(raw: unknown): ProductVariantDto[] {
  if (!Array.isArray(raw)) return [];
  const parsed: ProductVariantDto[] = [];
  for (const [index, v] of raw.entries()) {
    if (!v || typeof v !== 'object') continue;
    const row = v as {
      id?: unknown;
      sku?: unknown;
      weight?: unknown;
      weightGrams?: unknown;
      lengthCm?: unknown;
      widthCm?: unknown;
      heightCm?: unknown;
      price?: unknown;
      stock?: unknown;
      sortOrder?: unknown;
    };
    const sku = (toOptionalString(row.sku) ?? '').toUpperCase();
    const weight = toOptionalString(row.weight) ?? '';
    const weightGrams = Math.round(Number(row.weightGrams));
    const lengthCm =
      row.lengthCm == null
        ? DEFAULT_LENGTH_CM
        : Math.round(Number(row.lengthCm));
    const widthCm =
      row.widthCm == null
        ? DEFAULT_WIDTH_CM
        : Math.round(Number(row.widthCm));
    const heightCm =
      row.heightCm == null
        ? DEFAULT_HEIGHT_CM
        : Math.round(Number(row.heightCm));
    const price = Number(row.price);
    const stock = Number(row.stock ?? 0);
    const id = toOptionalString(row.id);
    const sortOrder =
      row.sortOrder != null && Number.isFinite(Number(row.sortOrder))
        ? Math.round(Number(row.sortOrder))
        : index;
    if (!sku || !weight || !Number.isFinite(price) || price < 0) continue;
    if (!Number.isFinite(weightGrams) || weightGrams < 1) continue;
    if (!Number.isFinite(lengthCm) || lengthCm < 1) continue;
    if (!Number.isFinite(widthCm) || widthCm < 1) continue;
    if (!Number.isFinite(heightCm) || heightCm < 1) continue;
    if (!Number.isFinite(stock) || stock < 0) continue;
    parsed.push({
      ...(id ? { id } : {}),
      sku,
      weight,
      weightGrams,
      lengthCm,
      widthCm,
      heightCm,
      price: Math.round(price * 100) / 100,
      stock: Math.round(stock),
      sortOrder,
    });
  }
  return parsed;
}

export function minPrice(variants: Array<{ price: number }>): number {
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
