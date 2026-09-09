import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { DeliveryMethodCode, OrderStatus, UserRole } from '@prisma/client';
import {
  createRawToken,
  hashToken,
  SESSION_COOKIE,
} from '../src/auth/auth.crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createMockCdekFetch,
  createMockYandexFetch,
  createTestApp,
  ensureDeliveryMethods,
  jsonResponse,
} from './helpers/cdek-test.helpers';

describe('Delivery tracking poll (e2e)', () => {
  async function seedUserSession(prisma: PrismaService, email: string) {
    const user = await prisma.user.upsert({
      where: { email },
      create: { email, role: UserRole.USER },
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
    return { user, raw };
  }

  async function seedProduct(prisma: PrismaService, slug: string) {
    return prisma.product.create({
      data: {
        slug,
        name: 'Корм трек',
        image: '/assets/product-turkey.png',
        category: 'DOGS',
        ingredients: 't',
        description: 't',
        variants: {
          create: [
            {
              sku: `TRK-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              weight: '0,8 кг.',
              weightGrams: 800,
              price: 500,
              stock: 10,
            },
          ],
        },
      },
      include: { variants: true },
    });
  }

  it('creates CDEK shipment and syncs tracking on list', async () => {
    let getOrderCalls = 0;
    const mock = createMockCdekFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/v2/oauth/token') && method === 'POST') {
        return jsonResponse({
          access_token: 'mock-access-token',
          token_type: 'bearer',
          expires_in: 3600,
        });
      }

      if (url.includes('/v2/orders') && method === 'POST') {
        return jsonResponse({
          entity: { uuid: 'cdek-uuid-1', cdek_number: '1100654321' },
        });
      }

      if (url.includes('/v2/orders/cdek-uuid-1') && method === 'GET') {
        getOrderCalls += 1;
        return jsonResponse({
          entity: {
            uuid: 'cdek-uuid-1',
            cdek_number: '1100654321',
            statuses: [{ code: 'ACCEPTED', name: 'Принят' }],
          },
        });
      }

      return jsonResponse({ message: `unexpected ${method} ${url}` }, 500);
    });

    const { app } = await createTestApp({
      cdekFetch: mock.fetchMock,
      cdek: 'present',
      yandex: 'missing',
    });
    const prisma = app.get(PrismaService);

    try {
      await ensureDeliveryMethods(app);
      const { user, raw } = await seedUserSession(
        prisma,
        'cdek-track@example.com',
      );
      const product = await seedProduct(prisma, `cdek-track-${Date.now()}`);

      const created = await request(app.getHttpServer())
        .post('/api/orders')
        .set('Cookie', `${SESSION_COOKIE}=${raw}`)
        .send({
          email: 'buyer@example.com',
          lastName: 'Иванов',
          firstName: 'Иван',
          phone: '+7 (900) 111-22-33',
          contactChannel: 'Telegram',
          cityLabel: 'Москва',
          deliveryCode: 'CDEK',
          deliveryTitle: 'СДЭК',
          pickupLabel: 'ПВЗ тест',
          pickupCode: 'MSK99',
          items: [{ variantId: product.variants[0].id, qty: 1 }],
        })
        .expect(201);

      expect(created.body.externalDeliveryId).toBe('cdek-uuid-1');
      expect(created.body.deliveryTracking).toEqual(
        expect.objectContaining({
          trackNumber: '1100654321',
          trackingUrl: 'https://www.cdek.ru/ru/tracking?order_id=1100654321',
        }),
      );

      const listed = await request(app.getHttpServer())
        .get('/api/orders')
        .set('Cookie', `${SESSION_COOKIE}=${raw}`)
        .expect(200);

      const order = listed.body.items.find(
        (o: { id: string }) => o.id === created.body.id,
      );
      expect(order.deliveryTracking.statusCode).toBe('ACCEPTED');
      expect(order.deliveryTracking.statusLabel).toBe('Принят');
      expect(getOrderCalls).toBe(1);

      await request(app.getHttpServer())
        .get('/api/orders')
        .set('Cookie', `${SESSION_COOKIE}=${raw}`)
        .expect(200);
      expect(getOrderCalls).toBe(1);

      await prisma.order.delete({ where: { id: created.body.id } });
      await prisma.product.delete({ where: { id: product.id } });
      await prisma.user
        .delete({ where: { id: user.id } })
        .catch(() => undefined);
    } finally {
      await app.close();
    }
  });

  it('syncs Yandex request/info on list and respects TTL', async () => {
    let infoCalls = 0;
    const mock = createMockYandexFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/request/info') && method === 'GET') {
        infoCalls += 1;
        return jsonResponse({
          request_id: 'ya-req-track-1',
          state: { status: 'DELIVERY_AT_START', description: 'На складе' },
          sharing_url: 'https://dostavka.yandex.ru/tracking/ya-req-track-1',
        });
      }

      return jsonResponse({ message: `unexpected ${method} ${url}` }, 500);
    });

    const { app } = await createTestApp({
      yandexFetch: mock.fetchMock,
      cdek: 'missing',
      yandex: 'present',
    });
    const prisma = app.get(PrismaService);

    try {
      await ensureDeliveryMethods(app);
      const { user, raw } = await seedUserSession(
        prisma,
        'yandex-track@example.com',
      );

      const order = await prisma.order.create({
        data: {
          email: 'buyer@example.com',
          lastName: 'Иванов',
          firstName: 'Иван',
          userId: user.id,
          phone: '+79001112233',
          contactChannel: 'Telegram',
          cityLabel: 'Москва',
          deliveryCode: DeliveryMethodCode.YANDEX,
          deliveryTitle: 'Яндекс Доставка',
          pickupLabel: 'ПВЗ',
          pickupCode: 'point-1',
          externalDeliveryId: 'ya-req-track-1',
          status: OrderStatus.PAID,
          paidAt: new Date(),
          total: 500,
          items: {
            create: [
              {
                productName: 'Корм',
                image: '/assets/product-turkey.png',
                weight: '1 кг.',
                weightGrams: 1000,
                price: 500,
                qty: 1,
              },
            ],
          },
        },
      });

      const listed = await request(app.getHttpServer())
        .get('/api/orders')
        .set('Cookie', `${SESSION_COOKIE}=${raw}`)
        .expect(200);

      const row = listed.body.items.find(
        (o: { id: string }) => o.id === order.id,
      );
      expect(row.deliveryTracking).toEqual(
        expect.objectContaining({
          statusCode: 'DELIVERY_AT_START',
          statusLabel: 'На складе',
          trackingUrl: 'https://dostavka.yandex.ru/tracking/ya-req-track-1',
          trackNumber: 'ya-req-track-1',
        }),
      );
      expect(infoCalls).toBe(1);

      await request(app.getHttpServer())
        .get('/api/orders')
        .set('Cookie', `${SESSION_COOKIE}=${raw}`)
        .expect(200);
      expect(infoCalls).toBe(1);

      await prisma.order.delete({ where: { id: order.id } });
      await prisma.user
        .delete({ where: { id: user.id } })
        .catch(() => undefined);
    } finally {
      await app.close();
    }
  });

  it('creates CDEK shipment after Ozon pay webhook', async () => {
    const mock = createMockCdekFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/v2/oauth/token') && method === 'POST') {
        return jsonResponse({
          access_token: 'mock-access-token',
          token_type: 'bearer',
          expires_in: 3600,
        });
      }

      if (url.includes('/v2/orders') && method === 'POST') {
        return jsonResponse({
          entity: { uuid: 'cdek-after-pay', cdek_number: '998877' },
        });
      }

      return jsonResponse({ message: `unexpected ${method} ${url}` }, 500);
    });

    process.env.OZON_PAY_ACCESS_KEY = 'test-access-key';
    process.env.OZON_PAY_NOTIFICATION_SECRET = '';

    const { app } = await createTestApp({
      cdekFetch: mock.fetchMock,
      cdek: 'present',
      yandex: 'missing',
      ozon: 'present',
    });
    const prisma = app.get(PrismaService);

    try {
      await ensureDeliveryMethods(app);
      const { user } = await seedUserSession(prisma, 'cdek-pay@example.com');

      const order = await prisma.order.create({
        data: {
          email: 'buyer@example.com',
          lastName: 'Иванов',
          firstName: 'Иван',
          userId: user.id,
          phone: '+79001112233',
          contactChannel: 'Telegram',
          cityLabel: 'Москва',
          deliveryCode: DeliveryMethodCode.CDEK,
          deliveryTitle: 'СДЭК',
          pickupLabel: 'ПВЗ',
          pickupCode: 'MSK99',
          status: OrderStatus.NEW,
          total: 500,
          paymentExternalId: 'ozon-cdek-1',
          items: {
            create: [
              {
                productName: 'Корм',
                image: '/assets/product-turkey.png',
                weight: '1 кг.',
                weightGrams: 1000,
                price: 500,
                qty: 1,
              },
            ],
          },
        },
      });

      await request(app.getHttpServer())
        .post('/api/payments/ozon/webhook')
        .send({ extId: order.id, status: 'STATUS_PAID' })
        .expect(200);

      const updated = await prisma.order.findUnique({
        where: { id: order.id },
      });
      expect(updated?.paidAt).toBeTruthy();
      expect(updated?.externalDeliveryId).toBe('cdek-after-pay');
      expect(updated?.deliveryTrackNumber).toBe('998877');
      expect(updated?.deliveryTrackingUrl).toContain('998877');

      await prisma.order.delete({ where: { id: order.id } });
      await prisma.user
        .delete({ where: { id: user.id } })
        .catch(() => undefined);
    } finally {
      await app.close();
    }
  });

  it('retries CDEK shipment when order is already paid but has no externalDeliveryId', async () => {
    let createCalls = 0;
    const mock = createMockCdekFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/v2/oauth/token') && method === 'POST') {
        return jsonResponse({
          access_token: 'mock-access-token',
          token_type: 'bearer',
          expires_in: 3600,
        });
      }

      if (url.includes('/v2/orders') && method === 'POST') {
        createCalls += 1;
        return jsonResponse({
          entity: { uuid: 'cdek-retry-pay', cdek_number: '112233' },
        });
      }

      return jsonResponse({ message: `unexpected ${method} ${url}` }, 500);
    });

    process.env.OZON_PAY_ACCESS_KEY = 'test-access-key';
    process.env.OZON_PAY_NOTIFICATION_SECRET = '';

    const { app } = await createTestApp({
      cdekFetch: mock.fetchMock,
      cdek: 'present',
      yandex: 'missing',
      ozon: 'present',
    });
    const prisma = app.get(PrismaService);

    try {
      await ensureDeliveryMethods(app);
      const { user } = await seedUserSession(prisma, 'cdek-retry@example.com');

      const order = await prisma.order.create({
        data: {
          email: 'buyer@example.com',
          lastName: 'Иванов',
          firstName: 'Иван',
          userId: user.id,
          phone: '+79001112233',
          contactChannel: 'Telegram',
          cityLabel: 'Москва',
          deliveryCode: DeliveryMethodCode.CDEK,
          deliveryTitle: 'СДЭК',
          pickupLabel: 'ПВЗ',
          pickupCode: 'MSK99',
          status: OrderStatus.PAID,
          paidAt: new Date(),
          total: 500,
          paymentExternalId: 'ozon-cdek-retry',
          items: {
            create: [
              {
                productName: 'Корм',
                image: '/assets/product-turkey.png',
                weight: '1 кг.',
                weightGrams: 1000,
                price: 500,
                qty: 1,
              },
            ],
          },
        },
      });

      await request(app.getHttpServer())
        .post('/api/payments/ozon/confirm')
        .send({ orderId: order.id })
        .expect(200);

      expect(createCalls).toBe(1);
      const updated = await prisma.order.findUnique({
        where: { id: order.id },
      });
      expect(updated?.externalDeliveryId).toBe('cdek-retry-pay');
      expect(updated?.deliveryTrackNumber).toBe('112233');

      await prisma.order.delete({ where: { id: order.id } });
      await prisma.user
        .delete({ where: { id: user.id } })
        .catch(() => undefined);
    } finally {
      await app.close();
    }
  });

  it('archives order when CDEK returns 404 entity not found', async () => {
    let getOrderCalls = 0;
    const mock = createMockCdekFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/v2/oauth/token') && method === 'POST') {
        return jsonResponse({
          access_token: 'mock-access-token',
          token_type: 'bearer',
          expires_in: 3600,
        });
      }

      if (url.includes('/v2/orders/gone-uuid') && method === 'GET') {
        getOrderCalls += 1;
        return jsonResponse(
          {
            requests: [
              {
                type: 'GET',
                state: 'INVALID',
                errors: [
                  {
                    code: 'v2_entity_not_found',
                    message: 'Entity is not found by uuid gone-uuid',
                  },
                ],
              },
            ],
          },
          404,
        );
      }

      return jsonResponse({ message: `unexpected ${method} ${url}` }, 500);
    });

    const { app } = await createTestApp({
      cdekFetch: mock.fetchMock,
      cdek: 'present',
      yandex: 'missing',
    });
    const prisma = app.get(PrismaService);

    try {
      const { user, raw } = await seedUserSession(
        prisma,
        'cdek-gone@example.com',
      );

      const order = await prisma.order.create({
        data: {
          email: 'buyer@example.com',
          lastName: 'Иванов',
          firstName: 'Иван',
          userId: user.id,
          phone: '+79001112233',
          contactChannel: 'Telegram',
          cityLabel: 'Москва',
          deliveryCode: DeliveryMethodCode.CDEK,
          deliveryTitle: 'СДЭК',
          pickupLabel: 'ПВЗ',
          pickupCode: 'MSK99',
          status: OrderStatus.PAID,
          paidAt: new Date(),
          total: 500,
          externalDeliveryId: 'gone-uuid',
          deliveryTrackNumber: '110011',
          deliveryTrackingUrl:
            'https://www.cdek.ru/ru/tracking?order_id=110011',
          items: {
            create: [
              {
                productName: 'Корм',
                image: '/assets/product-turkey.png',
                weight: '1 кг.',
                weightGrams: 1000,
                price: 500,
                qty: 1,
              },
            ],
          },
        },
      });

      const listed = await request(app.getHttpServer())
        .get('/api/orders')
        .set('Cookie', `${SESSION_COOKIE}=${raw}`)
        .expect(200);

      const row = listed.body.items.find(
        (o: { id: string }) => o.id === order.id,
      );
      expect(row.status).toBe('ARCHIVED');
      expect(row.deliveryTracking.statusCode).toBe('REMOVED');
      expect(row.deliveryTracking.statusLabel).toContain('СДЭК');
      expect(getOrderCalls).toBe(1);

      await request(app.getHttpServer())
        .get('/api/orders')
        .set('Cookie', `${SESSION_COOKIE}=${raw}`)
        .expect(200);
      expect(getOrderCalls).toBe(1);

      const keptDone = await prisma.order.create({
        data: {
          email: 'buyer2@example.com',
          lastName: 'Петров',
          firstName: 'Пётр',
          userId: user.id,
          phone: '+79001112234',
          contactChannel: 'Telegram',
          cityLabel: 'Москва',
          deliveryCode: DeliveryMethodCode.CDEK,
          deliveryTitle: 'СДЭК',
          pickupLabel: 'ПВЗ',
          pickupCode: 'MSK99',
          status: OrderStatus.DONE,
          paidAt: new Date(),
          total: 500,
          externalDeliveryId: 'gone-uuid',
          deliveryTrackNumber: '110012',
          items: {
            create: [
              {
                productName: 'Корм',
                image: '/assets/product-turkey.png',
                weight: '1 кг.',
                weightGrams: 1000,
                price: 500,
                qty: 1,
              },
            ],
          },
        },
      });

      const listed2 = await request(app.getHttpServer())
        .get('/api/orders')
        .set('Cookie', `${SESSION_COOKIE}=${raw}`)
        .expect(200);
      const doneRow = listed2.body.items.find(
        (o: { id: string }) => o.id === keptDone.id,
      );
      expect(doneRow.status).toBe('DONE');
      expect(doneRow.deliveryTracking.statusCode).toBe('REMOVED');
      expect(getOrderCalls).toBe(2);

      await prisma.order.delete({ where: { id: order.id } });
      await prisma.order.delete({ where: { id: keptDone.id } });
      await prisma.user
        .delete({ where: { id: user.id } })
        .catch(() => undefined);
    } finally {
      await app.close();
    }
  });
});
