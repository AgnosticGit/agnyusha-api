import {
  extractCityFromAddress,
  moneyRub,
  normalizeOzonPhone,
  normalizeSettlementKey,
  packageDimensionsMm,
  positiveRequestId,
  settlementMatches,
} from '../../src/ozon-delivery/ozon-delivery.util';

describe('ozon-delivery.util', () => {
  it('normalizes RU phones to +7…', () => {
    expect(normalizeOzonPhone('+7 (999) 123-45-67')).toBe('+79991234567');
    expect(normalizeOzonPhone('89991234567')).toBe('+79991234567');
    expect(normalizeOzonPhone('9991234567')).toBe('+79991234567');
    expect(normalizeOzonPhone('123')).toBeNull();
  });

  it('matches settlement against city/address', () => {
    expect(normalizeSettlementKey('г. Санкт-Петербург')).toBe(
      'санкт петербург',
    );
    expect(extractCityFromAddress('Санкт-Петербург, Невский пр., 1')).toBe(
      'Санкт-Петербург',
    );
    expect(
      settlementMatches(
        'Санкт-Петербург',
        'Санкт-Петербург',
        'Санкт-Петербург, Невский пр., 1',
      ),
    ).toBe(true);
    expect(
      settlementMatches('Казань', 'Москва', 'Москва, Тверская 1'),
    ).toBe(false);
  });

  it('builds package dimensions and request id', () => {
    expect(packageDimensionsMm(200).weight_g).toBe(200);
    expect(packageDimensionsMm(50).weight_g).toBe(100);
    expect(positiveRequestId('agny-1')).toBeGreaterThan(0);
    expect(moneyRub(12.5)).toEqual({ amount: '12.50', currency_code: 'RUB' });
  });
});
