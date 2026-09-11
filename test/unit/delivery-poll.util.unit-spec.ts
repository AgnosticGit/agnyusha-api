import {
  DEFAULT_POLL_GAP_MS,
  DEFAULT_POLL_INTERVAL_MIN,
  appendPollMessage,
  canPollKeepUp,
  evaluatePollHealth,
  formatPollHealthMessage,
  isGapElapsed,
  isOrderDueForPoll,
  mergeHealthStatus,
  parsePollGapMs,
  parsePollIntervalMin,
  pickOldestDue,
  type DeliveryPollSnapshot,
} from '../../src/orders/delivery-poll.util';

function snapshot(
  overrides: Partial<DeliveryPollSnapshot> = {},
): DeliveryPollSnapshot {
  return {
    carrier: 'CDEK',
    enabled: true,
    intervalMs: 60 * 60_000,
    gapMs: 2500,
    activeCount: 0,
    lastSuccessAt: null,
    lastAttemptAt: null,
    lastError: null,
    ...overrides,
  };
}

describe('delivery-poll.util', () => {
  describe('parsePollIntervalMin', () => {
    it('uses default when empty and allows 0 to disable', () => {
      expect(parsePollIntervalMin(undefined)).toBe(DEFAULT_POLL_INTERVAL_MIN);
      expect(parsePollIntervalMin('')).toBe(DEFAULT_POLL_INTERVAL_MIN);
      expect(parsePollIntervalMin('0')).toBe(0);
      expect(parsePollIntervalMin('90')).toBe(90);
      expect(parsePollIntervalMin('-1')).toBe(DEFAULT_POLL_INTERVAL_MIN);
      expect(parsePollIntervalMin('1.5')).toBe(DEFAULT_POLL_INTERVAL_MIN);
    });
  });

  describe('parsePollGapMs', () => {
    it('rejects zero and non-integers', () => {
      expect(parsePollGapMs(undefined)).toBe(DEFAULT_POLL_GAP_MS);
      expect(parsePollGapMs('0')).toBe(DEFAULT_POLL_GAP_MS);
      expect(parsePollGapMs('3000')).toBe(3000);
      expect(parsePollGapMs('nope')).toBe(DEFAULT_POLL_GAP_MS);
    });
  });

  describe('isGapElapsed', () => {
    it('allows the first request immediately', () => {
      expect(isGapElapsed(null, 2500, 10_000)).toBe(true);
      expect(isGapElapsed(8000, 2500, 10_000)).toBe(false);
      expect(isGapElapsed(7500, 2500, 10_000)).toBe(true);
    });
  });

  describe('isOrderDueForPoll / pickOldestDue', () => {
    const hour = 60 * 60_000;
    const now = Date.parse('2026-09-11T12:00:00.000Z');

    it('treats never-polled orders as due', () => {
      expect(isOrderDueForPoll(null, hour, now)).toBe(true);
      expect(isOrderDueForPoll(new Date(now - hour), hour, now)).toBe(true);
      expect(isOrderDueForPoll(new Date(now - hour + 1), hour, now)).toBe(
        false,
      );
    });

    it('picks never-polled before an older due order', () => {
      const fresh = {
        id: 'fresh',
        deliveryStatusAt: new Date(now - hour),
      };
      const never = { id: 'never', deliveryStatusAt: null };
      const notDue = {
        id: 'recent',
        deliveryStatusAt: new Date(now - 1000),
      };
      expect(pickOldestDue([fresh, never, notDue], hour, now)?.id).toBe(
        'never',
      );
    });

    it('returns null when nobody is due', () => {
      expect(
        pickOldestDue([{ deliveryStatusAt: new Date(now - 1000) }], hour, now),
      ).toBeNull();
    });
  });

  describe('canPollKeepUp / evaluatePollHealth', () => {
    it('flags a queue that cannot finish within the interval', () => {
      expect(canPollKeepUp(100, 2500, 60 * 60_000)).toBe(true);
      expect(canPollKeepUp(2000, 2500, 60 * 60_000)).toBe(false);
      expect(
        evaluatePollHealth(snapshot({ activeCount: 2000, gapMs: 2500 })),
      ).toBe('degraded');
    });

    it('is ok with an empty queue even without a success yet', () => {
      expect(evaluatePollHealth(snapshot())).toBe('ok');
    });

    it('degrades when the last success is older than two intervals', () => {
      const now = Date.parse('2026-09-11T12:00:00.000Z');
      expect(
        evaluatePollHealth(
          snapshot({
            activeCount: 2,
            lastSuccessAt: new Date(now - 3 * 60 * 60_000),
          }),
          now,
        ),
      ).toBe('degraded');
    });

    it('degrades when there is an error and never a success', () => {
      expect(
        evaluatePollHealth(snapshot({ activeCount: 1, lastError: 'timeout' })),
      ).toBe('degraded');
    });
  });

  describe('format / merge messages', () => {
    it('includes last success time and queue size', () => {
      const at = new Date('2026-09-11T13:03:00.000Z');
      expect(
        formatPollHealthMessage(
          snapshot({ activeCount: 12, lastSuccessAt: at }),
        ),
      ).toBe(
        'опрос: очередь 12, последний успех 2026-09-11T13:03:00.000Z, интервал 60 мин, пауза 2.5 с',
      );
    });

    it('merges ping and poll statuses without hiding a down ping', () => {
      expect(mergeHealthStatus('ok', 'degraded')).toBe('degraded');
      expect(mergeHealthStatus('down', 'ok')).toBe('down');
      expect(appendPollMessage('API отвечает', 'опрос: очередь 0')).toBe(
        'API отвечает · опрос: очередь 0',
      );
    });
  });
});
