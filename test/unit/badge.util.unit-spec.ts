import { ProductBadge } from '@prisma/client';
import {
  BADGE_DEFAULT_COLOR,
  legacyBadgeFields,
  normalizeBadgeColor,
  resolveBadgeRead,
  resolveBadgeWrite,
} from '../../src/products/badge.util';

describe('badge.util', () => {
  describe('normalizeBadgeColor', () => {
    it('expands 3-digit hex and lowercases 6-digit', () => {
      expect(normalizeBadgeColor('#ABC')).toBe('#aabbcc');
      expect(normalizeBadgeColor('#C45C26')).toBe('#c45c26');
      expect(normalizeBadgeColor('  #fff  ')).toBe('#ffffff');
    });

    it('rejects invalid colors', () => {
      expect(normalizeBadgeColor('red')).toBe('');
      expect(normalizeBadgeColor('#gg0000')).toBe('');
      expect(normalizeBadgeColor(null)).toBe('');
      expect(normalizeBadgeColor(undefined)).toBe('');
    });
  });

  describe('legacyBadgeFields', () => {
    it('maps HIT / NEW / SALE / NONE', () => {
      expect(legacyBadgeFields(ProductBadge.HIT, null)).toEqual({
        badgeLabel: 'Хит',
        badgeColor: '#5fa88a',
      });
      expect(legacyBadgeFields(ProductBadge.NEW, null)).toEqual({
        badgeLabel: 'Новинка',
        badgeColor: '#e0f0e8',
      });
      expect(legacyBadgeFields(ProductBadge.SALE, 15)).toEqual({
        badgeLabel: '-15%',
        badgeColor: '#c45c26',
      });
      expect(legacyBadgeFields(ProductBadge.SALE, null)).toEqual({
        badgeLabel: 'Скидка',
        badgeColor: '#c45c26',
      });
      expect(legacyBadgeFields(ProductBadge.NONE, 10)).toEqual({
        badgeLabel: '',
        badgeColor: '',
      });
    });
  });

  describe('resolveBadgeWrite', () => {
    it('keeps custom label/color and clears enum to NONE', () => {
      const custom = resolveBadgeWrite({
        badgeLabel: 'Акция',
        badgeColor: '#c45c26',
      });
      expect(custom.badgeLabel).toBe('Акция');
      expect(custom.badgeColor).toBe('#c45c26');
      expect(custom.badge).toBe(ProductBadge.NONE);
      expect(custom.discountPercent).toBeNull();
    });

    it('fills legacy fields from badge enum when label is empty', () => {
      const hit = resolveBadgeWrite({ badge: ProductBadge.HIT });
      expect(hit.badgeLabel).toBe('Хит');
      expect(hit.badgeColor).toBe('#5fa88a');
      expect(hit.badge).toBe(ProductBadge.HIT);
    });

    it('defaults color when label present without color', () => {
      const result = resolveBadgeWrite({ badgeLabel: 'Хит' });
      expect(result.badgeColor).toBe(BADGE_DEFAULT_COLOR);
      expect(result.badge).toBe(ProductBadge.HIT);
    });

    it('maps sale labels and percent patterns', () => {
      const sale = resolveBadgeWrite({ badgeLabel: 'Скидка' });
      expect(sale.badge).toBe(ProductBadge.SALE);

      const pct = resolveBadgeWrite({ badgeLabel: '-20%' });
      expect(pct.badge).toBe(ProductBadge.SALE);
      expect(pct.discountPercent).toBe(20);
    });

    it('clears everything when label resolves empty', () => {
      const empty = resolveBadgeWrite({
        badgeLabel: '   ',
        badge: ProductBadge.HIT,
        discountPercent: 10,
      });
      // empty label + HIT fills legacy first, so HIT stays
      expect(empty.badgeLabel).toBe('Хит');
      expect(empty.badge).toBe(ProductBadge.HIT);

      const none = resolveBadgeWrite({ badgeLabel: '', badge: ProductBadge.NONE });
      expect(none).toEqual({
        badgeLabel: '',
        badgeColor: '',
        badge: ProductBadge.NONE,
        discountPercent: null,
      });
    });

    it('truncates label and truncates discountPercent', () => {
      const long = 'x'.repeat(40);
      const result = resolveBadgeWrite({
        badgeLabel: long,
        badgeColor: '#112233',
        discountPercent: 12.9,
      });
      expect(result.badgeLabel).toHaveLength(32);
      // custom non-sale label clears discount
      expect(result.discountPercent).toBeNull();

      const sale = resolveBadgeWrite({
        badgeLabel: 'Скидка',
        badgeColor: '#c45c26',
        discountPercent: 12.9,
      });
      expect(sale.discountPercent).toBe(12);
    });
  });

  describe('resolveBadgeRead', () => {
    it('prefers stored label/color', () => {
      expect(
        resolveBadgeRead({
          badge: ProductBadge.NONE,
          badgeLabel: ' Акция ',
          badgeColor: '#ABC',
          discountPercent: null,
        }),
      ).toEqual({ badgeLabel: 'Акция', badgeColor: '#aabbcc' });
    });

    it('falls back to default color when label present but color invalid', () => {
      expect(
        resolveBadgeRead({
          badge: ProductBadge.HIT,
          badgeLabel: 'Хит',
          badgeColor: 'nope',
          discountPercent: null,
        }),
      ).toEqual({ badgeLabel: 'Хит', badgeColor: BADGE_DEFAULT_COLOR });
    });

    it('falls back to legacy fields when label empty', () => {
      expect(
        resolveBadgeRead({
          badge: ProductBadge.NEW,
          badgeLabel: '  ',
          badgeColor: '',
          discountPercent: null,
        }),
      ).toEqual({ badgeLabel: 'Новинка', badgeColor: '#e0f0e8' });
    });
  });
});
