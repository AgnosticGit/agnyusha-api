/** Normalize RU phone to Ozon `+7XXXXXXXXXX` or throw-friendly empty. */
export function normalizeOzonPhone(phone: string): string | null {
  const digits = phone.replace(/\D/g, '');
  let national = digits;
  if (digits.length === 11 && digits.startsWith('8')) {
    national = `7${digits.slice(1)}`;
  } else if (digits.length === 11 && digits.startsWith('7')) {
    national = digits;
  } else if (digits.length === 10) {
    national = `7${digits}`;
  } else {
    return null;
  }
  if (national.length !== 11 || !national.startsWith('7')) return null;
  return `+${national}`;
}

export function normalizeSettlementKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/^(г\.|город|пос\.|пгт|с\.|село)\s+/i, '')
    .replace(/[^a-zа-я0-9]+/gi, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

export function extractCityFromAddress(fullAddress: string): string {
  const first = fullAddress.split(',')[0]?.trim() || '';
  return first.replace(/^(г\.|город|пос\.|пгт|с\.|село)\s+/i, '').trim();
}

export function settlementMatches(
  settlement: string,
  pointCity: string,
  fullAddress: string,
): boolean {
  const needle = normalizeSettlementKey(settlement);
  if (needle.length < 2) return false;
  const cityKey = normalizeSettlementKey(pointCity);
  if (cityKey && (cityKey === needle || cityKey.includes(needle) || needle.includes(cityKey))) {
    return true;
  }
  const addressKey = normalizeSettlementKey(fullAddress);
  return addressKey.includes(needle);
}

type ScheduleRow = {
  day?: string | number;
  from?: string;
  to?: string;
  open?: string;
  close?: string;
};

const WEEKDAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'] as const;

export function formatOzonSchedule(schedule: unknown): string | null {
  if (!Array.isArray(schedule) || schedule.length === 0) return null;
  const parts: string[] = [];
  for (const raw of schedule) {
    if (!raw || typeof raw !== 'object') continue;
    const row = raw as ScheduleRow;
    const from = String(row.from || row.open || '').trim();
    const to = String(row.to || row.close || '').trim();
    if (!from || !to) continue;
    let dayLabel = '';
    if (typeof row.day === 'number' && row.day >= 0 && row.day <= 6) {
      dayLabel = WEEKDAY_SHORT[row.day];
    } else if (typeof row.day === 'string' && row.day.trim()) {
      dayLabel = row.day.trim();
    }
    parts.push(dayLabel ? `${dayLabel} ${from}-${to}` : `${from}-${to}`);
  }
  const line = parts.join(', ').trim();
  return line || null;
}

/** Rough parcel box from total weight (grams). */
export function packageDimensionsMm(weightGrams: number): {
  weight_g: number;
  length_mm: number;
  width_mm: number;
  height_mm: number;
} {
  const weight_g = Math.max(100, Math.trunc(weightGrams));
  if (weight_g <= 500) {
    return { weight_g, length_mm: 250, width_mm: 180, height_mm: 80 };
  }
  if (weight_g <= 2000) {
    return { weight_g, length_mm: 350, width_mm: 250, height_mm: 150 };
  }
  if (weight_g <= 5000) {
    return { weight_g, length_mm: 450, width_mm: 300, height_mm: 200 };
  }
  return { weight_g, length_mm: 600, width_mm: 400, height_mm: 300 };
}

export function positiveRequestId(seed: string): number {
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return (hash % 1_999_999_999) + 1;
}

export function ozonTrackingUrl(orderNumber: string): string {
  return `https://www.ozon.ru/my/orderdetails/?order=${encodeURIComponent(orderNumber)}`;
}

export function moneyRub(amount: number): { amount: string; currency_code: string } {
  const safe = Math.max(0, Number.isFinite(amount) ? amount : 0);
  return { amount: safe.toFixed(2), currency_code: 'RUB' };
}
