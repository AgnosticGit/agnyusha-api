import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { CdekService } from '../src/cdek/cdek.service';
import {
  createMockCdekFetch,
  createTestApp,
  ensureDeliveryMethods,
  jsonResponse,
} from './helpers/cdek-test.helpers';

describe('Cities + CDEK (e2e, mocked CDEK)', () => {
  let app: INestApplication;
  let calls: { url: string; method: string }[];
  let clearTokenCache: () => void;

  beforeAll(async () => {
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

      if (url.includes('/v2/location/suggest/cities')) {
        return jsonResponse([
          {
            city_uuid: 'uuid-spb',
            code: 137,
            full_name: 'Санкт-Петербург, Санкт-Петербург, Россия',
            country_code: 'RU',
          },
          {
            city_uuid: 'uuid-msk',
            code: 44,
            full_name: 'Москва, Москва, Россия',
            country_code: 'RU',
          },
        ]);
      }

      if (url.includes('/v2/deliverypoints')) {
        return jsonResponse([
          {
            code: 'SPB1',
            name: 'СПБ На Московском',
            type: 'PVZ',
            work_time: 'Пн-Пт 10-20',
            location: {
              city: 'Санкт-Петербург',
              region: 'Санкт-Петербург',
              address: 'Московский пр., 1',
              postal_code: '190000',
              latitude: 59.9,
              longitude: 30.3,
            },
          },
        ]);
      }

      return jsonResponse({ message: 'unexpected mock path' }, 500);
    });

    calls = mock.calls;
    const created = await createTestApp({
      cdekFetch: mock.fetchMock,
      cdek: 'present',
      yandex: 'missing',
    });
    app = created.app;
    clearTokenCache = () => app.get(CdekService).clearTokenCache();
    await ensureDeliveryMethods(app);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    calls.length = 0;
    clearTokenCache();
  });

  it('searches cities via CDEK suggest using only the injected mock', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/cities/search')
      .query({ q: 'Санкт', limit: 5 })
      .expect(200);

    expect(res.body).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'cdek:137',
          cdekCode: 137,
          yandexGeoId: null,
          name: 'Санкт-Петербург',
        }),
      ]),
    );

    expect(calls.some((c) => c.url.includes('/oauth/token'))).toBe(true);
    expect(calls.some((c) => c.url.includes('/location/suggest/cities'))).toBe(
      true,
    );
  });

  it('reuses cached OAuth token on the second CDEK call', async () => {
    await request(app.getHttpServer())
      .get('/api/cities/search')
      .query({ q: 'Санкт' })
      .expect(200);

    expect(calls.filter((c) => c.url.includes('/oauth/token')).length).toBe(1);

    await request(app.getHttpServer())
      .get('/api/cities/search')
      .query({ q: 'Моск' })
      .expect(200);

    expect(calls.filter((c) => c.url.includes('/oauth/token')).length).toBe(1);
  });

  it('returns delivery points for a CDEK city code', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/cdek/delivery-points')
      .query({ cityCode: 137 })
      .expect(200);

    expect(res.body).toEqual([
      expect.objectContaining({
        code: 'SPB1',
        name: 'СПБ На Московском',
        address: 'Московский пр., 1',
      }),
    ]);
  });

  it('rejects short city queries', async () => {
    await request(app.getHttpServer())
      .get('/api/cities/search')
      .query({ q: 'С' })
      .expect(400);
  });

  it('rejects invalid delivery point cityCode', async () => {
    await request(app.getHttpServer())
      .get('/api/cdek/delivery-points')
      .query({ cityCode: 0 })
      .expect(400);
  });
});
