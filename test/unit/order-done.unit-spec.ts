import {
  buildOrderDoneMail,
  buildOrderReadyForPickupMail,
} from '../../src/mail/order-done';

describe('buildOrderReadyForPickupMail', () => {
  it('includes order number and pickup place', () => {
    const mail = buildOrderReadyForPickupMail({
      orderNumber: 10042,
      webOrigin: 'http://localhost:3000',
      pickupLabel: 'ПВЗ на Невском',
      deliveryTitle: 'СДЭК',
      cityLabel: 'Санкт-Петербург',
    });
    expect(mail.subject).toContain('10042');
    expect(mail.subject).toMatch(/забирать/i);
    expect(mail.html).toContain('ПВЗ на Невском');
    expect(mail.html).toContain('/account');
    expect(mail.text).toContain('10042');
  });
});

describe('buildOrderDoneMail', () => {
  it('marks order as received', () => {
    const mail = buildOrderDoneMail({
      orderNumber: 10042,
      webOrigin: 'http://localhost:3000',
      pickupLabel: 'ПВЗ на Невском',
      deliveryTitle: 'СДЭК',
      cityLabel: 'Санкт-Петербург',
    });
    expect(mail.subject).toContain('10042');
    expect(mail.subject).toMatch(/получен/i);
    expect(mail.html).toMatch(/получен/i);
    expect(mail.text).toContain('10042');
  });
});
