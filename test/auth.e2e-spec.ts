import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { createTestApp } from './helpers/cdek-test.helpers';
import type { SendMailInput } from '../src/mail/mail.tokens';
import { PrismaService } from '../src/prisma/prisma.service';

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
    await prisma.session.deleteMany();
    await prisma.magicLink.deleteMany();
    await prisma.user.deleteMany({ where: { email: 'auth-test@example.com' } });
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
    const cookie = verify.headers['set-cookie'];
    expect(cookie).toBeDefined();

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
    expect(String(res.headers['set-cookie'])).toContain('agnyusha_oauth_state=');
  });

  it('completes Google callback and sets session cookie', async () => {
    const googleFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.includes('oauth2.googleapis.com/token')) {
        return new Response(JSON.stringify({ access_token: 'access-token' }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      if (url.includes('openidconnect.googleapis.com/userinfo') ||
          url.includes('googleapis.com/oauth2/v3/userinfo') ||
          url.includes('googleapis.com/oauth2/v2/userinfo')) {
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
    const sessionCookie = callback.headers['set-cookie'];
    expect(String(sessionCookie)).toContain('agnyusha_session=');

    const me = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', sessionCookie)
      .expect(200);

    expect(me.body.user.email).toBe('google-user@example.com');
  });

  it('completes Google callback with plus-containing auth code', async () => {
    let receivedCode = '';
    const googleFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
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

    // Simulate Google redirect: `+` must stay `+`, not become a space.
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
});
