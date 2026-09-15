import {
  YandexDeliveryService,
  normalizeYandexTime,
} from '../../src/yandex/yandex-delivery.service';
import { etaFromIsoInterval } from '../../src/delivery/delivery-eta';
import { ConfigService } from '@nestjs/config';

describe('normalizeYandexTime', () => {
  it('keeps ISO strings', () => {
    expect(normalizeYandexTime('2026-09-15T07:00:00.000Z')).toBe(
      '2026-09-15T07:00:00.000Z',
    );
  });

  it('converts unix seconds', () => {
    expect(normalizeYandexTime(1726383600)).toBe(
      new Date(1726383600 * 1000).toISOString(),
    );
  });

  it('feeds offers/info from/to into ETA', () => {
    const now = new Date('2026-09-13T12:00:00.000Z');
    const eta = etaFromIsoInterval(
      normalizeYandexTime('2026-09-15T07:00:00.000Z'),
      normalizeYandexTime('2026-09-16T07:00:00.000Z'),
      now,
    );
    expect(eta).toEqual({ minDays: 2, maxDays: 3, text: '2–3 дня' });
  });
});

describe('YandexDeliveryService.estimateDeliveryEta', () => {
  function makeService(fetchFn: jest.Mock) {
    const config = {
      get: (key: string) => {
        if (key === 'YANDEX_DELIVERY_API_URL') {
          return 'https://b2b.taxi.tst.yandex.net';
        }
        if (key === 'YANDEX_DELIVERY_TOKEN') return 'test-token';
        if (key === 'YANDEX_PLATFORM_STATION_ID') {
          return 'station-1';
        }
        return undefined;
      },
    } as unknown as ConfigService;
    return new YandexDeliveryService(config, fetchFn);
  }

  it('uses a single offers/info by address and never lists PVZs', async () => {
    const fetchFn = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/offers/info');
      expect(url).toContain('full_address=');
      expect(url).not.toContain('pickup-points');
      return new Response(
        JSON.stringify({
          offers: [
            {
              from: '2026-09-15T07:00:00.000Z',
              to: '2026-09-16T07:00:00.000Z',
            },
          ],
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    });

    const service = makeService(fetchFn);
    const eta = await service.estimateDeliveryEta(213, {
      fullAddress: 'Москва',
    });

    expect(eta).toEqual(
      expect.objectContaining({
        minDays: expect.any(Number),
        maxDays: expect.any(Number),
        text: expect.any(String),
      }),
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('does not fall back to pickup-points when address offers are empty', async () => {
    const fetchFn = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('/pickup-points/list')) {
        throw new Error('pickup-points must not be called for ETA');
      }
      return new Response(JSON.stringify({ offers: [] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const service = makeService(fetchFn);
    const eta = await service.estimateDeliveryEta(213, {
      fullAddress: 'Москва',
    });

    expect(eta).toBeNull();
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });
});
