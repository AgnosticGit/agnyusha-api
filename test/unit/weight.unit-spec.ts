import {
  estimateWeightGrams,
  resolveWeightGrams,
} from '../../src/common/weight';

describe('weight', () => {
  describe('estimateWeightGrams', () => {
    it('parses kg labels (comma decimal)', () => {
      expect(estimateWeightGrams('0,8 кг.')).toBe(800);
      expect(estimateWeightGrams('2 кг')).toBe(2000);
      expect(estimateWeightGrams('1.5 kg')).toBe(1500);
    });

    it('parses gram labels with a 100g floor', () => {
      expect(estimateWeightGrams('250 г')).toBe(250);
      expect(estimateWeightGrams('50 g')).toBe(100);
      expect(estimateWeightGrams('80г')).toBe(100);
    });

    it('falls back to 800 for unparseable or non-positive values', () => {
      expect(estimateWeightGrams('нет веса')).toBe(800);
      expect(estimateWeightGrams('0 кг')).toBe(800);
      // Leading minus is ignored by the number match; "1" → 1000g
      expect(estimateWeightGrams('-1 кг')).toBe(1000);
    });
  });

  describe('resolveWeightGrams', () => {
    it('prefers explicit positive grams', () => {
      expect(resolveWeightGrams(1250, '1 кг.')).toBe(1250);
      expect(resolveWeightGrams(0.4, '1 кг.')).toBe(1);
    });

    it('falls back to label parsing when grams are missing/invalid', () => {
      expect(resolveWeightGrams(null, '2 кг.')).toBe(2000);
      expect(resolveWeightGrams(undefined, '250 г')).toBe(250);
      expect(resolveWeightGrams(0, '0,8 кг.')).toBe(800);
      expect(resolveWeightGrams(Number.NaN, '1 кг.')).toBe(1000);
    });
  });
});
