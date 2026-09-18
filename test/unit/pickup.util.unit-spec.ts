import {
  DEFAULT_PICKUP_SETTINGS,
  findPickupLocation,
  formatPickupLocationAddress,
  formatPickupPhone,
  generatePickupSlots,
  isPickupAllowedForLocation,
  isValidPickupSlot,
  moscowLocalToUtc,
  normalizePickupLocations,
  normalizePickupPhones,
  normalizePickupSettings,
  scheduleSummary,
} from '../../src/pickup/pickup.util';

describe('pickup.util', () => {
  it('normalizes schedule to 7 days with defaults', () => {
    const settings = normalizePickupSettings({
      minLeadDays: 2,
      phones: ['8 (911) 228-31-92', '79112283192'],
      locations: [
        { city: 'Санкт-Петербург', address: 'Гранитная 51' },
        { city: 'Москва', address: 'проспект Пушкина' },
      ],
      schedule: [
        { weekday: 0, open: true, startTime: '10:00', endTime: '11:00' },
      ],
    });
    expect(settings.minLeadDays).toBe(2);
    expect(settings.phones).toEqual(['+7 (911) 228-31-92']);
    expect(settings.locations).toEqual([
      { city: 'Санкт-Петербург', address: 'Гранитная 51' },
      { city: 'Москва', address: 'проспект Пушкина' },
    ]);
    expect(settings.address).toBe('Санкт-Петербург, Гранитная 51');
    expect(settings.schedule).toHaveLength(7);
  });

  it('defaults phones when missing and formats complete numbers', () => {
    expect(normalizePickupPhones(undefined)).toEqual([
      '+7 (911) 228-31-92',
    ]);
    expect(normalizePickupPhones([])).toEqual([]);
    expect(formatPickupPhone('9112283192')).toBe('+7 (911) 228-31-92');
    expect(formatPickupPhone('123')).toBeNull();
  });

  it('matches locations by city name in checkout text', () => {
    expect(normalizePickupLocations(undefined)).toEqual([
      { city: 'Санкт-Петербург', address: 'Гранитная 51' },
    ]);
    expect(normalizePickupLocations([])).toEqual([]);
    const locations = [
      { city: 'Санкт-Петербург', address: 'Гранитная 51' },
      { city: 'Москва', address: 'проспект Пушкина' },
    ];
    expect(
      findPickupLocation(locations, {
        label: 'Санкт-Петербург, Санкт-Петербург, Россия',
      })?.address,
    ).toBe('Гранитная 51');
    expect(
      findPickupLocation(locations, {
        label: 'г Москва, Москва, Россия',
      })?.address,
    ).toBe('проспект Пушкина');
    expect(
      isPickupAllowedForLocation(locations, {
        label: 'Казань, Татарстан',
      }),
    ).toBe(false);
    expect(formatPickupLocationAddress(locations[0])).toBe(
      'Санкт-Петербург, Гранитная 51',
    );
  });

  it('summarizes Mon–Sat window', () => {
    expect(scheduleSummary(DEFAULT_PICKUP_SETTINGS.schedule)).toBe(
      'пн–сб 12:00–14:00',
    );
  });

  it('lists open days Monday-first in custom summary', () => {
    const schedule = DEFAULT_PICKUP_SETTINGS.schedule.map((d) => ({
      ...d,
      open: d.weekday === 0 || d.weekday === 1,
    }));
    expect(scheduleSummary(schedule)).toBe(
      'пн 12:00–14:00, вс 12:00–14:00',
    );
  });

  it('generates slots from minLeadDays skipping Sunday', () => {
    const now = moscowLocalToUtc(2026, 9, 14, 10, 0);
    const slots = generatePickupSlots(DEFAULT_PICKUP_SETTINGS, {
      now,
      daysAhead: 7,
    });
    expect(slots.length).toBeGreaterThan(0);
    expect(slots[0].date).toBe('2026-09-15');
    expect(slots[0].time).toBe('12:00');
    expect(slots.some((s) => s.date === '2026-09-20')).toBe(false);
    expect(
      isValidPickupSlot(DEFAULT_PICKUP_SETTINGS, new Date(slots[0].at), {
        now,
      }),
    ).toBe(true);
    expect(
      isValidPickupSlot(
        DEFAULT_PICKUP_SETTINGS,
        moscowLocalToUtc(2026, 9, 20, 12, 0),
        { now },
      ),
    ).toBe(false);
  });
});
