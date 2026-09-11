import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/cdek-test.helpers';
import type { SendMailInput } from '../src/mail/mail.tokens';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashToken } from '../src/auth/auth.crypto';
import { UserRole } from '@prisma/client';

function createMailCapture() {
  const sent: SendMailInput[] = [];
  const mailSend = async (input: SendMailInput) => {
    sent.push(input);
  };
  return { mailSend, sent };
}

function extractToken(text: string): string {
  const match = text.match(/token=([^\s&]+)/);
  if (!match?.[1]) throw new Error('token not found in mail');
  return decodeURIComponent(match[1]);
}

function cookieHeader(setCookie: string | string[] | undefined): string {
  const raw = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  return raw.map((c) => c.split(';')[0]).join('; ');
}

describe('Auth magic link (e2e)', () => {
  let app: INestApplication;
  let sent: SendMailInput[];

  beforeAll(async () => {
    const capture = createMailCapture();
    sent = capture.sent;
    const created = await createTestApp({
      mailSend: capture.mailSend,
      cdek: 'missing',
      yandex: 'missing',
    });
    app = created.app;

    const prisma = app.get(PrismaService);
    const emails = [
      'auth-test@example.com',
      'auth-expire@example.com',
      'auth-reuse@example.com',
      'auth-cooldown@example.com',
      'auth-user-role@example.com',
      'origin-block@example.com',
    ];
    await prisma.session.deleteMany({
      where: { user: { email: { in: emails } } },
    });
    await prisma.magicLink.deleteMany({
      where: { user: { email: { in: emails } } },
    });
    await prisma.user.deleteMany({
      where: { email: { in: emails } },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('requests magic link, verifies, me, logout', async () => {
    sent.length = 0;

    await request(app.getHttpServer())
      .post('/api/auth/magic-link')
      .send({ email: 'auth-test@example.com' })
      .expect(200)
      .expect({ ok: true });

    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('auth-test@example.com');
    const token = extractToken(sent[0].text);

    const verify = await request(app.getHttpServer())
      .post('/api/auth/verify')
      .send({ token })
      .expect(200);

    expect(verify.body.user.email).toBe('auth-test@example.com');
    const setCookie = verify.headers['set-cookie'];
    expect(setCookie).toBeDefined();
    expect(String(setCookie)).toMatch(/HttpOnly/i);
    expect(String(setCookie)).toMatch(/SameSite=Lax/i);
    const cookie = cookieHeader(setCookie);

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);

    expect(me.body.user.email).toBe('auth-test@example.com');

    await request(app.getHttpServer())
      .post('/api/auth/logout')
      .set('Cookie', cookie)
      .expect(200);

    const meAfter = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', cookie)
      .expect(200);

    expect(meAfter.body.user).toBeNull();
  });

  it('rejects invalid token', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/verify')
      .send({ token: 'definitely-not-a-valid-token' })
      .expect(401);
  });

  it('rejects already consumed magic link', async () => {
    sent.length = 0;
    await request(app.getHttpServer())
      .post('/api/auth/magic-link')
      .send({ email: 'auth-reuse@example.com' })
      .expect(200);
    const token = extractToken(sent[0].text);

    await request(app.getHttpServer())
      .post('/api/auth/verify')
      .send({ token })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/auth/verify')
      .send({ token })
      .expect(401);
  });

  it('rejects expired magic link', async () => {
    sent.length = 0;
    await request(app.getHttpServer())
      .post('/api/auth/magic-link')
      .send({ email: 'auth-expire@example.com' })
      .expect(200);
    const token = extractToken(sent[0].text);

    const prisma = app.get(PrismaService);
    await prisma.magicLink.updateMany({
      where: { tokenHash: hashToken(token) },
      data: { expiresAt: new Date(Date.now() - 60_000), consumedAt: null },
    });

    await request(app.getHttpServer())
      .post('/api/auth/verify')
      .send({ token })
      .expect(401);
  });

  it('silently rate-limits duplicate magic-link within cooldown', async () => {
    sent.length = 0;
    await request(app.getHttpServer())
      .post('/api/auth/magic-link')
      .send({ email: 'auth-cooldown@example.com' })
      .expect(200);
    expect(sent).toHaveLength(1);

    await request(app.getHttpServer())
      .post('/api/auth/magic-link')
      .send({ email: 'auth-cooldown@example.com' })
      .expect(200)
      .expect({ ok: true });

    expect(sent).toHaveLength(1);
  });

  it('rejects invalid email payload', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/magic-link')
      .send({ email: 'not-an-email' })
      .expect(400);
  });

  it('rejects forbidden origin on mutating auth', async () => {
    await request(app.getHttpServer())
      .post('/api/auth/magic-link')
      .set('Origin', 'https://evil.example')
      .send({ email: 'origin-block@example.com' })
      .expect(403);
  });

  it('returns 401 for admin routes without session', async () => {
    await request(app.getHttpServer()).get('/api/admin/products').expect(401);
  });

  it('updates profile for authenticated user', async () => {
    sent.length = 0;
    const email = 'profile-update@example.com';
    const prisma = app.get(PrismaService);
    await prisma.session.deleteMany({ where: { user: { email } } });
    await prisma.magicLink.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });

    await request(app.getHttpServer())
      .post('/api/auth/magic-link')
      .send({ email })
      .expect(200);
    const token = extractToken(sent[0].text);
    const verify = await request(app.getHttpServer())
      .post('/api/auth/verify')
      .send({ token })
      .expect(200);
    const cookie = cookieHeader(verify.headers['set-cookie']);

    const res = await request(app.getHttpServer())
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        phone: '+7 (999) 123-45-67',
        lastName: 'Иванов',
        firstName: 'Иван',
      })
      .expect(200);

    expect(res.body.user.email).toBe(email);
    expect(res.body.user.lastName).toBe('Иванов');
    expect(res.body.user.firstName).toBe('Иван');
    expect(res.body.user.middleName).toBeUndefined();
    expect(res.body.user.phone).toContain('999');
  });

  it('rejects incomplete profile update', async () => {
    sent.length = 0;
    const email = 'profile-bad@example.com';
    const prisma = app.get(PrismaService);
    await prisma.session.deleteMany({ where: { user: { email } } });
    await prisma.magicLink.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });

    await request(app.getHttpServer())
      .post('/api/auth/magic-link')
      .send({ email })
      .expect(200);
    const token = extractToken(sent[0].text);
    const verify = await request(app.getHttpServer())
      .post('/api/auth/verify')
      .send({ token })
      .expect(200);
    const cookie = cookieHeader(verify.headers['set-cookie']);

    await request(app.getHttpServer())
      .patch('/api/auth/profile')
      .set('Cookie', cookie)
      .set('Origin', 'http://localhost:3000')
      .send({
        phone: '123',
        lastName: 'Иванов',
        firstName: 'Иван',
      })
      .expect(400);
  });

  it('returns 403 for non-admin on admin routes', async () => {
    sent.length = 0;
    const email = 'auth-user-role@example.com';
    const prisma = app.get(PrismaService);
    await prisma.session.deleteMany({ where: { user: { email } } });
    await prisma.magicLink.deleteMany({ where: { user: { email } } });
    await prisma.user.deleteMany({ where: { email } });

    await request(app.getHttpServer())
      .post('/api/auth/magic-link')
      .send({ email })
      .expect(200);
    const token = extractToken(sent[0].text);
    const verify = await request(app.getHttpServer())
      .post('/api/auth/verify')
      .send({ token })
      .expect(200);
    const cookie = cookieHeader(verify.headers['set-cookie']);

    await prisma.user.update({
      where: { email },
      data: { role: UserRole.USER },
    });

    await request(app.getHttpServer())
      .get('/api/admin/products')
      .set('Cookie', cookie)
      .expect(403);
  });
});

describe('Auth Google OAuth (e2e)', () => {
  let app: INestApplication;

  afterEach(async () => {
    if (app) await app.close();
  });

  it('redirects to Google with state cookie', async () => {
    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      google: 'present',
      googleFetch: async () => {
        throw new Error('Google fetch should not be called on start');
      },
    });
    app = created.app;

    const res = await request(app.getHttpServer())
      .get('/api/auth/google')
      .expect(302);

    const location = String(res.headers.location);
    expect(location).toContain('accounts.google.com');
    expect(location).toContain('client_id=test-google-client-id');
    expect(location).toContain('state=');
    expect(res.headers['set-cookie']).toBeDefined();
    expect(String(res.headers['set-cookie'])).toContain(
      'agnyusha_oauth_state=',
    );
  });

  it('returns 503 when Google is not configured', async () => {
    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      google: 'missing',
    });
    app = created.app;

    await request(app.getHttpServer()).get('/api/auth/google').expect(503);
  });

  it('completes Google callback and sets session cookie', async () => {
    const googleFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (
        url.includes('openidconnect.googleapis.com/userinfo') ||
        url.includes('googleapis.com/oauth2/v3/userinfo') ||
        url.includes('googleapis.com/oauth2/v2/userinfo')
      ) {
        expect(init?.headers).toMatchObject({
          Authorization: 'Bearer access-token',
        });
        return new Response(
          JSON.stringify({
            sub: 'google-sub-1',
            email: 'google-user@example.com',
            email_verified: true,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      throw new Error(`Unexpected Google URL: ${url}`);
    };

    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      google: 'present',
      googleFetch,
    });
    app = created.app;

    const prisma = app.get(PrismaService);
    await prisma.session.deleteMany({
      where: { user: { email: 'google-user@example.com' } },
    });
    await prisma.user.deleteMany({
      where: { email: 'google-user@example.com' },
    });

    const start = await request(app.getHttpServer())
      .get('/api/auth/google')
      .expect(302);

    const startCookie = start.headers['set-cookie'];
    const location = new URL(String(start.headers.location));
    const state = location.searchParams.get('state');
    expect(state).toBeTruthy();

    const callback = await request(app.getHttpServer())
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state })
      .set('Cookie', startCookie)
      .expect(302);

    expect(callback.headers.location).toBe('http://localhost:3000/');
    const sessionCookie = String(callback.headers['set-cookie'] ?? '');
    expect(sessionCookie).toContain('agnyusha_session=');
    expect(sessionCookie).toMatch(
      /agnyusha_oauth_state=;.*Expires=Thu, 01 Jan 1970/,
    );

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', callback.headers['set-cookie'])
      .expect(200);

    expect(me.body.user.email).toBe('google-user@example.com');
  });

  it('completes Google callback with plus-containing auth code', async () => {
    let receivedCode = '';
    const googleFetch = async (
      input: RequestInfo | URL,
      init?: RequestInit,
    ) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        const body = String(init?.body ?? '');
        receivedCode = new URLSearchParams(body).get('code') ?? '';
        return new Response(JSON.stringify({ access_token: 'access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (
        url.includes('openidconnect.googleapis.com/userinfo') ||
        url.includes('googleapis.com/oauth2/v3/userinfo') ||
        url.includes('googleapis.com/oauth2/v2/userinfo')
      ) {
        return new Response(
          JSON.stringify({
            sub: 'google-sub-plus',
            email: 'google-plus@example.com',
            email_verified: true,
          }),
          {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          },
        );
      }
      throw new Error(`Unexpected Google URL: ${url}`);
    };

    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      google: 'present',
      googleFetch,
    });
    app = created.app;

    const start = await request(app.getHttpServer())
      .get('/api/auth/google')
      .expect(302);
    const startCookie = start.headers['set-cookie'];
    const location = new URL(String(start.headers.location));
    const state = location.searchParams.get('state');

    const callback = await request(app.getHttpServer())
      .get(
        `/api/auth/google/callback?code=${encodeURIComponent('4/0A+abc_def')}&state=${encodeURIComponent(state!)}`,
      )
      .set('Cookie', startCookie)
      .expect(302);

    expect(callback.headers.location).toBe('http://localhost:3000/');
    expect(receivedCode).toBe('4/0A+abc_def');
  });

  it('rejects Google callback with invalid state', async () => {
    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      google: 'present',
      googleFetch: async () => {
        throw new Error('should not call google');
      },
    });
    app = created.app;

    const res = await request(app.getHttpServer())
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state: 'wrong' })
      .expect(302);

    expect(res.headers.location).toContain(
      '/auth/callback?error=invalid_state',
    );
  });

  it('rejects unverified Google email', async () => {
    const googleFetch = async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return new Response(
        JSON.stringify({
          sub: 'google-unverified',
          email: 'unverified@example.com',
          email_verified: false,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    };

    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      google: 'present',
      googleFetch,
    });
    app = created.app;

    const start = await request(app.getHttpServer())
      .get('/api/auth/google')
      .expect(302);
    const startCookie = start.headers['set-cookie'];
    const state = new URL(String(start.headers.location)).searchParams.get(
      'state',
    );

    const callback = await request(app.getHttpServer())
      .get('/api/auth/google/callback')
      .query({ code: 'auth-code', state })
      .set('Cookie', startCookie)
      .expect(302);

    expect(callback.headers.location).toContain(
      '/auth/callback?error=google_email',
    );
  });

  it('maps Google access_denied to google_denied', async () => {
    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
      google: 'present',
      googleFetch: async () => {
        throw new Error('should not call google');
      },
    });
    app = created.app;

    const res = await request(app.getHttpServer())
      .get('/api/auth/google/callback')
      .query({ error: 'access_denied', state: 'x' })
      .expect(302);

    expect(res.headers.location).toContain(
      '/auth/callback?error=google_denied',
    );
  });
});
