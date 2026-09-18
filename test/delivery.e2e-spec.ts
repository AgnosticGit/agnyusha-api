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

  it('marks store pickup available with address note; OZON stays blocked last', async () => {
    const local = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .query({
        region: 'Санкт-Петербург',
        label: 'Санкт-Петербург, Санкт-Петербург, Россия',
      })
      .expect(200);

    const pickup = local.body.find((m: { code: string }) => m.code === 'PICKUP');
    expect(pickup?.available).toBe(true);
    expect(String(pickup?.note ?? '').length).toBeGreaterThan(5);
    expect(local.body.find((m: { code: string }) => m.code === 'OZON')?.available).toBe(
      false,
    );
    expect(local.body.map((m: { code: string }) => m.code).at(-1)).toBe('OZON');

    const remote = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .query({
        region: 'Москва',
        label: 'Москва, Москва, Россия',
      })
      .expect(200);

    expect(
      remote.body.find((m: { code: string }) => m.code === 'PICKUP')?.available,
    ).toBe(true);
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
