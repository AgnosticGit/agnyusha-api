import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createMockCdekFetch,
  createMockPochtaFetch,
  createMockYandexFetch,
  createTestApp,
  ensureDeliveryMethods,
  jsonResponse,
} from './helpers/cdek-test.helpers';

describe('Delivery methods ETA (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const cdek = createMockCdekFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('/oauth/token')) {
        return jsonResponse({
          access_token: 'test-token',
          token_type: 'bearer',
          expires_in: 3600,
        });
      }
      if (url.includes('/calculator/tariff') && method === 'POST') {
        return jsonResponse({
          delivery_sum: 350,
          period_min: 2,
          period_max: 4,
          calendar_min: 3,
          calendar_max: 5,
        });
      }
      return jsonResponse({ message: `unexpected CDEK ${method} ${url}` }, 500);
    });

    const yandex = createMockYandexFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('/pickup-points/list') && method === 'POST') {
        return jsonResponse({
          points: [
            {
              id: 'ya-msk-1',
              name: 'ПВЗ Яндекс',
              address: { full_address: 'Москва, Тверская 1', locality: 'Москва' },
              position: { latitude: 55.75, longitude: 37.62 },
            },
          ],
        });
      }
      if (url.includes('/offers/info') && method === 'GET') {
        expect(url).toContain('station_id=');
        if (url.includes('full_address=')) {
          return jsonResponse({
            offers: [
              {
                from: '2026-09-15T07:00:00.000Z',
                to: '2026-09-15T15:00:00.000Z',
              },
              {
                from: '2026-09-16T07:00:00.000Z',
                to: '2026-09-16T15:00:00.000Z',
              },
            ],
          });
        }
        return jsonResponse({
          offers: [
            {
              from: '2026-09-15T07:00:00.000Z',
              to: '2026-09-16T07:00:00.000Z',
            },
          ],
        });
      }
      return jsonResponse(
        { message: `unexpected Yandex ${method} ${url}` },
        500,
      );
    });

    const pochta = createMockPochtaFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('settlement.offices.codes')) {
        return jsonResponse(['101000', '101001']);
      }
      if (url.includes('/1.0/tariff') && method === 'POST') {
        return jsonResponse({
          'total-rate': 28000,
          'delivery-time': { 'min-days': 4, 'max-days': 6 },
        });
      }
      if (url.includes('tariff.pochta.ru')) {
        return jsonResponse({ delivery: { min: 4, max: 6 } });
      }
      return jsonResponse(
        { message: `unexpected Pochta ${method} ${url}` },
        500,
      );
    });

    const created = await createTestApp({
      cdekFetch: cdek.fetchMock,
      yandexFetch: yandex.fetchMock,
      pochtaFetch: pochta.fetchMock,
      cdek: 'present',
      yandex: 'present',
      pochta: 'present',
    });
    app = created.app;
    await ensureDeliveryMethods(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns ETA for CDEK, Yandex and Pochta when city ids are provided', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .query({
        region: 'Москва',
        label: 'Москва, Москва, Россия',
        settlement: 'Москва',
        cdekCode: 44,
        yandexGeoId: 213,
        weightGrams: 800,
      })
      .expect(200);

    const byCode = Object.fromEntries(
      res.body.map(
        (m: {
          code: string;
          etaText?: string | null;
          etaMinDays?: number | null;
          etaMaxDays?: number | null;
          note?: string;
          available: boolean;
        }) => [m.code, m],
      ),
    );

    expect(byCode.CDEK.available).toBe(true);
    expect(byCode.CDEK.etaText).toBe('3–5 дней');
    expect(byCode.CDEK.etaMinDays).toBe(3);
    expect(byCode.CDEK.etaMaxDays).toBe(5);
    expect(byCode.CDEK.note).toContain('3–5 дней');

    expect(byCode.YANDEX.available).toBe(true);
    expect(byCode.YANDEX.etaMinDays).toBeGreaterThanOrEqual(0);
    expect(byCode.YANDEX.etaMaxDays).toBeGreaterThanOrEqual(
      byCode.YANDEX.etaMinDays,
    );
    expect(byCode.YANDEX.etaText).toMatch(/\d/);

    expect(byCode.POST.available).toBe(true);
    expect(byCode.POST.etaText).toBe('4–6 дней');
    expect(byCode.POST.note).toContain('4–6 дней');
  });

  it('keeps methods available when ETA inputs are missing', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .query({
        region: 'Москва',
        label: 'Москва, Москва, Россия',
      })
      .expect(200);

    const cdek = res.body.find((m: { code: string }) => m.code === 'CDEK');
    expect(cdek.available).toBe(true);
    expect(cdek.etaText).toBeNull();
  });
});
