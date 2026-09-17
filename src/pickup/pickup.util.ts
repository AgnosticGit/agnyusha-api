/** Europe/Moscow has no DST since 2014 — fixed UTC+3. */
export const MOSCOW_OFFSET_MS = 3 * 60 * 60 * 1000;

export type PickupDaySchedule = {
  /** 0 = Sunday … 6 = Saturday (JS getDay). */
  weekday: number;
  open: boolean;
  /** Local Moscow time "HH:mm". */
  startTime: string;
  /** Local Moscow time "HH:mm" (exclusive upper bound for slot starts if interval used). */
  endTime: string;
};

export type PickupSettingsShape = {
  address: string;
  minLeadDays: number;
  schedule: PickupDaySchedule[];
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const DEFAULT_PICKUP_SETTINGS: PickupSettingsShape = {
  address: 'Санкт-Петербург, Гранитная 51',
  minLeadDays: 1,
  schedule: [
    { weekday: 0, open: false, startTime: '12:00', endTime: '14:00' },
    { weekday: 1, open: true, startTime: '12:00', endTime: '14:00' },
    { weekday: 2, open: true, startTime: '12:00', endTime: '14:00' },
    { weekday: 3, open: true, startTime: '12:00', endTime: '14:00' },
    { weekday: 4, open: true, startTime: '12:00', endTime: '14:00' },
    { weekday: 5, open: true, startTime: '12:00', endTime: '14:00' },
    { weekday: 6, open: true, startTime: '12:00', endTime: '14:00' },
  ],
};

export function parseTimeToMinutes(value: string): number | null {
  const m = TIME_RE.exec(value.trim());
  if (!m) return null;
  return Number(m[1]) * 60 + Number(m[2]);
}

export function minutesToTime(total: number): string {
  const h = Math.floor(total / 60);
  const min = total % 60;
  return `${String(h).padStart(2, '0')}:${String(min).padStart(2, '0')}`;
}

export function moscowYmd(date: Date = new Date()): {
  year: number;
  month: number;
  day: number;
  weekday: number;
} {
  const shifted = new Date(date.getTime() + MOSCOW_OFFSET_MS);
  return {
    year: shifted.getUTCFullYear(),
    month: shifted.getUTCMonth() + 1,
    day: shifted.getUTCDate(),
    weekday: shifted.getUTCDay(),
  };
}

/** Build a UTC Date for a Moscow local civil datetime. */
export function moscowLocalToUtc(
  year: number,
  month: number,
  day: number,
  hours: number,
  minutes: number,
): Date {
  return new Date(
    Date.UTC(year, month - 1, day, hours, minutes, 0, 0) - MOSCOW_OFFSET_MS,
  );
}

export function formatMoscowDate(date: Date): string {
  const { year, month, day } = moscowYmd(date);
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

export function formatMoscowTime(date: Date): string {
  const shifted = new Date(date.getTime() + MOSCOW_OFFSET_MS);
  return minutesToTime(shifted.getUTCHours() * 60 + shifted.getUTCMinutes());
}

export function normalizeSchedule(raw: unknown): PickupDaySchedule[] {
  const byWeekday = new Map<number, PickupDaySchedule>();
  if (Array.isArray(raw)) {
    for (const row of raw) {
      if (!row || typeof row !== 'object') continue;
      const r = row as Record<string, unknown>;
      const weekday = Number(r.weekday);
      if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) continue;
      const startTime = String(r.startTime ?? '12:00');
      const endTime = String(r.endTime ?? '14:00');
      const startMin = parseTimeToMinutes(startTime);
      const endMin = parseTimeToMinutes(endTime);
      if (startMin == null || endMin == null || endMin <= startMin) continue;
      byWeekday.set(weekday, {
        weekday,
        open: Boolean(r.open),
        startTime: minutesToTime(startMin),
        endTime: minutesToTime(endMin),
      });
    }
  }
  return DEFAULT_PICKUP_SETTINGS.schedule.map(
    (d) => byWeekday.get(d.weekday) ?? { ...d },
  );
}

export function normalizePickupSettings(input: {
  address?: unknown;
  minLeadDays?: unknown;
  schedule?: unknown;
}): PickupSettingsShape {
  const address =
    typeof input.address === 'string' && input.address.trim()
      ? input.address.trim()
      : DEFAULT_PICKUP_SETTINGS.address;
  const lead = Number(input.minLeadDays);
  const minLeadDays =
    Number.isFinite(lead) && lead >= 0 && lead <= 30
      ? Math.trunc(lead)
      : DEFAULT_PICKUP_SETTINGS.minLeadDays;
  return {
    address,
    minLeadDays,
    schedule: normalizeSchedule(input.schedule),
  };
}

/** JS getDay(): 0=Sun…6=Sat → Monday-first sort key. */
function weekdaySortKeyMonFirst(weekday: number): number {
  return (weekday + 6) % 7;
}

export function scheduleSummary(schedule: PickupDaySchedule[]): string {
  const open = [...schedule.filter((d) => d.open)].sort(
    (a, b) => weekdaySortKeyMonFirst(a.weekday) - weekdaySortKeyMonFirst(b.weekday),
  );
  if (!open.length) return 'закрыто';
  const labels = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
  const sameWindow = open.every(
    (d) =>
      d.startTime === open[0].startTime && d.endTime === open[0].endTime,
  );
  if (sameWindow && open.length === 6 && !schedule[0].open) {
    return `пн–сб ${open[0].startTime}–${open[0].endTime}`;
  }
  return open
    .map((d) => `${labels[d.weekday]} ${d.startTime}–${d.endTime}`)
    .join(', ');
}

const SLOT_STEP_MINUTES = 30;

export type PickupSlot = {
  /** ISO datetime (UTC) for the slot start. */
  at: string;
  /** Moscow local date YYYY-MM-DD. */
  date: string;
  /** Moscow local time HH:mm. */
  time: string;
};

/** Generate bookable slots for the next `daysAhead` calendar days in Moscow. */
export function generatePickupSlots(
  settings: PickupSettingsShape,
  opts: { now?: Date; daysAhead?: number } = {},
): PickupSlot[] {
  const now = opts.now ?? new Date();
  const daysAhead = Math.max(1, Math.min(opts.daysAhead ?? 21, 60));
  const today = moscowYmd(now);
  const slots: PickupSlot[] = [];

  for (let offset = settings.minLeadDays; offset < settings.minLeadDays + daysAhead; offset++) {
    const utcNoon = moscowLocalToUtc(today.year, today.month, today.day, 12, 0);
    const dayDate = new Date(utcNoon.getTime() + offset * 24 * 60 * 60 * 1000);
    const parts = moscowYmd(dayDate);
    const day = settings.schedule.find((d) => d.weekday === parts.weekday);
    if (!day?.open) continue;
    const startMin = parseTimeToMinutes(day.startTime);
    const endMin = parseTimeToMinutes(day.endTime);
    if (startMin == null || endMin == null) continue;
    for (let t = startMin; t < endMin; t += SLOT_STEP_MINUTES) {
      const hours = Math.floor(t / 60);
      const minutes = t % 60;
      const at = moscowLocalToUtc(
        parts.year,
        parts.month,
        parts.day,
        hours,
        minutes,
      );
      if (at.getTime() <= now.getTime()) continue;
      slots.push({
        at: at.toISOString(),
        date: `${parts.year}-${String(parts.month).padStart(2, '0')}-${String(parts.day).padStart(2, '0')}`,
        time: minutesToTime(t),
      });
    }
  }
  return slots;
}

export function isValidPickupSlot(
  settings: PickupSettingsShape,
  at: Date,
  opts: { now?: Date } = {},
): boolean {
  const slots = generatePickupSlots(settings, {
    now: opts.now,
    daysAhead: 60,
  });
  const target = at.getTime();
  return slots.some((s) => new Date(s.at).getTime() === target);
}
