import {
  ozonMerchantExtId,
  parseOzonMerchantOrderNumber,
} from '../../src/payments/ozon-merchant-ext-id';

describe('ozon-merchant-ext-id', () => {
  it('formats public order number for Ozon extId', () => {
    expect(ozonMerchantExtId(10243)).toBe('10243');
  });

  it('parses numeric merchant extId', () => {
    expect(parseOzonMerchantOrderNumber('10243')).toBe(10243);
    expect(parseOzonMerchantOrderNumber(' 1001 ')).toBe(1001);
  });

  it('rejects cuid / empty / non-positive', () => {
    expect(parseOzonMerchantOrderNumber('cmtypj1rp00037kkw7zbs4tsl')).toBeNull();
    expect(parseOzonMerchantOrderNumber('')).toBeNull();
    expect(parseOzonMerchantOrderNumber('0')).toBeNull();
    expect(parseOzonMerchantOrderNumber('-12')).toBeNull();
  });
});
