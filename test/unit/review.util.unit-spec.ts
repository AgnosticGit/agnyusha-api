import {
  clampRating,
  computeRatingAggregate,
  averageFromAggregate,
  isReviewEligibleStatus,
} from '../../src/reviews/review.util';

describe('review.util', () => {
  it('clamps rating 1-5', () => {
    expect(clampRating(3)).toBe(3);
    expect(clampRating(0)).toBeNull();
    expect(clampRating(6)).toBeNull();
    expect(clampRating('4.4')).toBe(4);
  });

  it('aggregates average to one decimal', () => {
    expect(computeRatingAggregate([5, 4, 5])).toEqual({
      average: 4.7,
      count: 3,
    });
    expect(computeRatingAggregate([])).toEqual({ average: 0, count: 0 });
  });

  it('rounds Prisma aggregate avg/count', () => {
    expect(averageFromAggregate(4.666, 3)).toEqual({ average: 4.7, count: 3 });
    expect(averageFromAggregate(null, 0)).toEqual({ average: 0, count: 0 });
  });

  it('eligible statuses', () => {
    expect(isReviewEligibleStatus('PAID')).toBe(true);
    expect(isReviewEligibleStatus('NEW')).toBe(false);
    expect(isReviewEligibleStatus('CANCELLED')).toBe(false);
  });
});
