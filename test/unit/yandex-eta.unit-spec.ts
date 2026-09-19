import {
  YandexDeliveryService,
  buildYandexOffersInfoAddress,
  normalizeYandexTime,
  pickYandexOffer,
  yandexDropoffReadyIntervalUtc,
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

describe('yandexDropoffReadyIntervalUtc', () => {
  it('uses tomorrow 07:00 UTC as ready-to-dropoff instant', () => {
    const interval = yandexDropoffReadyIntervalUtc(
      new Date('2026-09-19T15:30:00.000Z'),
    );
    expect(interval).toEqual({
      from: '2026-09-20T07:00:00.000Z',
      to: '2026-09-20T07:00:00.000Z',
    });
  });
});

describe('buildYandexOffersInfoAddress', () => {
  it('adds stub street/house for city-only labels', () => {
    expect(buildYandexOffersInfoAddress('Санкт-Петербург')).toBe(
      'Санкт-Петербург, Центральная улица, 1',
    );
  });

  it('keeps a full address with house', () => {
    expect(
      buildYandexOffersInfoAddress('Санкт-Петербург, Невский пр., 10'),
    ).toBe('Санкт-Петербург, Невский пр., 10');
  });

  it('returns null for empty input', () => {
    expect(buildYandexOffersInfoAddress('')).toBeNull();
    expect(buildYandexOffersInfoAddress(null)).toBeNull();
  });
});

describe('pickYandexOffer', () => {
  it('prefers the earliest delivery window', () => {
    const picked = pickYandexOffer(
      [
        {
          offer_id: 'late',
          offer_details: {
            delivery_interval: { min: '2026-09-25T07:00:00Z' },
            pricing_total: '100 RUB',
          },
        },
        {
          offer_id: 'early',
          offer_details: {
            delivery_interval: { min: '2026-09-22T07:00:00Z' },
            pricing_total: '160 RUB',
          },
        },
      ],
      new Date('2026-09-19T12:00:00Z'),
    );
    expect(picked?.offer_id).toBe('early');
  });

  it('skips expired offers when a fresh one exists', () => {
    const picked = pickYandexOffer(
      [
        {
          offer_id: 'expired',
          expires_at: '2026-09-19T10:00:00Z',
          offer_details: {
            delivery_interval: { min: '2026-09-20T07:00:00Z' },
          },
        },
        {
          offer_id: 'fresh',
          expires_at: '2026-09-19T18:00:00Z',
          offer_details: {
            delivery_interval: { min: '2026-09-22T07:00:00Z' },
          },
        },
      ],
      new Date('2026-09-19T12:00:00Z'),
    );
    expect(picked?.offer_id).toBe('fresh');
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

  it('enriches city label and requests self_pickup ETA', async () => {
    const fetchFn = jest.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      expect(url).toContain('/offers/info');
      expect(url).toContain('last_mile_policy=self_pickup');
      const decoded = decodeURIComponent(url.replace(/\+/g, '%20'));
      expect(decoded).toContain('Центральная улица');
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

  it('returns null when offers/info has no offers', async () => {
    const fetchFn = jest.fn(async () => {
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
