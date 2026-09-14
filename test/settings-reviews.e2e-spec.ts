import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { createTestApp } from './helpers/cdek-test.helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  SESSION_COOKIE,
  createRawToken,
  hashToken,
} from '../src/auth/auth.crypto';

describe('Settings + Reviews (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie = '';

  beforeAll(async () => {
    const created = await createTestApp({});
    app = created.app;
    prisma = app.get(PrismaService);

    const email = `settings-admin-${Date.now()}@example.com`;
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
    adminCookie = `${SESSION_COOKIE}=${raw}`;
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /api/settings returns defaults', async () => {
    const res = await request(app.getHttpServer()).get('/api/settings').expect(200);
    expect(res.body).toMatchObject({
      freeDeliveryDisplayEnabled: expect.any(Boolean),
      reviewsEnabled: expect.any(Boolean),
      inventoryEnabled: expect.any(Boolean),
    });
    expect(res.body.freeDeliveryDisplayAmount).toBeUndefined();
  });

  it('PATCH /api/admin/settings updates flags', async () => {
    const res = await request(app.getHttpServer())
      .patch('/api/admin/settings')
      .set('Cookie', adminCookie)
      .send({ freeDeliveryDisplayEnabled: true, inventoryEnabled: true })
      .expect(200);
    expect(res.body.freeDeliveryDisplayEnabled).toBe(true);
    expect(res.body.inventoryEnabled).toBe(true);
  });

  it('review flow: purchase required', async () => {
    const product = await prisma.product.findFirst({
      where: { isActive: true },
      include: { variants: true },
    });
    if (!product) return;

    const buyerEmail = `buyer-${Date.now()}@example.com`;
    const buyer = await prisma.user.create({
      data: {
        email: buyerEmail,
        role: UserRole.USER,
        emailVerifiedAt: new Date(),
      },
    });
    const raw = createRawToken();
    await prisma.session.create({
      data: {
        userId: buyer.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const cookie = `${SESSION_COOKIE}=${raw}`;

    await request(app.getHttpServer())
      .post(`/api/products/${product.slug}/reviews`)
      .set('Cookie', cookie)
      .send({ rating: 5, body: 'Отличный корм для теста' })
      .expect(403);

    await prisma.order.create({
      data: {
        userId: buyer.id,
        status: 'PAID',
        email: buyerEmail,
        phone: '+79991234567',
        lastName: 'Тест',
        firstName: 'Покупатель',
        contactChannel: 'phone',
        cityLabel: 'Москва',
        deliveryCode: 'CDEK',
        deliveryTitle: 'СДЭК',
        subtotal: 100,
        total: 100,
        paidAt: new Date(),
        items: {
          create: {
            productId: product.id,
            variantId: product.variants[0]?.id,
            productName: product.name,
            image: product.image,
            weight: product.variants[0]?.weight ?? '1 кг',
            weightGrams: product.variants[0]?.weightGrams ?? 1000,
            lengthCm: product.variants[0]?.lengthCm ?? 20,
            widthCm: product.variants[0]?.widthCm ?? 15,
            heightCm: product.variants[0]?.heightCm ?? 10,
            price: product.variants[0]?.price ?? 100,
            qty: 1,
          },
        },
      },
    });

    const created = await request(app.getHttpServer())
      .post(`/api/products/${product.slug}/reviews`)
      .set('Cookie', cookie)
      .send({ rating: 5, body: 'Отличный корм для теста' })
      .expect(201);

    expect(created.body.rating).toBe(5);

    const list = await request(app.getHttpServer())
      .get(`/api/products/${product.slug}/reviews`)
      .expect(200);
    expect(list.body.count).toBeGreaterThanOrEqual(1);
  });
});
