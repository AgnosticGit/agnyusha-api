import { buildOrderDoneMail } from '../../src/mail/order-done';

describe('buildOrderDoneMail', () => {
  it('includes order number and pickup place', () => {
    const mail = buildOrderDoneMail({
      orderNumber: 10042,
      webOrigin: 'http://localhost:3000',
      pickupLabel: 'ПВЗ на Невском',
      deliveryTitle: 'СДЭК',
      cityLabel: 'Санкт-Петербург',
    });
    expect(mail.subject).toContain('10042');
    expect(mail.html).toContain('ПВЗ на Невском');
    expect(mail.html).toContain('/account');
    expect(mail.text).toContain('10042');
  });
});
