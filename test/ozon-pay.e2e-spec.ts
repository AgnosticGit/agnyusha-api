import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import {
  createTestApp,
  ensureDeliveryMethods,
} from './helpers/cdek-test.helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createRawToken,
  hashToken,
  SESSION_COOKIE,
} from '../src/auth/auth.crypto';

describe('Ozon Pay (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    delete process.env.OZON_PAY_NOTIFICATION_SECRET;
    const created = await createTestApp({ cdek: 'missing', yandex: 'missing' });
    app = created.app;
    await ensureDeliveryMethods(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('accepts notification without secret configured', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/payments/ozon/webhook')
      .send({
        extId: 'order-test-1',
        status: 'STATUS_PAID',
      })
      .expect(200);

    expect(res.body).toEqual({ ok: true });
  });

  it('rejects when notification secret is set and missing', async () => {
    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      ozonNotificationSecret: 'test-notify-secret',
    });
    try {
      await request(created.app.getHttpServer())
        .post('/api/payments/ozon/webhook')
        .send({ extId: 'order-test-2', status: 'STATUS_PAID' })
        .expect(401);

      await request(created.app.getHttpServer())
        .post('/api/payments/ozon/webhook')
        .set('x-ozon-notification-secret', 'test-notify-secret')
        .send({ extId: 'order-test-2', status: 'STATUS_PAID' })
        .expect(200);
    } finally {
      await created.app.close();
    }
  });

  it('accepts unsigned webhook when Ozon API confirms PAID', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/getOrderDetails')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          extId?: string;
        };
        return new Response(
          JSON.stringify({
            item: {
              id: 'ozon-api-1',
              extId: body.extId,
              status: 'STATUS_PAID',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      ozon: 'present',
      ozonNotificationSecret: 'test-notify-secret',
    });
    const prisma = created.app.get(PrismaService);

    try {
      await ensureDeliveryMethods(created.app);
      const product = await prisma.product.create({
        data: {
          slug: `ozon-unsigned-${Date.now()}`,
          name: 'Unsigned webhook',
          image: '/assets/product-turkey.png',
          category: 'DOGS',
          variants: {
            create: [
              {
                sku: `OZUN-${Date.now()}`,
                weight: '1 кг.',
                weightGrams: 1000,
                price: 100,
                stock: 2,
              },
            ],
          },
        },
        include: { variants: true },
      });
      const order = await prisma.order.create({
        data: {
          email: 'unsigned@example.com',
          phone: '+79990001122',
          lastName: 'Тест',
          firstName: 'Озон',
          contactChannel: 'Telegram',
          cityLabel: 'Санкт-Петербург',
          deliveryCode: 'PICKUP',
          deliveryTitle: 'Самовывоз',
          total: 100,
          items: {
            create: [
              {
                productId: product.id,
                variantId: product.variants[0].id,
                productName: product.name,
                image: product.image,
                weight: '1 кг.',
                weightGrams: 1000,
                price: 100,
                qty: 1,
              },
            ],
          },
        },
      });

      await request(created.app.getHttpServer())
        .post('/api/payments/ozon/webhook')
        .set('x-o3-trace', 'trace-1')
        .send({
          order: {
            id: 'ozon-api-1',
            extId: order.id,
            status: 'Completed',
          },
        })
        .expect(200);

      const paid = await prisma.order.findUnique({ where: { id: order.id } });
      expect(paid?.status).toBe('PAID');
      expect(paid?.paidAt).toBeTruthy();
    } finally {
      global.fetch = originalFetch;
      await created.app.close();
    }
  });

  it('resolves order by Ozon payment id when extId is missing', async () => {
    let getOrderDetailsCalls = 0;
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/getOrderDetails')) {
        getOrderDetailsCalls += 1;
        return new Response(
          JSON.stringify({
            item: { id: 'ozon-by-id', status: 'STATUS_AUTHORIZED' },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      ozon: 'present',
      ozonNotificationSecret: 'test-notify-secret',
    });
    const prisma = created.app.get(PrismaService);

    try {
      await ensureDeliveryMethods(created.app);
      const order = await prisma.order.create({
        data: {
          email: 'by-ozon-id@example.com',
          phone: '+79990001133',
          lastName: 'Тест',
          firstName: 'Озон',
          contactChannel: 'Telegram',
          cityLabel: 'Санкт-Петербург',
          deliveryCode: 'PICKUP',
          deliveryTitle: 'Самовывоз',
          total: 100,
          paymentExternalId: 'ozon-pay-only-id',
          items: {
            create: [
              {
                productName: 'Корм',
                image: '/assets/product-turkey.png',
                weight: '1 кг.',
                weightGrams: 1000,
                price: 100,
                qty: 1,
              },
            ],
          },
        },
      });

      // Real Ozon often sends Completed + their id without our extId.
      await request(created.app.getHttpServer())
        .post('/api/payments/ozon/webhook')
        .set('x-o3-trace', 'trace-missing-ext')
        .send({
          id: 'ozon-pay-only-id',
          status: 'Completed',
        })
        .expect(200);

      const paid = await prisma.order.findUnique({ where: { id: order.id } });
      expect(paid?.status).toBe('PAID');
      expect(paid?.paidAt).toBeTruthy();
      // Webhook status is enough — do not wait on lagging getOrderDetails.
      expect(getOrderDetailsCalls).toBe(0);

      await prisma.order.delete({ where: { id: order.id } });
    } finally {
      global.fetch = originalFetch;
      await created.app.close();
    }
  });

  it('marks PAID from real bank payload (extOrderID + orderID)', async () => {
    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      ozon: 'present',
      ozonNotificationSecret: 'test-notify-secret',
    });
    const prisma = created.app.get(PrismaService);

    try {
      await ensureDeliveryMethods(created.app);
      const order = await prisma.order.create({
        data: {
          email: 'bank-shape@example.com',
          phone: '+79990001144',
          lastName: 'Тест',
          firstName: 'Озон',
          contactChannel: 'Telegram',
          cityLabel: 'Санкт-Петербург',
          deliveryCode: 'PICKUP',
          deliveryTitle: 'Самовывоз',
          total: 100,
          paymentExternalId: '01a08802-365e-7678-a56c-6698bce490d9',
          items: {
            create: [
              {
                productName: 'Корм',
                image: '/assets/product-turkey.png',
                weight: '1 кг.',
                weightGrams: 1000,
                price: 100,
                qty: 1,
              },
            ],
          },
        },
      });

      await request(created.app.getHttpServer())
        .post('/api/payments/ozon/webhook')
        .set('x-o3-trace', 'trace-bank-shape')
        .send({
          orderID: '01a08802-365e-7678-a56c-6698bce490d9',
          extOrderID: order.id,
          transactionID: 'tx-1',
          status: 'Completed',
          operationType: 'Payment',
          requestSign: 'not-the-secret',
        })
        .expect(200);

      const paid = await prisma.order.findUnique({ where: { id: order.id } });
      expect(paid?.status).toBe('PAID');
      expect(paid?.paidAt).toBeTruthy();

      await prisma.order.delete({ where: { id: order.id } });
    } finally {
      await created.app.close();
    }
  });

  it('create order returns payUrl and webhook marks order PAID', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/createOrder')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          extId: string;
        };
        return new Response(
          JSON.stringify({
            order: {
              id: 'ozon-payment-1',
              extId: body.extId,
              payLink: 'https://checkout.ozon.ru/order/ozon-payment-1',
              status: 'STATUS_PAYMENT_PENDING',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    process.env.OZON_PAY_ACCESS_KEY = 'test-access-key';
    process.env.OZON_PAY_NOTIFICATION_SECRET = '';

    const sent: Array<{
      to: string;
      subject: string;
      html: string;
      text: string;
      attachments?: Array<{ contentId?: string }>;
    }> = [];
    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      ozon: 'present',
      mailSend: async (input) => {
        sent.push(input);
      },
    });
    const prisma = created.app.get(PrismaService);

    try {
      await ensureDeliveryMethods(created.app);
      const product = await prisma.product.create({
        data: {
          slug: `ozon-pay-${Date.now()}`,
          name: 'Ozon Pay feed',
          image: '/assets/product-turkey.png',
          category: 'DOGS',
          variants: {
            create: [
              {
                sku: `OZON-${Date.now()}`,
                weight: '1 кг.',
                weightGrams: 1000,
                price: 1,
                stock: 5,
              },
            ],
          },
        },
        include: { variants: true },
      });

      const order = await request(created.app.getHttpServer())
        .post('/api/orders')
        .send({
          email: 'buyer@example.com',
          lastName: 'Иванов',
          firstName: 'Иван',
          phone: '+7 (999) 111-22-33',
          contactChannel: 'Telegram',
          cityLabel: 'Санкт-Петербург',
          deliveryCode: 'PICKUP',
          deliveryTitle: 'Самовывоз',
          items: [
            {
              variantId: product.variants[0].id,
              qty: 1,
            },
          ],
        })
        .expect(201);

      expect(order.body.payUrl).toBe(
        'https://checkout.ozon.ru/order/ozon-payment-1',
      );
      expect(order.body.paymentExternalId).toBe('ozon-payment-1');
      expect(sent).toHaveLength(0);

      await request(created.app.getHttpServer())
        .post('/api/payments/ozon/webhook')
        .send({
          order: {
            id: 'ozon-payment-1',
            extId: order.body.id,
            status: 'STATUS_PAID',
          },
        })
        .expect(200);

      const paid = await prisma.order.findUnique({
        where: { id: order.body.id },
      });
      expect(paid?.status).toBe('PAID');
      expect(paid?.paidAt).toBeTruthy();

      expect(sent).toHaveLength(1);
      expect(sent[0].to).toBe('buyer@example.com');
      expect(sent[0].text).toContain('оплачен');
      expect(sent[0].text).toContain('Ozon Pay feed');
      expect(sent[0].html).toContain('cid:');
      expect(sent[0].attachments?.length).toBeGreaterThan(0);
      expect(sent[0].html).toContain('войдите на сайте');
    } finally {
      global.fetch = originalFetch;
      delete process.env.OZON_PAY_ACCESS_KEY;
      await created.app.close();
    }
  });

  it('paid receipt omits login invite for verified users', async () => {
    const sent: Array<{
      to: string;
      html: string;
      text: string;
      attachments?: Array<{ contentId?: string }>;
    }> = [];
    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      ozon: 'missing',
      mailSend: async (input) => {
        sent.push(input);
      },
    });
    const prisma = created.app.get(PrismaService);

    try {
      await ensureDeliveryMethods(created.app);
      const user = await prisma.user.upsert({
        where: { email: 'verified-receipt@example.com' },
        create: {
          email: 'verified-receipt@example.com',
          role: UserRole.USER,
          emailVerifiedAt: new Date(),
        },
        update: { emailVerifiedAt: new Date() },
      });
      const raw = createRawToken();
      await prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      const product = await prisma.product.create({
        data: {
          slug: `receipt-verified-${Date.now()}`,
          name: 'Verified Beef',
          image: '/assets/product-beef.png',
          category: 'DOGS',
          variants: {
            create: [
              {
                sku: `VER-${Date.now()}`,
                weight: '0,5 кг.',
                weightGrams: 500,
                price: 400,
                stock: 3,
              },
            ],
          },
        },
        include: { variants: true },
      });

      await request(created.app.getHttpServer())
        .post('/api/orders')
        .set('Cookie', `${SESSION_COOKIE}=${raw}`)
        .send({
          email: 'verified-receipt@example.com',
          lastName: 'Петров',
          firstName: 'Пётр',
          phone: '+7 (999) 222-33-44',
          contactChannel: 'Telegram',
          cityLabel: 'Санкт-Петербург',
          deliveryCode: 'PICKUP',
          deliveryTitle: 'Самовывоз',
          items: [{ variantId: product.variants[0].id, qty: 1 }],
        })
        .expect(201);

      expect(sent).toHaveLength(1);
      expect(sent[0].text).toContain('оформлен');
      expect(sent[0].text).toContain('Verified Beef');
      expect(sent[0].html).toContain('cid:');
      expect(sent[0].attachments?.length).toBeGreaterThan(0);
      expect(sent[0].html).not.toContain('войдите на сайте');
    } finally {
      await created.app.close();
    }
  });

  it('confirm endpoint marks PAID via getOrderDetails', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/getOrderDetails')) {
        return new Response(
          JSON.stringify({
            item: {
              id: 'ozon-payment-confirm-1',
              extId: 'will-be-replaced',
              status: 'STATUS_PAID',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    process.env.OZON_PAY_ACCESS_KEY = 'test-access-key';
    process.env.OZON_PAY_NOTIFICATION_SECRET = '';

    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      ozon: 'present',
    });
    const prisma = created.app.get(PrismaService);

    try {
      const order = await prisma.order.create({
        data: {
          email: 'buyer@example.com',
          lastName: 'Иванов',
          firstName: 'Иван',
          status: 'NEW',
          phone: '+79990001122',
          contactChannel: 'telegram',
          cityLabel: 'Москва',
          deliveryCode: 'PICKUP',
          deliveryTitle: 'Самовывоз',
          paymentExternalId: 'ozon-payment-confirm-1',
          total: 1,
        },
      });

      const res = await request(created.app.getHttpServer())
        .post('/api/payments/ozon/confirm')
        .send({ orderId: order.id })
        .expect(200);

      expect(res.body).toEqual({
        status: 'PAID',
        paid: true,
        number: order.number,
      });

      const paid = await prisma.order.findUnique({ where: { id: order.id } });
      expect(paid?.status).toBe('PAID');
      expect(paid?.paidAt).toBeTruthy();
    } finally {
      global.fetch = originalFetch;
      delete process.env.OZON_PAY_ACCESS_KEY;
      await created.app.close();
    }
  });

  it('owner can resume payUrl for unpaid NEW order', async () => {
    process.env.OZON_PAY_ACCESS_KEY = 'test-access-key';
    process.env.OZON_PAY_NOTIFICATION_SECRET = '';

    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      ozon: 'present',
    });
    const prisma = created.app.get(PrismaService);

    try {
      const user = await prisma.user.upsert({
        where: { email: 'resume-pay@example.com' },
        create: { email: 'resume-pay@example.com', role: UserRole.USER },
        update: { role: UserRole.USER },
      });
      const raw = createRawToken();
      await prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      const cookie = `${SESSION_COOKIE}=${raw}`;

      const order = await prisma.order.create({
        data: {
          email: 'buyer@example.com',
          lastName: 'Иванов',
          firstName: 'Иван',
          userId: user.id,
          status: 'NEW',
          phone: '+79990001122',
          contactChannel: 'telegram',
          cityLabel: 'Москва',
          deliveryCode: 'PICKUP',
          deliveryTitle: 'Самовывоз',
          paymentExternalId: 'ozon-resume-1',
          paymentPayLink: 'https://checkout.ozon.ru/order/ozon-resume-1',
          total: 1,
        },
      });

      const list = await request(created.app.getHttpServer())
        .get('/api/orders')
        .set('Cookie', cookie)
        .expect(200);
      expect(list.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            id: order.id,
            payUrl: 'https://checkout.ozon.ru/order/ozon-resume-1',
          }),
        ]),
      );

      const pay = await request(created.app.getHttpServer())
        .post(`/api/orders/${order.id}/pay`)
        .set('Cookie', cookie)
        .expect(200);
      expect(pay.body.payUrl).toBe(
        'https://checkout.ozon.ru/order/ozon-resume-1',
      );
    } finally {
      delete process.env.OZON_PAY_ACCESS_KEY;
      await created.app.close();
    }
  });

  it('reconcile-payments marks unpaid NEW as PAID via Ozon', async () => {
    let getOrderDetailsCalls = 0;
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/getOrderDetails')) {
        getOrderDetailsCalls += 1;
        return new Response(
          JSON.stringify({
            item: {
              id: 'ozon-reconcile-1',
              status: 'STATUS_PAID',
            },
          }),
          { status: 200, headers: { 'Content-Type': 'application/json' } },
        );
      }
      throw new Error(`Unexpected fetch: ${url}`);
    };

    process.env.OZON_PAY_ACCESS_KEY = 'test-access-key';
    process.env.OZON_PAY_NOTIFICATION_SECRET = '';

    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      ozon: 'present',
    });
    const prisma = created.app.get(PrismaService);

    try {
      await ensureDeliveryMethods(created.app);
      const user = await prisma.user.upsert({
        where: { email: 'reconcile-pay@example.com' },
        create: { email: 'reconcile-pay@example.com', role: UserRole.USER },
        update: { role: UserRole.USER },
      });
      const raw = createRawToken();
      await prisma.session.create({
        data: {
          userId: user.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      const cookie = `${SESSION_COOKIE}=${raw}`;

      const order = await prisma.order.create({
        data: {
          email: 'buyer@example.com',
          lastName: 'Иванов',
          firstName: 'Иван',
          userId: user.id,
          status: 'NEW',
          phone: '+79990001122',
          contactChannel: 'telegram',
          cityLabel: 'Москва',
          deliveryCode: 'PICKUP',
          deliveryTitle: 'Самовывоз',
          paymentExternalId: 'ozon-reconcile-1',
          paymentPayLink: 'https://checkout.ozon.ru/order/ozon-reconcile-1',
          total: 100,
          items: {
            create: [
              {
                productName: 'Корм',
                image: '/assets/product-turkey.png',
                weight: '1 кг.',
                weightGrams: 1000,
                price: 100,
                qty: 1,
              },
            ],
          },
        },
      });

      const first = await request(created.app.getHttpServer())
        .post('/api/orders/reconcile-payments')
        .set('Cookie', cookie)
        .expect(200);

      expect(getOrderDetailsCalls).toBe(1);
      expect(first.body.items).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: order.id, status: 'PAID' }),
        ]),
      );

      const paid = await prisma.order.findUnique({ where: { id: order.id } });
      expect(paid?.status).toBe('PAID');
      expect(paid?.paidAt).toBeTruthy();

      // TTL: second call within window should not hit Ozon again.
      const second = await request(created.app.getHttpServer())
        .post('/api/orders/reconcile-payments')
        .set('Cookie', cookie)
        .expect(200);
      expect(getOrderDetailsCalls).toBe(1);
      expect(second.body.items).toEqual([]);

      await prisma.order.delete({ where: { id: order.id } });
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    } finally {
      global.fetch = originalFetch;
      delete process.env.OZON_PAY_ACCESS_KEY;
      await created.app.close();
    }
  });
});
