export const REVIEW_ELIGIBLE_STATUSES = [
  'PAID',
  'CONFIRMED',
  'SHIPPED',
  'READY_FOR_PICKUP',
  'DONE',
] as const;

export type ReviewEligibleStatus = (typeof REVIEW_ELIGIBLE_STATUSES)[number];

export function isReviewEligibleStatus(status: string): boolean {
  return (REVIEW_ELIGIBLE_STATUSES as readonly string[]).includes(status);
}

export function clampRating(value: unknown): number | null {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n) || n < 1 || n > 5) return null;
  return n;
}

export function computeRatingAggregate(
  ratings: number[],
): { average: number; count: number } {
  const valid = ratings.filter((r) => r >= 1 && r <= 5);
  if (!valid.length) return { average: 0, count: 0 };
  const sum = valid.reduce((a, b) => a + b, 0);
  return averageFromSum(sum, valid.length);
}

/** Round Prisma `_avg` / `_count` the same way as `computeRatingAggregate`. */
export function averageFromAggregate(
  avg: number | null | undefined,
  count: number,
): { average: number; count: number } {
  if (!count || count < 0) return { average: 0, count: 0 };
  return {
    average: Math.round((Number(avg) || 0) * 10) / 10,
    count,
  };
}

function averageFromSum(sum: number, count: number) {
  return {
    average: Math.round((sum / count) * 10) / 10,
    count,
  };
}
