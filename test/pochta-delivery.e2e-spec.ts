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
  createMockPochtaFetch,
  createTestApp,
  ensureDeliveryMethods,
  jsonResponse,
} from './helpers/cdek-test.helpers';

describe('Pochta Rossii delivery (e2e, mocked)', () => {
  let app: INestApplication;
  let calls: { url: string; method: string }[];

  beforeAll(async () => {
    const mock = createMockPochtaFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/settlement.offices.codes') && method === 'GET') {
        expect(url).toMatch(/settlement=/);
        return jsonResponse(['190000', '191186']);
      }

      if (url.includes('/postoffice/1.0/190000') && method === 'GET') {
        return jsonResponse({
          'postal-code': '190000',
          'address-source': 'Санкт-Петербург, Невский пр., 1',
          settlement: 'Санкт-Петербург',
          region: 'Санкт-Петербург',
          latitude: 59.93,
          longitude: 30.33,
          'is-closed': false,
          'working-hours': [
            {
              'weekday-id': 1,
              'begin-worktime': '09:00:00',
              'end-worktime': '20:00:00',
            },
          ],
        });
      }

      if (url.includes('/postoffice/1.0/191186') && method === 'GET') {
        return jsonResponse({
          'postal-code': '191186',
          'address-source': 'Санкт-Петербург, Невский пр., 20',
          settlement: 'Санкт-Петербург',
          region: 'Санкт-Петербург',
          latitude: 59.94,
          longitude: 30.34,
          'is-closed': false,
        });
      }

      if (url.includes('/1.0/user/backlog') && method === 'PUT') {
        return jsonResponse({ 'result-ids': [9001] });
      }

      if (url.includes('/1.0/user/shipment') && method === 'POST') {
        const body = JSON.parse(String(init?.body || '[]')) as number[];
        expect(body).toEqual([9001]);
        return jsonResponse({ 'result-ids': [9001] });
      }

      if (url.includes('/1.0/shipment/9001') && method === 'GET') {
        return jsonResponse({
          id: 9001,
          barcode: '12345678901234',
        });
      }

      return jsonResponse({ message: `unexpected ${method} ${url}` }, 500);
    });

    calls = mock.calls;
    const created = await createTestApp({
      pochtaFetch: mock.fetchMock,
      pochta: 'present',
      cdek: 'missing',
      yandex: 'missing',
    });
    app = created.app;
    await ensureDeliveryMethods(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    calls.length = 0;
  });

  it('returns Pochta OPS for settlement', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/pochta/delivery-points')
      .query({ settlement: 'Санкт-Петербург', region: 'Санкт-Петербург' })
      .expect(200);

    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          code: '190000',
          name: 'ОПС 190000',
          address: 'Санкт-Петербург, Невский пр., 1',
          workTime: expect.stringContaining('Пн'),
        }),
        expect.objectContaining({ code: '191186' }),
      ]),
    );
    expect(calls.some((c) => c.url.includes('settlement.offices.codes'))).toBe(
      true,
    );
  });

  it('marks POST available when Pochta is configured', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .query({ region: 'Санкт-Петербург', label: 'Санкт-Петербург' })
      .expect(200);

    const byCode = Object.fromEntries(
      res.body.map((m: { code: string; available: boolean }) => [
        m.code,
        m.available,
      ]),
    );
    expect(byCode.POST).toBe(true);
    expect(byCode.CDEK).toBe(false);
  });

  it('creates local order with Pochta barcode', async () => {
    const prisma = app.get(PrismaService);
    const email = 'pochta-buyer@example.com';
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

    const product = await prisma.product.create({
      data: {
        slug: `pochta-order-${Date.now()}`,
        name: 'Корм тест Почта',
        image: '/assets/product-turkey.png',
        category: 'DOGS',
        ingredients: 't',
        description: 't',
        variants: {
          create: [
            {
              sku: `POST-ORD-${Date.now()}`,
              weight: '0,8 кг.',
              weightGrams: 800,
              price: 725,
              stock: 5,
            },
          ],
        },
      },
      include: { variants: true },
    });

    const order = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Cookie', `${SESSION_COOKIE}=${raw}`)
      .send({
        email: 'buyer@example.com',
        lastName: 'Иванов',
        firstName: 'Иван',
        phone: '+7 (900) 123-45-67',
        contactChannel: 'Telegram',
        cityLabel: 'Санкт-Петербург',
        deliveryCode: 'POST',
        deliveryTitle: 'Почта России',
        pickupCode: '190000',
        pickupLabel: 'ОПС 190000 — Санкт-Петербург, Невский пр., 1',
        items: [{ variantId: product.variants[0].id, qty: 1 }],
      })
      .expect(201);

    expect(order.body.externalDeliveryId).toBe('9001');
    expect(order.body.deliveryTracking?.trackNumber).toBe('12345678901234');
    expect(order.body.deliveryTracking?.trackingUrl).toContain(
      '12345678901234',
    );

    expect(calls.some((c) => c.url.includes('/user/backlog'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/user/shipment'))).toBe(true);

    await prisma.order.delete({ where: { id: order.body.id } });
    await prisma.product.delete({ where: { id: product.id } });
    await prisma.session.deleteMany({ where: { userId: user.id } });
    await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
  });

  it('creates Pochta shipment after Ozon pay webhook', async () => {
    const mock = createMockPochtaFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/postoffice/1.0/190000') && method === 'GET') {
        return jsonResponse({
          'postal-code': '190000',
          'address-source': 'Санкт-Петербург, Невский пр., 1',
          settlement: 'Санкт-Петербург',
          region: 'Санкт-Петербург',
        });
      }
      if (url.includes('/1.0/user/backlog') && method === 'PUT') {
        return jsonResponse({ 'result-ids': [9002] });
      }
      if (url.includes('/1.0/user/shipment') && method === 'POST') {
        return jsonResponse({ 'result-ids': [9002] });
      }
      if (url.includes('/1.0/shipment/9002') && method === 'GET') {
        return jsonResponse({ id: 9002, barcode: '99887766554433' });
      }
      return jsonResponse({ message: `unexpected ${method} ${url}` }, 500);
    });

    const { app: payApp } = await createTestApp({
      pochtaFetch: mock.fetchMock,
      pochta: 'present',
      cdek: 'missing',
      yandex: 'missing',
      ozon: 'present',
    });
    const prisma = payApp.get(PrismaService);

    try {
      await ensureDeliveryMethods(payApp);
      const user = await prisma.user.upsert({
        where: { email: 'pochta-pay@example.com' },
        create: { email: 'pochta-pay@example.com', role: UserRole.USER },
        update: { role: UserRole.USER },
      });

      const order = await prisma.order.create({
        data: {
          email: 'buyer@example.com',
          lastName: 'Иванов',
          firstName: 'Иван',
          userId: user.id,
          phone: '+79001112233',
          contactChannel: 'Telegram',
          cityLabel: 'Санкт-Петербург',
          deliveryCode: DeliveryMethodCode.POST,
          deliveryTitle: 'Почта России',
          pickupLabel: 'ОПС 190000',
          pickupCode: '190000',
          status: OrderStatus.NEW,
          total: 500,
          paymentExternalId: 'ozon-pochta-1',
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

      await request(payApp.getHttpServer())
        .post('/api/payments/ozon/webhook')
        .send({ extId: order.id, status: 'STATUS_PAID' })
        .expect(200);

      const updated = await prisma.order.findUnique({ where: { id: order.id } });
      expect(updated?.paidAt).toBeTruthy();
      expect(updated?.externalDeliveryId).toBe('9002');
      expect(updated?.deliveryTrackNumber).toBe('99887766554433');
      expect(updated?.deliveryTrackingUrl).toContain('99887766554433');

      await prisma.order.delete({ where: { id: order.id } });
      await prisma.user
        .delete({ where: { id: user.id } })
        .catch(() => undefined);
    } finally {
      await payApp.close();
    }
  });

  it('syncs tracking and archives when Pochta shipment is gone', async () => {
    const goneMock = createMockPochtaFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('/1.0/shipment/') && method === 'GET') {
        return jsonResponse({ message: 'not found' }, 404);
      }
      if (url.includes('/1.0/backlog/') && method === 'GET') {
        return jsonResponse({ message: 'not found' }, 404);
      }
      return jsonResponse({ message: `unexpected ${method} ${url}` }, 500);
    });

    const { app: trackingApp } = await createTestApp({
      pochtaFetch: goneMock.fetchMock,
      pochta: 'present',
      cdek: 'missing',
      yandex: 'missing',
    });
    const prisma = trackingApp.get(PrismaService);

    try {
      await ensureDeliveryMethods(trackingApp);
      const user = await prisma.user.upsert({
        where: { email: 'pochta-track@example.com' },
        create: { email: 'pochta-track@example.com', role: UserRole.USER },
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

      const order = await prisma.order.create({
        data: {
          email: 'buyer@example.com',
          lastName: 'Иванов',
          firstName: 'Иван',
          userId: user.id,
          phone: '+79001112233',
          contactChannel: 'Telegram',
          cityLabel: 'Санкт-Петербург',
          deliveryCode: DeliveryMethodCode.POST,
          deliveryTitle: 'Почта России',
          pickupCode: '190000',
          externalDeliveryId: 'gone-1',
          deliveryTrackNumber: '111',
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

      const res = await request(trackingApp.getHttpServer())
        .get('/api/orders')
        .set('Cookie', `${SESSION_COOKIE}=${raw}`)
        .expect(200);

      const listed = res.body.items.find(
        (o: { id: string }) => o.id === order.id,
      );
      expect(listed?.status).toBe('ARCHIVED');
      expect(listed?.deliveryTracking?.statusCode).toBe('REMOVED');

      await prisma.order.delete({ where: { id: order.id } });
      await prisma.session.deleteMany({ where: { userId: user.id } });
      await prisma.user.delete({ where: { id: user.id } }).catch(() => undefined);
    } finally {
      await trackingApp.close();
    }
  });
});
