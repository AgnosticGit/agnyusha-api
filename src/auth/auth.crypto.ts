import { createHash, randomBytes } from 'crypto';

export const SESSION_COOKIE = 'agnyusha_session';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createRawToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sessionCookieOptions(isProd: boolean, maxAgeMs: number) {
  return {
    httpOnly: true,
    secure: isProd,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeMs,
  };
}
