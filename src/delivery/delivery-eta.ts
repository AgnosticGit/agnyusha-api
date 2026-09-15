import type { DeliveryMethodCode } from '@prisma/client';
import type { DeliveryAvailability } from './delivery-availability';

export type DeliveryEta = {
  minDays: number;
  maxDays: number;
  text: string;
  /** Quoted delivery cost in rubles when the carrier returns it. */
  price?: number | null;
};

export type DeliveryMethodWithEta = DeliveryAvailability & {
  etaMinDays?: number | null;
  etaMaxDays?: number | null;
  etaText?: string | null;
  /** Carrier-quoted price in rubles (null when unknown). */
  price?: number | null;
};

/** Russian plural for «день». */
export function dayWord(n: number): string {
  const abs = Math.abs(Math.trunc(n));
  const n10 = abs % 10;
  const n100 = abs % 100;
  if (n10 === 1 && n100 !== 11) return 'день';
  if (n10 >= 2 && n10 <= 4 && (n100 < 12 || n100 > 14)) return 'дня';
  return 'дней';
}

/** Human ETA like «3–5 дней» / «1 день». */
export function formatEtaDays(minDays: number, maxDays: number): string | null {
  if (!Number.isFinite(minDays) || !Number.isFinite(maxDays)) return null;
  const min = Math.max(0, Math.trunc(minDays));
  const max = Math.max(min, Math.trunc(maxDays));
  if (min === max) return `${min} ${dayWord(min)}`;
  return `${min}–${max} ${dayWord(max)}`;
}

export function etaFromDayRange(
  minDays: number | null | undefined,
  maxDays: number | null | undefined,
): DeliveryEta | null {
  // Otpravka often returns only max-days for short routes (no min-days).
  const hasMin = typeof minDays === 'number' && Number.isFinite(minDays);
  const hasMax = typeof maxDays === 'number' && Number.isFinite(maxDays);
  if (!hasMin && !hasMax) return null;
  const rawMin = hasMin ? minDays! : maxDays!;
  const rawMax = hasMax ? maxDays! : minDays!;
  const min = Math.max(0, Math.trunc(rawMin));
  const max = Math.max(min, Math.trunc(rawMax));
  const text = formatEtaDays(min, max);
  if (!text) return null;
  return { minDays: min, maxDays: max, text };
}

/** Calendar days from UTC today to an ISO date (inclusive of target day). */
export function calendarDaysFromNow(
  iso: string,
  now: Date = new Date(),
): number | null {
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return null;
  const start = Date.UTC(
    now.getUTCFullYear(),
    now.getUTCMonth(),
    now.getUTCDate(),
  );
  const end = Date.UTC(
    target.getUTCFullYear(),
    target.getUTCMonth(),
    target.getUTCDate(),
  );
  return Math.max(0, Math.round((end - start) / 86_400_000));
}

export function etaFromIsoInterval(
  minIso: string | null | undefined,
  maxIso: string | null | undefined,
  now: Date = new Date(),
): DeliveryEta | null {
  if (!minIso && !maxIso) return null;
  const minDays = calendarDaysFromNow(minIso || maxIso!, now);
  const maxDays = calendarDaysFromNow(maxIso || minIso!, now);
  return etaFromDayRange(minDays, maxDays);
}

export function applyEtaToMethod(
  method: DeliveryAvailability,
  eta: DeliveryEta | null | undefined,
): DeliveryMethodWithEta {
  if (!eta || !method.available) {
    return {
      ...method,
      etaMinDays: null,
      etaMaxDays: null,
      etaText: null,
      price: null,
    };
  }
  const baseNote = method.note?.trim();
  const price =
    typeof eta.price === 'number' && Number.isFinite(eta.price) && eta.price >= 0
      ? Math.round(eta.price)
      : null;
  return {
    ...method,
    etaMinDays: eta.minDays,
    etaMaxDays: eta.maxDays,
    etaText: eta.text,
    price,
    note: baseNote ? `${eta.text} · ${baseNote}` : eta.text,
  };
}

export function pickEtaForCode(
  code: DeliveryMethodCode,
  etas: {
    cdek?: DeliveryEta | null;
    yandex?: DeliveryEta | null;
    pochta?: DeliveryEta | null;
  },
): DeliveryEta | null {
  if (code === 'CDEK') return etas.cdek ?? null;
  if (code === 'YANDEX') return etas.yandex ?? null;
  if (code === 'POST') return etas.pochta ?? null;
  return null;
}
