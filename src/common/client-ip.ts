import type { Request } from 'express';

/** First hop in X-Forwarded-For (Caddy / reverse proxy). */
export function resolveClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip || req.socket.remoteAddress || 'unknown';
}
