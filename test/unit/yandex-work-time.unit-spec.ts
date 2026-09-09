import { formatYandexWorkTime } from '../../src/yandex/yandex-delivery.service';

describe('formatYandexWorkTime', () => {
  it('returns null for missing/empty schedule', () => {
    expect(formatYandexWorkTime(undefined)).toBeNull();
    expect(formatYandexWorkTime({})).toBeNull();
    expect(formatYandexWorkTime({ restrictions: [] })).toBeNull();
  });

  it('formats day range with from-to times', () => {
    expect(
      formatYandexWorkTime({
        restrictions: [
          {
            days: [1, 2, 3, 4, 5],
            time_from: { hours: 9, minutes: 0 },
            time_to: { hours: 18, minutes: 30 },
          },
        ],
      }),
    ).toBe('Пн-Пт 09:00-18:30');
  });

  it('formats split day ranges and from-only times', () => {
    expect(
      formatYandexWorkTime({
        restrictions: [
          {
            days: [1, 2, 3, 5, 7],
            time_from: { hours: 10 },
            time_to: { hours: 20, minutes: 0 },
          },
          {
            days: [6],
            time_from: { hours: 11, minutes: 15 },
          },
        ],
      }),
    ).toBe('Пн-Ср, Пт, Вс 10:00-20:00, Сб с 11:15');
  });

  it('formats time-only and day-only rows', () => {
    expect(
      formatYandexWorkTime({
        restrictions: [
          {
            time_from: { hours: 8, minutes: 0 },
            time_to: { hours: 12, minutes: 0 },
          },
          { days: [1] },
        ],
      }),
    ).toBe('08:00-12:00, Пн');
  });

  it('skips rows without days or from time', () => {
    expect(
      formatYandexWorkTime({
        restrictions: [{ time_to: { hours: 18 } }, { days: [0, 99] }],
      }),
    ).toBeNull();
  });
});
