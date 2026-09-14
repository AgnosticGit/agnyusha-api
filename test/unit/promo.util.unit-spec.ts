import {
  computePromoDiscount,
  normalizePromoCode,
} from '../../src/promos/promo.util';

describe('promo.util', () => {
  it('normalizes code', () => {
    expect(normalizePromoCode('  sale10 ')).toBe('SALE10');
  });

  it('applies percent only to eligible products', () => {
    const calc = computePromoDiscount(
      {
        type: 'PERCENT',
        value: 10,
        appliesToAllProducts: false,
        productIds: ['a'],
      },
      [
        { productId: 'a', price: 1000, qty: 1 },
        { productId: 'b', price: 500, qty: 2 },
      ],
    );
    expect(calc.subtotal).toBe(2000);
    expect(calc.eligibleSubtotal).toBe(1000);
    expect(calc.discountAmount).toBe(100);
  });

  it('caps fixed discount at eligible subtotal', () => {
    const calc = computePromoDiscount(
      {
        type: 'FIXED',
        value: 9999,
        appliesToAllProducts: true,
        productIds: [],
      },
      [{ productId: 'a', price: 100, qty: 2 }],
    );
    expect(calc.discountAmount).toBe(200);
  });
});
