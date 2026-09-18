import type { INestApplication } from '@nestjs/common';
import { testStorePickupAt } from './helpers/pickup-slot';
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
        storePickupAt: testStorePickupAt(),
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
        storePickupAt: testStorePickupAt(),
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
      // With a valid notification secret, payload status is trusted.
      await request(created.app.getHttpServer())
        .post('/api/payments/ozon/webhook')
        .set('x-o3-trace', 'trace-missing-ext')
        .set('x-ozon-notification-secret', 'test-notify-secret')
        .send({
          id: 'ozon-pay-only-id',
          status: 'Completed',
        })
        .expect(200);

      const paid = await prisma.order.findUnique({ where: { id: order.id } });
      expect(paid?.status).toBe('PAID');
      expect(paid?.paidAt).toBeTruthy();
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
        storePickupAt: testStorePickupAt(),
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
        .set('x-ozon-notification-secret', 'test-notify-secret')
        .send({
          orderID: '01a08802-365e-7678-a56c-6698bce490d9',
          extOrderID: order.id,
          transactionID: 'tx-1',
          status: 'Completed',
          operationType: 'Payment',
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
    let capturedExtId: string | null = null;
    global.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('/createOrder')) {
        const body = JSON.parse(String(init?.body ?? '{}')) as {
          extId: string;
        };
        capturedExtId = body.extId;
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
        storePickupAt: testStorePickupAt(),
          items: [
            {
              variantId: product.variants[0].id,
              qty: 1,
            },
          ],
        privacyConsent: true,
      })
        .expect(201);

      expect(order.body.payUrl).toBe(
        'https://checkout.ozon.ru/order/ozon-payment-1',
      );
      expect(order.body.paymentExternalId).toBe('ozon-payment-1');
      expect(capturedExtId).toBe(String(order.body.number));
      expect(sent).toHaveLength(0);

      await prisma.siteSetting.upsert({
        where: { key: 'site' },
        create: {
          key: 'site',
          value: { paidOrderNotifyEmails: ['shop@example.com'] },
        },
        update: {
          value: { paidOrderNotifyEmails: ['shop@example.com'] },
        },
      });

      await request(created.app.getHttpServer())
        .post('/api/payments/ozon/webhook')
        .send({
          order: {
            id: 'ozon-payment-1',
            extId: String(order.body.number),
            status: 'STATUS_PAID',
          },
        })
        .expect(200);

      const paid = await prisma.order.findUnique({
        where: { id: order.body.id },
      });
      expect(paid?.status).toBe('PAID');
      expect(paid?.paidAt).toBeTruthy();

      expect(sent).toHaveLength(2);
      expect(sent[0].to).toBe('buyer@example.com');
      expect(sent[0].text).toContain('оплачен');
      expect(sent[0].text).toContain('Ozon Pay feed');
      expect(sent[0].html).toContain('cid:');
      expect(sent[0].attachments?.length).toBeGreaterThan(0);
      expect(sent[0].html).toContain('войдите на сайте');
      expect(sent[1].to).toBe('shop@example.com');
      expect(sent[1].subject).toContain(String(order.body.number));
      expect(sent[1].text).toContain('buyer@example.com');
      expect(sent[1].text).toContain('/admin/orders');
    } finally {
      global.fetch = originalFetch;
      delete process.env.OZON_PAY_ACCESS_KEY;
      await created.app.close();
    }
  });

  it('create order returns 400 when Ozon Pay fetch times out', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/createOrder')) {
        const err = new TypeError('fetch failed');
        Object.assign(err, {
          cause: Object.assign(new Error('Connect Timeout Error'), {
            code: 'UND_ERR_CONNECT_TIMEOUT',
            name: 'ConnectTimeoutError',
          }),
        });
        throw err;
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
      const product = await prisma.product.create({
        data: {
          slug: `ozon-timeout-${Date.now()}`,
          name: 'Ozon timeout feed',
          image: '/assets/product-turkey.png',
          category: 'DOGS',
          variants: {
            create: [
              {
                sku: `OZON-TO-${Date.now()}`,
                weight: '1 кг.',
                weightGrams: 1000,
                price: 100,
                stock: 5,
              },
            ],
          },
        },
        include: { variants: true },
      });

      const beforeCount = await prisma.order.count({
        where: { email: 'ozon-timeout@example.com' },
      });

      const res = await request(created.app.getHttpServer())
        .post('/api/orders')
        .send({
          email: 'ozon-timeout@example.com',
          lastName: 'Иванов',
          firstName: 'Иван',
          phone: '+7 (999) 111-22-44',
          contactChannel: 'Telegram',
          cityLabel: 'Санкт-Петербург',
          deliveryCode: 'PICKUP',
          deliveryTitle: 'Самовывоз',
        storePickupAt: testStorePickupAt(),
          items: [
            {
              variantId: product.variants[0].id,
              qty: 1,
            },
          ],
        privacyConsent: true,
      })
        .expect(400);

      expect(res.body.message).toMatch(/Ozon Pay/i);

      const afterCount = await prisma.order.count({
        where: { email: 'ozon-timeout@example.com' },
      });
      expect(afterCount).toBe(beforeCount);
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
        storePickupAt: testStorePickupAt(),
          items: [{ variantId: product.variants[0].id, qty: 1 }],
        privacyConsent: true,
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
        storePickupAt: testStorePickupAt(),
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

  it('rejects webhook when notification secret is wrong', async () => {
    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      ozonNotificationSecret: 'correct-secret',
    });
    try {
      await request(created.app.getHttpServer())
        .post('/api/payments/ozon/webhook')
        .set('x-ozon-notification-secret', 'wrong-secret')
        .send({ extId: 'order-wrong-secret', status: 'STATUS_PAID' })
        .expect(401);
    } finally {
      await created.app.close();
    }
  });

  it('does not trust forged STATUS_PAID when unsigned; requires API confirm', async () => {
    const originalFetch = global.fetch;
    global.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/getOrderDetails')) {
        return new Response(
          JSON.stringify({
            item: { id: 'ozon-unpaid', status: 'STATUS_AUTHORIZED' },
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
          email: 'forge-paid@example.com',
          phone: '+79990001166',
          lastName: 'Тест',
          firstName: 'Подделка',
          contactChannel: 'Telegram',
          cityLabel: 'Санкт-Петербург',
          deliveryCode: 'PICKUP',
          deliveryTitle: 'Самовывоз',
        storePickupAt: testStorePickupAt(),
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

      await request(created.app.getHttpServer())
        .post('/api/payments/ozon/webhook')
        .set('x-o3-trace', 'trace-forge')
        .send({
          extId: order.id,
          status: 'STATUS_PAID',
          id: 'ozon-unpaid',
        })
        .expect(200);

      const after = await prisma.order.findUnique({ where: { id: order.id } });
      expect(after?.status).toBe('NEW');
      expect(after?.paidAt).toBeNull();

      await prisma.order.delete({ where: { id: order.id } });
    } finally {
      global.fetch = originalFetch;
      await created.app.close();
    }
  });

  it('does not revive CANCELLED order to PAID or create shipment', async () => {
    const originalFetch = global.fetch;
    global.fetch = async () => {
      throw new Error('Ozon API must not be called for cancelled order auth match');
    };

    const created = await createTestApp({
      cdek: 'present',
      yandex: 'missing',
      ozon: 'present',
      ozonNotificationSecret: 'test-notify-secret',
    });
    const prisma = created.app.get(PrismaService);

    try {
      await ensureDeliveryMethods(created.app);
      const order = await prisma.order.create({
        data: {
          email: 'cancelled-pay@example.com',
          phone: '+79990001155',
          lastName: 'Тест',
          firstName: 'Отмена',
          contactChannel: 'Telegram',
          cityLabel: 'Санкт-Петербург',
          deliveryCode: 'CDEK',
          deliveryTitle: 'СДЭК',
          pickupCode: 'MSK65',
          status: 'CANCELLED',
          total: 100,
          paymentExternalId: 'ozon-cancelled-1',
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
        .set('x-ozon-notification-secret', 'test-notify-secret')
        .send({
          extId: order.id,
          status: 'STATUS_PAID',
          id: 'ozon-cancelled-1',
        })
        .expect(200);

      const after = await prisma.order.findUnique({ where: { id: order.id } });
      expect(after?.status).toBe('CANCELLED');
      expect(after?.externalDeliveryId).toBeNull();
      expect(after?.paidAt).toBeNull();
      expect(after?.paymentExternalId).toBe('ozon-cancelled-1');

      await prisma.order.delete({ where: { id: order.id } });
    } finally {
      global.fetch = originalFetch;
      await created.app.close();
    }
  });

  it('confirm endpoint does not revive CANCELLED even if Ozon reports PAID', async () => {
    const originalFetch = global.fetch;
    let getOrderDetailsCalls = 0;
    global.fetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/getOrderDetails')) {
        getOrderDetailsCalls += 1;
        return new Response(
          JSON.stringify({
            item: {
              id: 'ozon-cancelled-confirm',
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
      cdek: 'present',
      yandex: 'missing',
      ozon: 'present',
    });
    const prisma = created.app.get(PrismaService);

    try {
      await ensureDeliveryMethods(created.app);
      const order = await prisma.order.create({
        data: {
          email: 'cancelled-confirm@example.com',
          phone: '+79990001156',
          lastName: 'Тест',
          firstName: 'Отмена',
          contactChannel: 'Telegram',
          cityLabel: 'Санкт-Петербург',
          deliveryCode: 'CDEK',
          deliveryTitle: 'СДЭК',
          pickupCode: 'MSK65',
          status: 'CANCELLED',
          total: 100,
          paymentExternalId: 'ozon-cancelled-confirm',
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

      const res = await request(created.app.getHttpServer())
        .post('/api/payments/ozon/confirm')
        .send({ orderId: order.id })
        .expect(200);

      expect(res.body).toEqual({
        status: 'CANCELLED',
        paid: false,
        number: order.number,
      });
      expect(getOrderDetailsCalls).toBe(0);

      const after = await prisma.order.findUnique({ where: { id: order.id } });
      expect(after?.status).toBe('CANCELLED');
      expect(after?.paidAt).toBeNull();
      expect(after?.externalDeliveryId).toBeNull();

      await prisma.order.delete({ where: { id: order.id } });
    } finally {
      global.fetch = originalFetch;
      delete process.env.OZON_PAY_ACCESS_KEY;
      await created.app.close();
    }
  });
});
