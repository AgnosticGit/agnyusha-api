import type { Request, Response } from 'express';
import {
  createApiRateLimitBuckets,
  createApiRateLimitMiddleware,
  isApiRateLimitExempt,
  isCitiesSearchRoute,
  isOrdersWriteRoute,
} from '../../src/common/api-rate-limit';
import { SlidingWindowRateLimiter } from '../../src/common/rate-limit';

describe('api-rate-limit routes', () => {
  describe('isApiRateLimitExempt', () => {
    it('exempts health live and ready', () => {
      expect(isApiRateLimitExempt('GET', '/api/health/live')).toBe(true);
      expect(isApiRateLimitExempt('GET', '/api/health/ready')).toBe(true);
      expect(isApiRateLimitExempt('GET', '/api/health')).toBe(false);
    });

    it('exempts Ozon webhook only', () => {
      expect(isApiRateLimitExempt('POST', '/api/payments/ozon/webhook')).toBe(
        true,
      );
      expect(isApiRateLimitExempt('POST', '/api/payments/ozon/confirm')).toBe(
        false,
      );
    });
  });

  describe('isCitiesSearchRoute', () => {
    it('matches cities search GET', () => {
      expect(isCitiesSearchRoute('GET', '/api/cities/search')).toBe(true);
      expect(isCitiesSearchRoute('get', '/api/cities/search')).toBe(true);
      expect(isCitiesSearchRoute('POST', '/api/cities/search')).toBe(false);
    });
  });

  describe('isOrdersWriteRoute', () => {
    it('matches create order and pay', () => {
      expect(isOrdersWriteRoute('POST', '/api/orders')).toBe(true);
      expect(
        isOrdersWriteRoute('POST', '/api/orders/abc-123/pay'),
      ).toBe(true);
    });

    it('does not match other order routes', () => {
      expect(isOrdersWriteRoute('POST', '/api/orders/reconcile-payments')).toBe(
        false,
      );
      expect(isOrdersWriteRoute('POST', '/api/orders/abc/cancel')).toBe(false);
      expect(isOrdersWriteRoute('GET', '/api/orders')).toBe(false);
    });
  });
});

describe('createApiRateLimitMiddleware', () => {
  function run(
    middleware: ReturnType<typeof createApiRateLimitMiddleware>,
    path: string,
    method = 'GET',
  ) {
    let status = 0;
    let body: unknown;
    const req = {
      path,
      method,
      originalUrl: path,
      headers: {},
      ip: '1.2.3.4',
      socket: { remoteAddress: '1.2.3.4' },
    } as Request;
    const res = {
      status(code: number) {
        status = code;
        return this;
      },
      json(payload: unknown) {
        body = payload;
        return this;
      },
    } as Response;
    let nextCalled = false;
    middleware(req, res, () => {
      nextCalled = true;
    });
    return { status, body, nextCalled };
  }

  it('returns 429 when global bucket is exhausted', () => {
    const buckets = {
      global: new SlidingWindowRateLimiter(1, 60_000),
      citiesSearch: new SlidingWindowRateLimiter(30, 60_000),
      ordersWrite: new SlidingWindowRateLimiter(10, 60_000),
    };
    const mw = createApiRateLimitMiddleware(buckets);
    expect(run(mw, '/api/products').nextCalled).toBe(true);
    const blocked = run(mw, '/api/products');
    expect(blocked.nextCalled).toBe(false);
    expect(blocked.status).toBe(429);
  });

  it('skips non-api paths', () => {
    const buckets = createApiRateLimitBuckets();
    const mw = createApiRateLimitMiddleware(buckets);
    expect(run(mw, '/uploads/x.png').nextCalled).toBe(true);
  });
});
