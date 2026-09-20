import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import {
  createMockCdekFetch,
  createTestApp,
  jsonResponse,
} from './helpers/cdek-test.helpers';
import { loginAs } from './helpers/login-as';
import { PrismaService } from '../src/prisma/prisma.service';

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
      'health-staff@example.com',
      UserRole.STAFF,
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
        'host',
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
    expect(['ok', 'degraded', 'down']).toContain(byId.host);
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

  it('GET /api/admin/health/metrics returns series for ADMIN', async () => {
    const { cookie } = await loginAs(
      app,
      'health-metrics-admin@example.com',
      UserRole.ADMIN,
    );
    const prisma = app.get(PrismaService);
    await prisma.hostMetricHourly.deleteMany();
    await prisma.hostMetricHourly.create({
      data: {
        // Must stay inside HOURLY_RETENTION_MS (3 days) — fixed old dates fall out of the query.
        recordedAt: new Date(Date.now() - 60_000),
        memTotalMb: 956,
        memAvailableMb: 400,
        memUsedPct: 58,
        swapTotalMb: 2048,
        swapUsedMb: 100,
        load1: 0.2,
        diskTotalMb: 8000,
        diskUsedPct: 55,
        source: 'host',
      },
    });

    const res = await request(app.getHttpServer())
      .get('/api/admin/health/metrics')
      .set('Cookie', cookie)
      .expect(200);

    expect(res.body.current).toEqual(
      expect.objectContaining({
        memTotalMb: expect.any(Number),
        memAvailableMb: expect.any(Number),
        source: expect.stringMatching(/^(host|container)$/),
      }),
    );
    expect(Array.isArray(res.body.live)).toBe(true);
    expect(Array.isArray(res.body.hourly)).toBe(true);
    expect(res.body.hourly).toEqual([
      expect.objectContaining({
        memAvailableMb: 400,
        source: 'host',
      }),
    ]);
  });

  it('GET /api/admin/health/metrics requires auth', async () => {
    await request(app.getHttpServer())
      .get('/api/admin/health/metrics')
      .expect(401);
  });
});
