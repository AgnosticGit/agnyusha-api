import {
  assertPromoUsable,
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

  describe('assertPromoUsable', () => {
    const base = {
      isActive: true,
      startsAt: null as Date | null,
      endsAt: null as Date | null,
      maxRedemptions: null as number | null,
      redemptionCount: 0,
    };
    const now = new Date('2026-06-15T12:00:00.000Z');

    it('allows an active unlimited promo', () => {
      expect(() => assertPromoUsable(base, now)).not.toThrow();
    });

    it('rejects inactive', () => {
      expect(() =>
        assertPromoUsable({ ...base, isActive: false }, now),
      ).toThrow('Промокод неактивен');
    });

    it('rejects before startsAt', () => {
      expect(() =>
        assertPromoUsable(
          { ...base, startsAt: new Date('2026-07-01T00:00:00.000Z') },
          now,
        ),
      ).toThrow('Промокод ещё не действует');
    });

    it('rejects after endsAt', () => {
      expect(() =>
        assertPromoUsable(
          { ...base, endsAt: new Date('2026-05-01T00:00:00.000Z') },
          now,
        ),
      ).toThrow('Срок действия промокода истёк');
    });

    it('rejects when redemption limit is exhausted', () => {
      expect(() =>
        assertPromoUsable(
          { ...base, maxRedemptions: 3, redemptionCount: 3 },
          now,
        ),
      ).toThrow('Лимит использований исчерпан');
    });
  });
});
