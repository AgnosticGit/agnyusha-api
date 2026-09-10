import { cdekTrackingUrl } from '../../src/cdek/cdek.service';

describe('cdekTrackingUrl', () => {
  it('builds tracking URL with encoded order id', () => {
    expect(cdekTrackingUrl('ABC 123')).toBe(
      'https://www.cdek.ru/ru/tracking?order_id=ABC%20123',
    );
  });
});
