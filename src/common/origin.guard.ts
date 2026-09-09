import type { NextFunction, Request, Response } from 'express';

/**
 * Defense-in-depth for cookie-authenticated mutating requests:
 * require Origin (or Referer) to match an allowed CORS origin.
 * Safe no-op when neither header is present (same-origin navigations / some clients).
 */
export function createOriginGuard(allowedOrigins: string[]) {
  const allowed = new Set(allowedOrigins.map((o) => o.trim()).filter(Boolean));

  return (req: Request, res: Response, next: NextFunction) => {
    const method = req.method.toUpperCase();
    if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') {
      return next();
    }

    const originHeader = req.headers.origin;
    const referer = req.headers.referer;
    let origin = typeof originHeader === 'string' ? originHeader : '';
    if (!origin && typeof referer === 'string') {
      try {
        origin = new URL(referer).origin;
      } catch {
        origin = '';
      }
    }

    if (!origin) return next();
    if (allowed.has(origin)) return next();

    return res.status(403).json({
      statusCode: 403,
      message: 'Forbidden origin',
    });
  };
}
