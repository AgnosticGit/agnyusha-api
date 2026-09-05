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
