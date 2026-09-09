import {
  minPrice,
  normalizeProductImages,
  normalizeSlug,
  parseVariantInputs,
  slugify,
} from '../../src/products/product.util';

describe('parseVariantInputs', () => {
  it('parses valid variants with sku and stock', () => {
    const variants = parseVariantInputs([
      {
        sku: ' agn-1 ',
        weight: '1 кг.',
        weightGrams: 1000,
        price: 500.6,
        stock: 3.2,
        id: 'v1',
      },
      {
        sku: 'agn-2',
        weight: '2 кг.',
        weightGrams: 2000,
        price: 900,
        stock: 0,
      },
    ]);

    expect(variants).toEqual([
      {
        id: 'v1',
        sku: 'AGN-1',
        weight: '1 кг.',
        weightGrams: 1000,
        price: 500.6,
        stock: 3,
        sortOrder: 0,
      },
      {
        sku: 'AGN-2',
        weight: '2 кг.',
        weightGrams: 2000,
        price: 900,
        stock: 0,
        sortOrder: 1,
      },
    ]);
  });

  it('skips invalid rows (missing sku/weight/weightGrams, bad price/stock)', () => {
    const variants = parseVariantInputs([
      null,
      { weight: '1 кг.', weightGrams: 1000, price: 100, stock: 1 },
      { sku: 'OK-1', weight: '', weightGrams: 1000, price: 100, stock: 1 },
      { sku: 'OK-2', weight: '1 кг.', weightGrams: 1000, price: -1, stock: 1 },
      {
        sku: 'OK-3',
        weight: '1 кг.',
        weightGrams: 1000,
        price: 100,
        stock: -5,
      },
      { sku: 'OK-0G', weight: '1 кг.', weightGrams: 0, price: 100, stock: 2 },
      { sku: 'OK-4', weight: '1 кг.', weightGrams: 1000, price: 100, stock: 2 },
    ]);

    expect(variants).toEqual([
      {
        sku: 'OK-4',
        weight: '1 кг.',
        weightGrams: 1000,
        price: 100,
        stock: 2,
        sortOrder: 6,
      },
    ]);
  });

  it('returns empty array for non-array input', () => {
    expect(parseVariantInputs(null)).toEqual([]);
    expect(parseVariantInputs({})).toEqual([]);
  });

  it('honors explicit sortOrder when provided', () => {
    const variants = parseVariantInputs([
      {
        sku: 'A',
        weight: '1 кг.',
        weightGrams: 1000,
        price: 10,
        stock: 1,
        sortOrder: 5,
      },
    ]);
    expect(variants[0].sortOrder).toBe(5);
  });
});

describe('normalizeProductImages', () => {
  it('prefers gallery and uses first as cover', () => {
    expect(normalizeProductImages(['/a.png', '/b.png'], '/legacy.png')).toEqual(
      {
        images: ['/a.png', '/b.png'],
        image: '/a.png',
      },
    );
  });

  it('falls back to cover image or default product image', () => {
    expect(normalizeProductImages(null, '/legacy.png')).toEqual({
      image: '/legacy.png',
      images: ['/legacy.png'],
    });
    expect(normalizeProductImages([], null)).toEqual({
      image: '/assets/product-turkey.png',
      images: ['/assets/product-turkey.png'],
    });
    expect(normalizeProductImages(['', '  '], '  ')).toEqual({
      image: '/assets/product-turkey.png',
      images: ['/assets/product-turkey.png'],
    });
  });
});

describe('minPrice', () => {
  it('returns 0 for empty and min otherwise', () => {
    expect(minPrice([])).toBe(0);
    expect(minPrice([{ price: 300 }, { price: 120 }])).toBe(120);
  });
});

describe('slugify', () => {
  it('transliterates Cyrillic and strips punctuation', () => {
    expect(slugify('Корм Индейка')).toMatch(/korm-indeyka/);
    expect(slugify('  Hello!!! World  ')).toBe('hello-world');
  });

  it('falls back when input is empty after slugify', () => {
    const slug = slugify('!!!');
    expect(slug).toMatch(/^product-\d+$/);
  });
});

describe('normalizeSlug', () => {
  it('decodes URI encoding (including double-encoding)', () => {
    expect(normalizeSlug('korm')).toBe('korm');
    expect(normalizeSlug('%D0%BA%D0%BE%D1%80%D0%BC')).toBe('корм');
    expect(normalizeSlug('%25D0%25BA')).toBe('к');
  });

  it('stops on invalid sequences', () => {
    expect(normalizeSlug('%E0%A4%A')).toBe('%E0%A4%A');
  });
});
