import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import {
  createMockCdekFetch,
  createTestApp,
  ensureDeliveryMethods,
  jsonResponse,
} from './helpers/cdek-test.helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  SESSION_COOKIE,
  createRawToken,
  hashToken,
} from '../src/auth/auth.crypto';

describe('Delivery methods (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mock = createMockCdekFetch(async () =>
      jsonResponse({ message: 'CDEK should not be called' }, 500),
    );
    const created = await createTestApp({
      cdekFetch: mock.fetchMock,
      cdek: 'present',
      yandex: 'missing',
    });
    app = created.app;
    await ensureDeliveryMethods(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('marks pickup available only for SPb / LO labels', async () => {
    const local = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .query({
        region: 'Санкт-Петербург',
        label: 'Санкт-Петербург, Санкт-Петербург, Россия',
      })
      .expect(200);

    const byCode = Object.fromEntries(
      local.body.map((m: { code: string; available: boolean }) => [
        m.code,
        m.available,
      ]),
    );
    expect(byCode.PICKUP).toBe(false);
    expect(byCode.COURIER).toBeUndefined();
    expect(byCode.CDEK).toBe(true);
    expect(byCode.YANDEX).toBe(false);
    expect(byCode.POST).toBe(false);
    expect(byCode.OZON).toBe(false);
    expect(local.body.map((m: { code: string }) => m.code)).toEqual([
      'CDEK',
      'YANDEX',
      'POST',
      'OZON',
      'PICKUP',
    ]);

    const remote = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .query({
        region: 'Москва',
        label: 'Москва, Москва, Россия',
      })
      .expect(200);

    const remoteByCode = Object.fromEntries(
      remote.body.map((m: { code: string; available: boolean }) => [
        m.code,
        m.available,
      ]),
    );
    expect(remoteByCode.PICKUP).toBe(false);
    expect(remoteByCode.COURIER).toBeUndefined();
    expect(remoteByCode.CDEK).toBe(true);
    expect(remoteByCode.POST).toBe(false);
  });

  it('returns unavailable methods when location is missing', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .expect(200);

    expect(
      res.body.every((m: { available: boolean }) => m.available === false),
    ).toBe(true);
  });

  it('admin can deactivate a method so it disappears from public list', async () => {
    const prisma = app.get(PrismaService);

    const email = `delivery-admin-${Date.now()}@example.com`;
    const user = await prisma.user.create({
      data: { email, role: UserRole.ADMIN, emailVerifiedAt: new Date() },
    });
    const raw = createRawToken();
    await prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const cookie = `${SESSION_COOKIE}=${raw}`;

    const adminList = await request(app.getHttpServer())
      .get('/api/admin/delivery-methods')
      .set('Cookie', cookie)
      .expect(200);
    const post = adminList.body.find(
      (m: { code: string }) => m.code === 'POST',
    );
    expect(post).toBeTruthy();

    await request(app.getHttpServer())
      .patch('/api/admin/delivery-methods')
      .set('Cookie', cookie)
      .send({ methods: [{ id: post.id, isActive: false }] })
      .expect(200);

    const publicList = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .query({
        region: 'Санкт-Петербург',
        label: 'Санкт-Петербург, Санкт-Петербург, Россия',
      })
      .expect(200);
    expect(
      publicList.body.some((m: { code: string }) => m.code === 'POST'),
    ).toBe(false);

    await request(app.getHttpServer())
      .patch('/api/admin/delivery-methods')
      .set('Cookie', cookie)
      .send({ methods: [{ id: post.id, isActive: true }] })
      .expect(200);
  });
});
