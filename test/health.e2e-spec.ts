import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import {
  createMockCdekFetch,
  createTestApp,
  jsonResponse,
} from './helpers/cdek-test.helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  hashToken,
  createRawToken,
  SESSION_COOKIE,
} from '../src/auth/auth.crypto';

async function loginAs(app: INestApplication, email: string, role: UserRole) {
  const prisma = app.get(PrismaService);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, role },
    update: { role },
  });
  const raw = createRawToken();
  await prisma.session.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 86400000),
    },
  });
  return { user, cookie: `${SESSION_COOKIE}=${raw}` };
}

describe('Health (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const { fetchMock } = createMockCdekFetch(async (input) => {
      const url = String(input);
      if (url.includes('/oauth/token')) {
        return jsonResponse({
          access_token: 'health-token',
          expires_in: 3600,
          token_type: 'bearer',
        });
      }
      return jsonResponse([]);
    });

    const created = await createTestApp({
      cdekFetch: fetchMock,
      cdek: 'present',
      yandex: 'missing',
      google: 'present',
      ozon: 'missing',
    });
    app = created.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/health/live is public', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health/live')
      .expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.service).toBe('agnyusha-api');
  });

  it('GET /api/health/ready checks database', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/health/ready')
      .expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.checks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: 'database', status: 'ok' }),
      ]),
    );
  });

  it('GET /api/admin/health requires auth', async () => {
    await request(app.getHttpServer()).get('/api/admin/health').expect(401);
  });

  it('GET /api/admin/health forbids non-admin staff', async () => {
    const { cookie } = await loginAs(
      app,
      'health-manager@example.com',
      UserRole.MANAGER,
    );
    await request(app.getHttpServer())
      .get('/api/admin/health')
      .set('Cookie', cookie)
      .expect(403);
  });

  it('GET /api/admin/health returns full report for ADMIN', async () => {
    const { cookie } = await loginAs(
      app,
      'health-admin@example.com',
      UserRole.ADMIN,
    );
    const res = await request(app.getHttpServer())
      .get('/api/admin/health')
      .set('Cookie', cookie)
      .expect(200);

    expect(['ok', 'degraded', 'down']).toContain(res.body.status);
    expect(res.body.checkedAt).toBeTruthy();
    const ids = (res.body.checks as Array<{ id: string }>).map((c) => c.id);
    expect(ids).toEqual(
      expect.arrayContaining([
        'database',
        'uploads',
        'cdek',
        'yandex',
        'pochta',
        'ozon_delivery',
        'ozon_pay',
        'mail',
        'google_oauth',
      ]),
    );

    const byId = Object.fromEntries(
      (res.body.checks as Array<{ id: string; status: string }>).map((c) => [
        c.id,
        c.status,
      ]),
    );
    expect(byId.database).toBe('ok');
    expect(byId.uploads).toBe('ok');
    expect(byId.cdek).toBe('ok');
    const cdek = (
      res.body.checks as Array<{ id: string; message: string | null }>
    ).find((c) => c.id === 'cdek');
    expect(cdek?.message).toContain('опрос');
    expect(byId.yandex).toBe('skipped');
    expect(byId.pochta).toBe('skipped');
    expect(byId.ozon_delivery).toBe('skipped');
    expect(byId.ozon_pay).toBe('skipped');
    expect(byId.mail).toBe('skipped');
    expect(byId.google_oauth).toBe('ok');
  });
});
