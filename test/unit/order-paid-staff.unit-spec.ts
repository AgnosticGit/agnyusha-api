import { buildPaidOrderStaffNotifyMail } from '../../src/mail/order-paid-staff';

describe('buildPaidOrderStaffNotifyMail', () => {
  it('includes order number and admin link', () => {
    const mail = buildPaidOrderStaffNotifyMail({
      orderNumber: 10042,
      total: 1500,
      customerEmail: 'buyer@example.com',
      customerName: 'Иванов Иван',
      phone: '+79991234567',
      deliveryTitle: 'СДЭК',
      cityLabel: 'Санкт-Петербург',
      webOrigin: 'https://agnyusha.ru/',
      items: [
        { productName: 'Индейка', weight: '1 кг.', qty: 2, price: 750 },
      ],
    });
    expect(mail.subject).toContain('10042');
    expect(mail.text).toContain('buyer@example.com');
    expect(mail.text).toContain('https://agnyusha.ru/admin/orders');
    expect(mail.html).toContain('Индейка');
    expect(mail.html).toContain('/admin/orders');
  });
});
