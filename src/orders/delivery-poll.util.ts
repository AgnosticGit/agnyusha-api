export const DEFAULT_POLL_INTERVAL_MIN = 60;
export const DEFAULT_POLL_GAP_MS = 2500;
export const POLL_TICK_MS = 1000;

export type DeliveryPollCarrier = 'CDEK' | 'YANDEX' | 'POST';

export const DELIVERY_POLL_CARRIERS: DeliveryPollCarrier[] = [
  'CDEK',
  'YANDEX',
  'POST',
];

export const DELIVERY_POLL_ENV: Record<
  DeliveryPollCarrier,
  { interval: string; gap: string }
> = {
  CDEK: {
    interval: 'CDEK_POLL_INTERVAL_MIN',
    gap: 'CDEK_POLL_GAP_MS',
  },
  YANDEX: {
    interval: 'YANDEX_POLL_INTERVAL_MIN',
    gap: 'YANDEX_POLL_GAP_MS',
  },
  POST: {
    interval: 'POCHTA_POLL_INTERVAL_MIN',
    gap: 'POCHTA_POLL_GAP_MS',
  },
};

export type DeliveryPollSnapshot = {
  carrier: DeliveryPollCarrier;
  enabled: boolean;
  intervalMs: number;
  gapMs: number;
  activeCount: number;
  lastSuccessAt: Date | null;
  lastAttemptAt: Date | null;
  lastError: string | null;
};

/** 0 disables the poller. Negative / NaN → default. */
export function parsePollIntervalMin(
  raw: string | undefined,
  fallback = DEFAULT_POLL_INTERVAL_MIN,
): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 0) return fallback;
  return n;
}

export function parsePollGapMs(
  raw: string | undefined,
  fallback = DEFAULT_POLL_GAP_MS,
): number {
  if (raw == null || raw.trim() === '') return fallback;
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return fallback;
  return n;
}

export function isGapElapsed(
  lastRequestAtMs: number | null,
  gapMs: number,
  nowMs: number,
): boolean {
  if (lastRequestAtMs == null) return true;
  return nowMs - lastRequestAtMs >= gapMs;
}

export function isOrderDueForPoll(
  deliveryStatusAt: Date | null,
  intervalMs: number,
  nowMs: number,
): boolean {
  if (!deliveryStatusAt) return true;
  return nowMs - deliveryStatusAt.getTime() >= intervalMs;
}

/** Oldest last-poll first; never-polled (null) wins. */
export function pickOldestDue<T extends { deliveryStatusAt: Date | null }>(
  orders: T[],
  intervalMs: number,
  nowMs: number,
): T | null {
  let picked: T | null = null;
  let pickedAt = Number.POSITIVE_INFINITY;
  for (const order of orders) {
    if (!isOrderDueForPoll(order.deliveryStatusAt, intervalMs, nowMs)) {
      continue;
    }
    const at = order.deliveryStatusAt?.getTime() ?? 0;
    if (at < pickedAt) {
      picked = order;
      pickedAt = at;
    }
  }
  return picked;
}

export function canPollKeepUp(
  activeCount: number,
  gapMs: number,
  intervalMs: number,
): boolean {
  if (activeCount <= 0) return true;
  if (intervalMs <= 0) return true;
  return activeCount * gapMs <= intervalMs;
}

export function evaluatePollHealth(
  snapshot: DeliveryPollSnapshot,
  nowMs = Date.now(),
): 'ok' | 'degraded' {
  if (!snapshot.enabled) return 'ok';
  if (snapshot.activeCount <= 0) return 'ok';
  if (
    !canPollKeepUp(snapshot.activeCount, snapshot.gapMs, snapshot.intervalMs)
  ) {
    return 'degraded';
  }
  if (snapshot.lastError && !snapshot.lastSuccessAt) return 'degraded';
  if (snapshot.lastSuccessAt) {
    const staleAfter = snapshot.intervalMs * 2;
    if (nowMs - snapshot.lastSuccessAt.getTime() > staleAfter) {
      return 'degraded';
    }
  }
  return 'ok';
}

export function formatPollHealthMessage(
  snapshot: DeliveryPollSnapshot,
): string {
  const intervalMin = Math.round(snapshot.intervalMs / 60_000);
  const gapSec = snapshot.gapMs / 1000;
  const last =
    snapshot.lastSuccessAt == null
      ? 'ещё не было'
      : snapshot.lastSuccessAt.toISOString();
  const parts = [
    `опрос: очередь ${snapshot.activeCount}`,
    `последний успех ${last}`,
    `интервал ${intervalMin} мин`,
    `пауза ${gapSec} с`,
  ];
  if (!snapshot.enabled) {
    return `опрос выключен · интервал ${intervalMin} мин`;
  }
  if (
    !canPollKeepUp(snapshot.activeCount, snapshot.gapMs, snapshot.intervalMs)
  ) {
    parts.push('не укладывается в интервал');
  }
  if (snapshot.lastError) {
    parts.push(`ошибка ${snapshot.lastError}`);
  }
  return parts.join(', ');
}

export function mergeHealthStatus(
  ping: 'ok' | 'degraded' | 'down' | 'skipped',
  poll: 'ok' | 'degraded',
): 'ok' | 'degraded' | 'down' | 'skipped' {
  if (ping === 'down') return 'down';
  if (ping === 'skipped') return 'skipped';
  if (ping === 'degraded' || poll === 'degraded') return 'degraded';
  return 'ok';
}

export function appendPollMessage(
  pingMessage: string | null | undefined,
  pollMessage: string,
): string {
  const base = pingMessage?.trim() || '';
  if (!base) return pollMessage;
  return `${base} · ${pollMessage}`;
}
