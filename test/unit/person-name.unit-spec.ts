import {
  formatPersonName,
  normalizeEmail,
} from '../../src/common/person-name';

describe('person-name', () => {
  describe('formatPersonName', () => {
    it('joins non-empty parts', () => {
      expect(
        formatPersonName({
          lastName: 'Иванов',
          firstName: 'Иван',
        }),
      ).toBe('Иванов Иван');
      expect(
        formatPersonName({
          lastName: '  Петров ',
          firstName: null,
        }),
      ).toBe('Петров');
    });

    it('falls back to Покупатель when empty', () => {
      expect(formatPersonName({ lastName: '', firstName: '' })).toBe(
        'Покупатель',
      );
      expect(formatPersonName({})).toBe('Покупатель');
    });
  });

  describe('normalizeEmail', () => {
    it('trims and lowercases', () => {
      expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
    });
  });
});
