import {
  DEFAULT_PICKUP_SETTINGS,
  generatePickupSlots,
  isValidPickupSlot,
  moscowLocalToUtc,
  normalizePickupSettings,
  scheduleSummary,
} from '../../src/pickup/pickup.util';

describe('pickup.util', () => {
  it('normalizes schedule to 7 days with defaults', () => {
    const settings = normalizePickupSettings({
      address: '  Тест  ',
      minLeadDays: 2,
      schedule: [
        { weekday: 0, open: true, startTime: '10:00', endTime: '11:00' },
      ],
    });
    expect(settings.address).toBe('Тест');
    expect(settings.minLeadDays).toBe(2);
    expect(settings.schedule).toHaveLength(7);
    expect(settings.schedule[0]).toEqual({
      weekday: 0,
      open: true,
      startTime: '10:00',
      endTime: '11:00',
    });
    expect(settings.schedule[1].open).toBe(true);
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
    // Fixed "now": Moscow Monday 2026-09-14 10:00
    const now = moscowLocalToUtc(2026, 9, 14, 10, 0);
    const slots = generatePickupSlots(DEFAULT_PICKUP_SETTINGS, {
      now,
      daysAhead: 7,
    });
    expect(slots.length).toBeGreaterThan(0);
    // minLeadDays=1 → earliest Tuesday 2026-09-15
    expect(slots[0].date).toBe('2026-09-15');
    expect(slots[0].time).toBe('12:00');
    expect(slots.some((s) => s.date === '2026-09-20')).toBe(false); // Sunday
    expect(isValidPickupSlot(DEFAULT_PICKUP_SETTINGS, new Date(slots[0].at), { now })).toBe(
      true,
    );
    expect(
      isValidPickupSlot(
        DEFAULT_PICKUP_SETTINGS,
        moscowLocalToUtc(2026, 9, 20, 12, 0),
        { now },
      ),
    ).toBe(false);
  });
});
