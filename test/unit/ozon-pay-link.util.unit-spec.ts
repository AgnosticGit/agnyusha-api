import { isAllowedOzonPayLink } from '../../src/payments/ozon-pay-link.util';

describe('isAllowedOzonPayLink', () => {
  it('allows https Ozon hosts', () => {
    expect(isAllowedOzonPayLink('https://checkout.ozon.ru/order/1')).toBe(true);
    expect(isAllowedOzonPayLink('https://pay.ozon.ru/x')).toBe(true);
  });

  it('rejects unsafe URLs', () => {
    expect(isAllowedOzonPayLink('http://checkout.ozon.ru/x')).toBe(false);
    expect(isAllowedOzonPayLink('https://evil.example/x')).toBe(false);
    expect(isAllowedOzonPayLink('https://ozon.ru.evil.com/x')).toBe(false);
    expect(isAllowedOzonPayLink('not-a-url')).toBe(false);
  });
});
