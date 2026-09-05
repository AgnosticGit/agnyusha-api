import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
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
