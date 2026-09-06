import { createHash, randomBytes } from 'crypto';
import type { ConfigService } from '@nestjs/config';

export const SESSION_COOKIE = 'agnyusha_session';
export const OAUTH_STATE_COOKIE = 'agnyusha_oauth_state';

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function createRawToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function cookieSecure(config: ConfigService): boolean {
  const explicit = config.get<string>('COOKIE_SECURE')?.trim().toLowerCase();
  if (explicit === 'true' || explicit === '1') return true;
  if (explicit === 'false' || explicit === '0') return false;
  return config.get<string>('NODE_ENV') === 'production';
}

export function sessionCookieOptions(secure: boolean, maxAgeMs: number) {
  return {
    httpOnly: true,
    secure,
    sameSite: 'lax' as const,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function clearCookieOptions(secure: boolean) {
  return {
    path: '/',
    httpOnly: true,
    sameSite: 'lax' as const,
    secure,
  };
}
