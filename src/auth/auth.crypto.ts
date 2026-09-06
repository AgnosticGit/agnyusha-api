import { createHash, randomBytes } from 'crypto';
import type { ConfigService } from '@nestjs/config';

export const SESSION_COOKIE = 'agnyusha_session';
export const OAUTH_STATE_COOKIE = 'agnyusha_oauth_state';
export const CART_COOKIE = 'agnyusha_cart';
export const CART_TTL_MS = 30 * 24 * 60 * 60 * 1000;

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
  if (cookieSameSite(config) === 'none') return true;
  return config.get<string>('NODE_ENV') === 'production';
}

export function cookieSameSite(
  config: ConfigService,
): 'lax' | 'strict' | 'none' {
  const raw = config.get<string>('COOKIE_SAMESITE')?.trim().toLowerCase();
  if (raw === 'none' || raw === 'strict' || raw === 'lax') return raw;
  return 'lax';
}

export function sessionCookieOptions(
  secure: boolean,
  maxAgeMs: number,
  sameSite: 'lax' | 'strict' | 'none' = 'lax',
) {
  return {
    httpOnly: true,
    secure: sameSite === 'none' ? true : secure,
    sameSite,
    path: '/',
    maxAge: maxAgeMs,
  };
}

export function clearCookieOptions(
  secure: boolean,
  sameSite: 'lax' | 'strict' | 'none' = 'lax',
) {
  return {
    path: '/',
    httpOnly: true,
    sameSite,
    secure: sameSite === 'none' ? true : secure,
  };
}
