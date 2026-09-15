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
  return {
    average: Math.round((sum / valid.length) * 10) / 10,
    count: valid.length,
  };
}
