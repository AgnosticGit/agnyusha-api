import {
  formatPersonName,
  formatPublicDisplayName,
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

  describe('formatPublicDisplayName', () => {
    it('prefers first+last over email', () => {
      expect(
        formatPublicDisplayName({
          firstName: 'Анна',
          lastName: 'Смирнова',
          email: 'anna@example.com',
        }),
      ).toBe('Анна Смирнова');
    });

    it('uses email local-part when name missing', () => {
      expect(
        formatPublicDisplayName({
          firstName: '',
          lastName: null,
          email: 'buyer@example.com',
        }),
      ).toBe('buyer');
    });

    it('returns null when nothing usable', () => {
      expect(formatPublicDisplayName(null)).toBeNull();
      expect(formatPublicDisplayName({})).toBeNull();
      expect(
        formatPublicDisplayName({ firstName: '  ', email: '  @x' }),
      ).toBeNull();
    });
  });

  describe('normalizeEmail', () => {
    it('trims and lowercases', () => {
      expect(normalizeEmail('  User@Example.COM ')).toBe('user@example.com');
    });
  });
});
