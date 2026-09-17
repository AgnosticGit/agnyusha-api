export const ANALYTICS_MAX_RANGE_DAYS = 366;

/** Parse YYYY-MM-DD (or Date-parseable) into start/end-of-day local boundary. */
export function parseAnalyticsBoundary(
  value: string | undefined,
  endOfDay: boolean,
): Date | null {
  if (!value?.trim()) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (day) {
    const d = new Date(
      Number(day[1]),
      Number(day[2]) - 1,
      Number(day[3]),
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0,
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

export function analyticsDateKey(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export type AnalyticsRangeOk = { ok: true; start: Date; end: Date };
export type AnalyticsRangeFail =
  | { ok: false; reason: 'inverted' }
  | { ok: false; reason: 'too_long'; maxDays: number };

export function resolveAnalyticsRange(
  from?: string,
  to?: string,
  now = new Date(),
): AnalyticsRangeOk | AnalyticsRangeFail {
  const end =
    parseAnalyticsBoundary(to, true) ??
    (() => {
      const d = new Date(now);
      d.setHours(23, 59, 59, 999);
      return d;
    })();
  const start =
    parseAnalyticsBoundary(from, false) ??
    (() => {
      const d = new Date(end);
      d.setDate(d.getDate() - 29);
      d.setHours(0, 0, 0, 0);
      return d;
    })();

  if (start.getTime() > end.getTime()) {
    return { ok: false, reason: 'inverted' };
  }

  const rangeMs = end.getTime() - start.getTime();
  const maxMs = ANALYTICS_MAX_RANGE_DAYS * 24 * 60 * 60 * 1000;
  if (rangeMs > maxMs) {
    return {
      ok: false,
      reason: 'too_long',
      maxDays: ANALYTICS_MAX_RANGE_DAYS,
    };
  }

  return { ok: true, start, end };
}
