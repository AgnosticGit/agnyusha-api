import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import {
  createRawToken,
  hashToken,
  SESSION_COOKIE,
} from '../src/auth/auth.crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  createMockYandexFetch,
  createTestApp,
  ensureDeliveryMethods,
  jsonResponse,
} from './helpers/cdek-test.helpers';

describe('Cities + Yandex Delivery (e2e, mocked Yandex)', () => {
  let app: INestApplication;
  let calls: { url: string; method: string }[];

  beforeAll(async () => {
    const mock = createMockYandexFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/location/detect') && method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}')) as {
          location?: string;
        };
        expect(body.location).toBeTruthy();
        return jsonResponse({
          variants: [
            { geo_id: 2, address: 'Санкт-Петербург' },
            { geo_id: 213, address: 'Москва' },
          ],
        });
      }

      if (url.includes('/pickup-points/list') && method === 'POST') {
        const body = JSON.parse(String(init?.body || '{}')) as {
          geo_id?: number;
        };
        expect(body.geo_id).toBe(2);
        return jsonResponse({
          points: [
            {
              id: 'ya-spb-1',
              name: 'Яндекс ПВЗ Невский',
              type: 'pickup_point',
              address: {
                full_address: 'Невский пр., 10',
                locality: 'Санкт-Петербург',
                region: 'Санкт-Петербург',
                postal_code: '191186',
              },
              position: { latitude: 59.93, longitude: 30.33 },
              payment_methods: ['already_paid', 'card_on_receipt'],
            },
          ],
        });
      }

      if (url.includes('/offers/create') && method === 'POST') {
        return jsonResponse({
          offers: [
            {
              offer_id: 'offer-test-1',
              offer_details: {
                pricing_total: '181.82 RUB',
                delivery_interval: {
                  min: '2026-09-08T07:00:00Z',
                  max: '2026-09-08T09:00:00Z',
                  policy: 'self_pickup',
                },
              },
            },
          ],
        });
      }

      if (url.includes('/offers/confirm') && method === 'POST') {
        return jsonResponse({
          request_id: 'yandex-request-test-1',
        });
      }

      return jsonResponse({ message: 'unexpected yandex path' }, 500);
    });

    calls = mock.calls;
    const created = await createTestApp({
      yandexFetch: mock.fetchMock,
      cdek: 'missing',
      yandex: 'present',
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

  it('searches cities via Yandex location/detect without real network', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/cities/search')
      .query({ q: 'Санкт' })
      .expect(200);

    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'yandex:2',
          yandexGeoId: 2,
          cdekCode: null,
          name: 'Санкт-Петербург',
        }),
      ]),
    );

    expect(calls.every((c) => c.url.includes('yandex.net'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/location/detect'))).toBe(true);
  });

  it('returns Yandex pickup points for geoId', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/yandex/delivery-points')
      .query({ geoId: 2 })
      .expect(200);

    expect(res.body).toEqual([
      expect.objectContaining({
        code: 'ya-spb-1',
        name: 'Яндекс ПВЗ Невский',
        address: 'Невский пр., 10',
      }),
    ]);
  });

  it('marks Yandex available and CDEK unavailable when only Yandex is configured', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .query({ region: 'Москва', label: 'Москва' })
      .expect(200);

    const byCode = Object.fromEntries(
      res.body.map((m: { code: string; available: boolean }) => [
        m.code,
        m.available,
      ]),
    );
    expect(byCode.YANDEX).toBe(true);
    expect(byCode.CDEK).toBe(false);
  });

  it('hides Yandex outside Moscow on test host', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .query({ region: 'Санкт-Петербург', label: 'Санкт-Петербург' })
      .expect(200);

    const yandex = res.body.find(
      (m: { code: string }) => m.code === 'YANDEX',
    ) as { available: boolean; note: string };
    expect(yandex.available).toBe(false);
    expect(yandex.note).toMatch(/Москв/i);
  });

  it('creates local order with Yandex external delivery id', async () => {
    const prisma = app.get(PrismaService);
    const email = 'yandex-buyer@example.com';
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

    const order = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Cookie', `${SESSION_COOKIE}=${raw}`)
      .send({
        phone: '+7 (900) 123-45-67',
        contactChannel: 'Telegram',
        cityLabel: 'Москва',
        deliveryCode: 'YANDEX',
        deliveryTitle: 'Яндекс Доставка',
        pickupLabel: 'Яндекс ПВЗ — Ленинградский 37',
        pickupCode: '01946f4f013c7337874ec2fb848a58a4',
        items: [
          {
            name: 'Корм тест',
            image: '/assets/product-turkey.png',
            weight: '0,8 кг.',
            price: 725,
            qty: 1,
          },
        ],
      })
      .expect(201);

    expect(order.body.externalDeliveryId).toBe('yandex-request-test-1');
    expect(order.body.pickupCode).toBe('01946f4f013c7337874ec2fb848a58a4');
    expect(calls.some((c) => c.url.includes('/offers/create'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/offers/confirm'))).toBe(true);
  });

  it('returns generic 503 when Yandex token is missing', async () => {
    const blocked = createMockYandexFetch(async () => {
      throw new Error('should not call yandex');
    });
    const { app: unconfigured } = await createTestApp({
      yandexFetch: blocked.fetchMock,
      cdek: 'missing',
      yandex: 'missing',
    });

    const res = await request(unconfigured.getHttpServer())
      .get('/api/cities/search')
      .query({ q: 'Москва' })
      .expect(503);

    expect(res.body.message).toBe('Служба доставки временно недоступна');
    expect(blocked.calls).toHaveLength(0);
    await unconfigured.close();
  });
});
