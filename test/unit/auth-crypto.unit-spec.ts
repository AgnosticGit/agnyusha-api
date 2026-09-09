import type { ConfigService } from '@nestjs/config';
import {
  clearCookieOptions,
  cookieSameSite,
  cookieSecure,
  createRawToken,
  hashToken,
  sessionCookieOptions,
} from '../../src/auth/auth.crypto';

function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('auth.crypto', () => {
  describe('hashToken', () => {
    it('returns a stable sha256 hex digest', () => {
      expect(hashToken('abc')).toBe(hashToken('abc'));
      expect(hashToken('abc')).toHaveLength(64);
      expect(hashToken('abc')).not.toBe(hashToken('abcd'));
    });
  });

  describe('createRawToken', () => {
    it('returns unique base64url tokens', () => {
      const a = createRawToken();
      const b = createRawToken();
      expect(a).not.toBe(b);
      expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
      expect(createRawToken(16)).toHaveLength(22);
    });
  });

  describe('cookieSameSite', () => {
    it('parses none/strict/lax and defaults to lax', () => {
      expect(cookieSameSite(fakeConfig({ COOKIE_SAMESITE: 'none' }))).toBe(
        'none',
      );
      expect(cookieSameSite(fakeConfig({ COOKIE_SAMESITE: ' Strict ' }))).toBe(
        'strict',
      );
      expect(cookieSameSite(fakeConfig({ COOKIE_SAMESITE: 'LAX' }))).toBe(
        'lax',
      );
      expect(cookieSameSite(fakeConfig({ COOKIE_SAMESITE: 'weird' }))).toBe(
        'lax',
      );
      expect(cookieSameSite(fakeConfig({}))).toBe('lax');
    });
  });

  describe('cookieSecure', () => {
    it('honors explicit COOKIE_SECURE', () => {
      expect(cookieSecure(fakeConfig({ COOKIE_SECURE: 'true' }))).toBe(true);
      expect(cookieSecure(fakeConfig({ COOKIE_SECURE: '1' }))).toBe(true);
      expect(cookieSecure(fakeConfig({ COOKIE_SECURE: 'false' }))).toBe(false);
      expect(cookieSecure(fakeConfig({ COOKIE_SECURE: '0' }))).toBe(false);
    });

    it('forces secure when sameSite is none', () => {
      expect(
        cookieSecure(
          fakeConfig({
            COOKIE_SAMESITE: 'none',
            NODE_ENV: 'development',
          }),
        ),
      ).toBe(true);
    });

    it('falls back to production NODE_ENV', () => {
      expect(cookieSecure(fakeConfig({ NODE_ENV: 'production' }))).toBe(true);
      expect(cookieSecure(fakeConfig({ NODE_ENV: 'development' }))).toBe(
        false,
      );
    });
  });

  describe('sessionCookieOptions / clearCookieOptions', () => {
    it('builds session options and forces secure when sameSite is none', () => {
      expect(sessionCookieOptions(false, 1000, 'lax')).toEqual({
        httpOnly: true,
        secure: false,
        sameSite: 'lax',
        path: '/',
        maxAge: 1000,
      });
      expect(sessionCookieOptions(false, 1000, 'none')).toEqual({
        httpOnly: true,
        secure: true,
        sameSite: 'none',
        path: '/',
        maxAge: 1000,
      });
      expect(sessionCookieOptions(true, 500, 'strict')).toMatchObject({
        secure: true,
        sameSite: 'strict',
        maxAge: 500,
      });
    });

    it('builds clear options with sameSite none forcing secure', () => {
      expect(clearCookieOptions(false, 'lax')).toEqual({
        path: '/',
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
      });
      expect(clearCookieOptions(false, 'none')).toEqual({
        path: '/',
        httpOnly: true,
        sameSite: 'none',
        secure: true,
      });
    });
  });
});
