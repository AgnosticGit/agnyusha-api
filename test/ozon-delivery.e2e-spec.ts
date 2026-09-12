import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createMockOzonDeliveryFetch,
  createTestApp,
  ensureDeliveryMethods,
  jsonResponse,
} from './helpers/cdek-test.helpers';
import { OzonDeliveryService } from '../src/ozon-delivery/ozon-delivery.service';

describe('Ozon Delivery (e2e, mocked)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mock = createMockOzonDeliveryFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();

      if (url.includes('/oauth/token') && method === 'POST') {
        return jsonResponse({
          access_token: 'ozon-delivery-token',
          expires_in: Math.floor(Date.now() / 1000) + 3600,
        });
      }

      if (url.includes('/v1/delivery-point/list') && method === 'POST') {
        return jsonResponse({
          delivery_points: [
            { delivery_point_id: 501, shipment_method_ids: [1001] },
            { delivery_point_id: 502, shipment_method_ids: [1001] },
          ],
          next_cursor: null,
        });
      }

      if (url.includes('/v1/delivery-point/info') && method === 'POST') {
        return jsonResponse({
          delivery_points: [
            {
              delivery_point_id: 501,
              name: 'Ozon ПВЗ Невский',
              full_address: 'Санкт-Петербург, Невский пр., 10',
              type: 'PVZ',
              is_active: true,
              coordinates: { latitude: 59.93, longitude: 30.33 },
              schedule: [],
            },
            {
              delivery_point_id: 502,
              name: 'Ozon ПВЗ Москва',
              full_address: 'Москва, Тверская ул., 1',
              type: 'PVZ',
              is_active: true,
              coordinates: { latitude: 55.76, longitude: 37.62 },
              schedule: [],
            },
          ],
        });
      }

      return jsonResponse({ message: `unexpected ${method} ${url}` }, 500);
    });

    const created = await createTestApp({
      ozonDeliveryFetch: mock.fetchMock,
      ozonDelivery: 'present',
      cdek: 'missing',
      yandex: 'missing',
      pochta: 'missing',
    });
    app = created.app;
    app.get(OzonDeliveryService).clearCaches();
    await ensureDeliveryMethods(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists Ozon PVZ filtered by settlement', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/ozon/delivery-points')
      .query({ settlement: 'Санкт-Петербург' })
      .expect(200);

    expect(res.body).toHaveLength(1);
    expect(res.body[0]).toMatchObject({
      code: '501',
      name: 'Ozon ПВЗ Невский',
      city: 'Санкт-Петербург',
    });
  });

  it('keeps OZON unavailable while blocked', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .query({
        region: 'Санкт-Петербург',
        label: 'Санкт-Петербург',
      })
      .expect(200);

    const ozon = res.body.find((m: { code: string }) => m.code === 'OZON');
    expect(ozon?.available).toBe(false);
    expect(ozon?.note).toMatch(/временно/i);
  });
});
