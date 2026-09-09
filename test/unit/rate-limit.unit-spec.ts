import { SlidingWindowRateLimiter } from '../../src/common/rate-limit';

describe('SlidingWindowRateLimiter', () => {
  it('allows up to the burst then blocks the same key', () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
  });

  it('tracks keys independently', () => {
    const limiter = new SlidingWindowRateLimiter(1, 60_000);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
    expect(limiter.tryConsume('b')).toBe(true);
  });

  it('expires hits after the window using fake timers', () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-01-01T00:00:00.000Z'));
    const limiter = new SlidingWindowRateLimiter(1, 1_000);

    expect(limiter.tryConsume('k')).toBe(true);
    expect(limiter.tryConsume('k')).toBe(false);

    jest.setSystemTime(new Date('2026-01-01T00:00:01.100Z'));
    expect(limiter.tryConsume('k')).toBe(true);

    jest.useRealTimers();
  });
});
