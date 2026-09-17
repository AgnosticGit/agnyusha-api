import type { Request, Response, NextFunction } from 'express';
import { HttpStatus } from '@nestjs/common';
import { resolveClientIp } from './client-ip';
import { SlidingWindowRateLimiter } from './rate-limit';

const WINDOW_MS = 60_000;
const RATE_LIMIT_MESSAGE = 'Слишком много запросов. Попробуйте позже.';

function isTestEnv(): boolean {
  return process.env.NODE_ENV === 'test';
}

function envLimit(name: string, prodDefault: number, testDefault: number): number {
  const raw = process.env[name];
  if (raw !== undefined && raw.trim() !== '') {
    const n = Number.parseInt(raw, 10);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return isTestEnv() ? testDefault : prodDefault;
}

export function pathnameFromRequest(req: Request): string {
  return req.originalUrl.split('?')[0];
}

/** Health probes and payment webhooks must not be throttled. */
export function isApiRateLimitExempt(method: string, path: string): boolean {
  const m = method.toUpperCase();
  if (m === 'GET' && (path === '/api/health/live' || path === '/api/health/ready')) {
    return true;
  }
  if (m === 'POST' && path === '/api/payments/ozon/webhook') {
    return true;
  }
  return false;
}

export function isCitiesSearchRoute(method: string, path: string): boolean {
  return method.toUpperCase() === 'GET' && path === '/api/cities/search';
}

export function isOrdersWriteRoute(method: string, path: string): boolean {
  if (method.toUpperCase() !== 'POST') return false;
  if (path === '/api/orders') return true;
  return /^\/api\/orders\/[^/]+\/pay$/.test(path);
}

export type ApiRateLimitBuckets = {
  global: SlidingWindowRateLimiter;
  citiesSearch: SlidingWindowRateLimiter;
  ordersWrite: SlidingWindowRateLimiter;
};

export function createApiRateLimitBuckets(): ApiRateLimitBuckets {
  return {
    global: new SlidingWindowRateLimiter(
      envLimit('API_IP_LIMIT', 120, 10_000),
      WINDOW_MS,
    ),
    citiesSearch: new SlidingWindowRateLimiter(
      envLimit('CITIES_SEARCH_IP_LIMIT', 30, 10_000),
      WINDOW_MS,
    ),
    ordersWrite: new SlidingWindowRateLimiter(
      envLimit('ORDERS_WRITE_IP_LIMIT', 10, 10_000),
      WINDOW_MS,
    ),
  };
}

function respondTooManyRequests(res: Response): void {
  res.status(HttpStatus.TOO_MANY_REQUESTS).json({
    statusCode: HttpStatus.TOO_MANY_REQUESTS,
    message: RATE_LIMIT_MESSAGE,
  });
}

/**
 * Per-IP limits on /api/* (see env API_IP_LIMIT, CITIES_SEARCH_IP_LIMIT, ORDERS_WRITE_IP_LIMIT).
 */
export function createApiRateLimitMiddleware(
  buckets: ApiRateLimitBuckets = createApiRateLimitBuckets(),
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.path.startsWith('/api')) {
      next();
      return;
    }

    const path = pathnameFromRequest(req);
    const method = req.method;

    if (isApiRateLimitExempt(method, path)) {
      next();
      return;
    }

    const ip = resolveClientIp(req);

    if (!buckets.global.tryConsume(ip)) {
      respondTooManyRequests(res);
      return;
    }

    if (isCitiesSearchRoute(method, path) && !buckets.citiesSearch.tryConsume(ip)) {
      respondTooManyRequests(res);
      return;
    }

    if (isOrdersWriteRoute(method, path) && !buckets.ordersWrite.tryConsume(ip)) {
      respondTooManyRequests(res);
      return;
    }

    next();
  };
}
