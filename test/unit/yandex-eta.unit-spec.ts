import { normalizeYandexTime } from '../../src/yandex/yandex-delivery.service';
import { etaFromIsoInterval } from '../../src/delivery/delivery-eta';

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
