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
          middleName: 'Иванович',
        }),
      ).toBe('Иванов Иван Иванович');
      expect(
        formatPersonName({
          lastName: '  Петров ',
          firstName: null,
          middleName: undefined,
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
