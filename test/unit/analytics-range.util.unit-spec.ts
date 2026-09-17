import {
  ANALYTICS_MAX_RANGE_DAYS,
  analyticsDateKey,
  parseAnalyticsBoundary,
  resolveAnalyticsRange,
} from '../../src/analytics/analytics-range.util';

describe('analytics-range.util', () => {
  describe('parseAnalyticsBoundary', () => {
    it('parses YYYY-MM-DD as local start/end of day', () => {
      const start = parseAnalyticsBoundary('2024-06-15', false)!;
      expect(start.getFullYear()).toBe(2024);
      expect(start.getMonth()).toBe(5);
      expect(start.getDate()).toBe(15);
      expect(start.getHours()).toBe(0);
      expect(start.getMinutes()).toBe(0);

      const end = parseAnalyticsBoundary('2024-06-15', true)!;
      expect(end.getHours()).toBe(23);
      expect(end.getMinutes()).toBe(59);
      expect(end.getMilliseconds()).toBe(999);
    });

    it('returns null for empty/invalid', () => {
      expect(parseAnalyticsBoundary(undefined, false)).toBeNull();
      expect(parseAnalyticsBoundary('  ', true)).toBeNull();
      expect(parseAnalyticsBoundary('not-a-date', false)).toBeNull();
    });
  });

  describe('analyticsDateKey', () => {
    it('formats local calendar date', () => {
      expect(analyticsDateKey(new Date(2024, 0, 5))).toBe('2024-01-05');
      expect(analyticsDateKey(new Date(2024, 11, 31))).toBe('2024-12-31');
    });
  });

  describe('resolveAnalyticsRange', () => {
    const now = new Date(2024, 5, 30, 12, 0, 0);

    it('defaults to last 30 days ending today', () => {
      const range = resolveAnalyticsRange(undefined, undefined, now);
      expect(range.ok).toBe(true);
      if (!range.ok) return;
      expect(analyticsDateKey(range.end)).toBe('2024-06-30');
      expect(analyticsDateKey(range.start)).toBe('2024-06-01');
    });

    it('returns inverted when from > to', () => {
      expect(
        resolveAnalyticsRange('2024-07-01', '2024-06-01', now),
      ).toEqual({ ok: false, reason: 'inverted' });
    });

    it('rejects ranges longer than max days', () => {
      const result = resolveAnalyticsRange('2023-01-01', '2024-12-31', now);
      expect(result).toEqual({
        ok: false,
        reason: 'too_long',
        maxDays: ANALYTICS_MAX_RANGE_DAYS,
      });
    });

    it('accepts an exact max-day window', () => {
      const start = new Date(now);
      start.setDate(start.getDate() - (ANALYTICS_MAX_RANGE_DAYS - 1));
      const from = analyticsDateKey(start);
      const to = analyticsDateKey(now);
      const range = resolveAnalyticsRange(from, to, now);
      expect(range.ok).toBe(true);
    });
  });
});
