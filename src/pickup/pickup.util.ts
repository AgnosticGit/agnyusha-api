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

export type PickupLocation = {
  /** City name typed by admin (matched against checkout city). */
  city: string;
  /** Street / place within the city. */
  address: string;
};

export type PickupSettingsShape = {
  /** Display address of the first location (legacy / fallback). */
  address: string;
  minLeadDays: number;
  /** Formatted RU phones buyers should call to collect the order. */
  phones: string[];
  /** Manual pickup points: city + address. */
  locations: PickupLocation[];
  schedule: PickupDaySchedule[];
};

const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;

export const DEFAULT_PICKUP_PHONES = ['+7 (911) 228-31-92'] as const;
export const MAX_PICKUP_PHONES = 10;
export const MAX_PICKUP_LOCATIONS = 30;

export const DEFAULT_PICKUP_LOCATIONS: PickupLocation[] = [
  { city: 'Санкт-Петербург', address: 'Гранитная 51' },
];

export function formatPickupLocationAddress(location: PickupLocation): string {
  const city = location.city.trim();
  const address = location.address.trim();
  if (!city) return address;
  if (!address) return city;
  const cityKey = normalizeCityKey(city);
  const addressKey = normalizeCityKey(address);
  if (addressKey.includes(cityKey)) return address;
  return `${city}, ${address}`;
}

export const DEFAULT_PICKUP_SETTINGS: PickupSettingsShape = {
  address: formatPickupLocationAddress(DEFAULT_PICKUP_LOCATIONS[0]),
  minLeadDays: 1,
  phones: [...DEFAULT_PICKUP_PHONES],
  locations: DEFAULT_PICKUP_LOCATIONS.map((l) => ({ ...l })),
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

export function normalizeCityKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/^г\.?\s+/u, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Normalize admin location rows; missing → Spb default. Empty array stays empty. */
export function normalizePickupLocations(raw: unknown): PickupLocation[] {
  if (raw === undefined || raw === null) {
    return DEFAULT_PICKUP_LOCATIONS.map((l) => ({ ...l }));
  }
  if (!Array.isArray(raw)) {
    return DEFAULT_PICKUP_LOCATIONS.map((l) => ({ ...l }));
  }
  const seen = new Set<string>();
  const out: PickupLocation[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as Record<string, unknown>;
    const city = typeof row.city === 'string' ? row.city.trim() : '';
    const address = typeof row.address === 'string' ? row.address.trim() : '';
    if (!city || !address) continue;
    const key = normalizeCityKey(city);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push({ city, address });
    if (out.length >= MAX_PICKUP_LOCATIONS) break;
  }
  return out;
}

/** Find location whose city name appears in the checkout city text. */
export function findPickupLocation(
  locations: PickupLocation[],
  input: {
    region?: string;
    label?: string;
    settlement?: string;
  },
): PickupLocation | null {
  if (!locations.length) return null;
  const haystack = normalizeCityKey(
    [input.label, input.region, input.settlement].filter(Boolean).join(' '),
  );
  if (!haystack) return null;
  return (
    locations.find((loc) => {
      const city = normalizeCityKey(loc.city);
      return city.length >= 2 && haystack.includes(city);
    }) ?? null
  );
}

/** Whether store pickup is offered for this checkout location. */
export function isPickupAllowedForLocation(
  locations: PickupLocation[],
  input: {
    region?: string;
    label?: string;
    settlement?: string;
  },
): boolean {
  return findPickupLocation(locations, input) != null;
}

/** Format as +7 (XXX) XXX-XX-XX, or null if incomplete. */
export function formatPickupPhone(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (!digits.length) return null;

  let normalized = digits;
  if (normalized.startsWith('8')) {
    normalized = `7${normalized.slice(1)}`;
  }
  if (!normalized.startsWith('7')) {
    normalized = `7${normalized}`;
  }
  normalized = normalized.slice(0, 11);
  if (normalized.length !== 11) return null;

  const local = normalized.slice(1);
  return `+7 (${local.slice(0, 3)}) ${local.slice(3, 6)}-${local.slice(6, 8)}-${local.slice(8, 10)}`;
}

/**
 * Normalize contact phones. Missing/invalid input falls back to defaults.
 * Explicit empty array stays empty (caller may require at least one).
 */
export function normalizePickupPhones(raw: unknown): string[] {
  if (raw === undefined || raw === null) {
    return [...DEFAULT_PICKUP_PHONES];
  }
  if (!Array.isArray(raw)) {
    return [...DEFAULT_PICKUP_PHONES];
  }
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const phone = formatPickupPhone(item);
    if (!phone || seen.has(phone)) continue;
    seen.add(phone);
    out.push(phone);
    if (out.length >= MAX_PICKUP_PHONES) break;
  }
  return out;
}

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
  phones?: unknown;
  locations?: unknown;
  /** @deprecated migrated into locations */
  cities?: unknown;
  schedule?: unknown;
}): PickupSettingsShape {
  const lead = Number(input.minLeadDays);
  const minLeadDays =
    Number.isFinite(lead) && lead >= 0 && lead <= 30
      ? Math.trunc(lead)
      : DEFAULT_PICKUP_SETTINGS.minLeadDays;

  let locations = normalizePickupLocations(input.locations);
  if (
    !locations.length &&
    typeof input.address === 'string' &&
    input.address.trim()
  ) {
    const raw = input.address.trim();
    const comma = raw.indexOf(',');
    locations =
      comma > 0
        ? [
            {
              city: raw.slice(0, comma).trim(),
              address: raw.slice(comma + 1).trim() || raw,
            },
          ]
        : [{ city: raw, address: raw }];
  }

  const address = locations.length
    ? formatPickupLocationAddress(locations[0])
    : typeof input.address === 'string' && input.address.trim()
      ? input.address.trim()
      : DEFAULT_PICKUP_SETTINGS.address;

  return {
    address,
    minLeadDays,
    phones: normalizePickupPhones(input.phones),
    locations,
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
