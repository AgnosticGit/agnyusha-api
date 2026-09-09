import {
  minPrice,
  normalizeProductImages,
  parseVariantInputs,
  slugify,
} from '../src/products/product.util';

describe('parseVariantInputs', () => {
  it('parses valid variants with sku and stock', () => {
    const variants = parseVariantInputs([
      { sku: ' agn-1 ', weight: '1 кг.', weightGrams: 1000, price: 500.6, stock: 3.2, id: 'v1' },
      { sku: 'agn-2', weight: '2 кг.', weightGrams: 2000, price: 900, stock: 0 },
    ]);

    expect(variants).toEqual([
      {
        id: 'v1',
        sku: 'AGN-1',
        weight: '1 кг.', weightGrams: 1000,
        price: 500.6,
        stock: 3,
        sortOrder: 0,
      },
      {
        sku: 'AGN-2',
        weight: '2 кг.', weightGrams: 2000,
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
      { sku: 'OK-3', weight: '1 кг.', weightGrams: 1000, price: 100, stock: -5 },
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
});

describe('product util helpers', () => {
  it('normalizeProductImages prefers gallery', () => {
    expect(
      normalizeProductImages(['/a.png', '/b.png'], '/legacy.png'),
    ).toEqual({
      images: ['/a.png', '/b.png'],
      image: '/a.png',
    });
  });

  it('minPrice and slugify work', () => {
    expect(minPrice([])).toBe(0);
    expect(minPrice([{ price: 300 }, { price: 120 }])).toBe(120);
    expect(slugify('Корм Индейка')).toMatch(/korm-indeyka/);
  });
});
