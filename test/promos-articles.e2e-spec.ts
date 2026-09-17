import type { INestApplication } from '@nestjs/common';
import { testStorePickupAt } from './helpers/pickup-slot';
import request from 'supertest';
import { PromoType, UserRole } from '@prisma/client';
import { createTestApp } from './helpers/cdek-test.helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  SESSION_COOKIE,
  createRawToken,
  hashToken,
} from '../src/auth/auth.crypto';

describe('Promos + Articles (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let adminCookie = '';

  beforeAll(async () => {
    const created = await createTestApp({});
    app = created.app;
    prisma = app.get(PrismaService);

    const email = `promo-admin-${Date.now()}@example.com`;
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

  it('admin CRUD promo and validate', async () => {
    const product = await prisma.product.findFirst({
      where: { isActive: true },
      include: { variants: true },
    });
    if (!product?.variants[0]) return;

    const code = `SAVE${Date.now().toString().slice(-6)}`;
    const created = await request(app.getHttpServer())
      .post('/api/admin/promos')
      .set('Cookie', adminCookie)
      .send({
        code,
        type: PromoType.PERCENT,
        value: 10,
        isActive: true,
        appliesToAllProducts: true,
      })
      .expect(201);

    expect(created.body.code).toBe(code);

    const preview = await request(app.getHttpServer())
      .post('/api/promos/validate')
      .send({
        code,
        items: [
          {
            productId: product.id,
            price: product.variants[0].price,
            qty: 1,
          },
        ],
      })
      .expect(201);

    expect(preview.body.discountAmount).toBeGreaterThan(0);
    expect(preview.body.total).toBe(
      preview.body.subtotal - preview.body.discountAmount,
    );

    await request(app.getHttpServer())
      .delete(`/api/admin/promos/${created.body.id}`)
      .set('Cookie', adminCookie)
      .expect(200);
  });

  it('admin publishes article; public list/detail', async () => {
    const slug = `e2e-article-${Date.now()}`;
    const created = await request(app.getHttpServer())
      .post('/api/admin/articles')
      .set('Cookie', adminCookie)
      .send({
        title: 'Тестовая статья',
        slug,
        excerpt: 'Кратко',
        contentHtml: '<h2>Раздел</h2><p>Текст</p>',
        status: 'PUBLISHED',
      })
      .expect(201);

    expect(created.body.slug).toContain('e2e-article');
    expect(created.body.toc?.[0]?.text).toBe('Раздел');

    const list = await request(app.getHttpServer())
      .get('/api/articles')
      .expect(200);
    expect(
      list.body.items.some(
        (a: { slug: string }) => a.slug === created.body.slug,
      ),
    ).toBe(true);

    const detail = await request(app.getHttpServer())
      .get(`/api/articles/${created.body.slug}`)
      .expect(200);
    expect(detail.body.contentHtml).toContain('Раздел');

    await request(app.getHttpServer())
      .delete(`/api/admin/articles/${created.body.id}`)
      .set('Cookie', adminCookie)
      .expect(200);
  });

  it('applies promo on order create and increments redemption', async () => {
    const product = await prisma.product.findFirst({
      where: { isActive: true },
      include: { variants: true },
    });
    if (!product?.variants[0]) return;

    const code = `ORD${Date.now().toString().slice(-6)}`;
    const promo = await request(app.getHttpServer())
      .post('/api/admin/promos')
      .set('Cookie', adminCookie)
      .send({
        code,
        type: PromoType.PERCENT,
        value: 10,
        isActive: true,
        appliesToAllProducts: true,
        maxRedemptions: 1,
      })
      .expect(201);

    const raw = createRawToken();
    const buyer = await prisma.user.create({
      data: {
        email: `promo-buyer-${Date.now()}@example.com`,
        role: UserRole.USER,
        emailVerifiedAt: new Date(),
      },
    });
    await prisma.session.create({
      data: {
        userId: buyer.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const cookie = `${SESSION_COOKIE}=${raw}`;
    const price = product.variants[0].price;
    const qty = 1;
    const expectedDiscount = Math.round(price * qty * 0.1 * 100) / 100;

    const order = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Cookie', cookie)
      .send({
        email: buyer.email,
        lastName: 'Иванов',
        firstName: 'Иван',
        phone: '+7 (999) 111-22-33',
        contactChannel: 'Telegram',
        cityLabel: 'Санкт-Петербург',
        deliveryCode: 'PICKUP',
        deliveryTitle: 'Самовывоз',
        storePickupAt: testStorePickupAt(),
        promoCode: code,
        items: [
          {
            productId: product.id,
            variantId: product.variants[0].id,
            name: product.name,
            image: product.image,
            weight: product.variants[0].weight,
            price,
            qty,
          },
        ],
        privacyConsent: true,
      })
      .expect(201);

    const expectedTotal =
      Math.round((price * qty - expectedDiscount) * 100) / 100;
    expect(order.body.total).toBe(expectedTotal);

    const dbOrder = await prisma.order.findUnique({
      where: { id: order.body.id },
    });
    expect(dbOrder?.discountAmount).toBe(expectedDiscount);
    expect(dbOrder?.promoCode).toBe(code);
    expect(dbOrder?.promoCodeId).toBe(promo.body.id);

    const updated = await prisma.promoCode.findUnique({
      where: { id: promo.body.id },
    });
    expect(updated?.redemptionCount).toBe(1);

    await request(app.getHttpServer())
      .post('/api/promos/validate')
      .send({
        code,
        items: [{ productId: product.id, price, qty: 1 }],
      })
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/api/admin/promos/${promo.body.id}`)
      .set('Cookie', adminCookie)
      .expect(200);
  });

  it('enforces maxRedemptions atomically across concurrent orders', async () => {
    const product = await prisma.product.findFirst({
      where: { isActive: true },
      include: { variants: true },
    });
    if (!product?.variants[0]) return;

    const code = `RACE${Date.now().toString().slice(-6)}`;
    const promo = await request(app.getHttpServer())
      .post('/api/admin/promos')
      .set('Cookie', adminCookie)
      .send({
        code,
        type: PromoType.FIXED,
        value: 10,
        isActive: true,
        appliesToAllProducts: true,
        maxRedemptions: 1,
      })
      .expect(201);

    async function placeOrder(email: string) {
      const raw = createRawToken();
      const buyer = await prisma.user.create({
        data: {
          email,
          role: UserRole.USER,
          emailVerifiedAt: new Date(),
        },
      });
      await prisma.session.create({
        data: {
          userId: buyer.id,
          tokenHash: hashToken(raw),
          expiresAt: new Date(Date.now() + 86400000),
        },
      });
      return request(app.getHttpServer())
        .post('/api/orders')
        .set('Cookie', `${SESSION_COOKIE}=${raw}`)
        .send({
          email,
          lastName: 'Иванов',
          firstName: 'Иван',
          phone: '+7 (999) 111-22-33',
          contactChannel: 'Telegram',
          cityLabel: 'Санкт-Петербург',
          deliveryCode: 'PICKUP',
          deliveryTitle: 'Самовывоз',
        storePickupAt: testStorePickupAt(),
          promoCode: code,
          items: [
            {
              productId: product.id,
              variantId: product.variants[0].id,
              name: product.name,
              image: product.image,
              weight: product.variants[0].weight,
              price: product.variants[0].price,
              qty: 1,
            },
          ],
        privacyConsent: true,
      });
    }

    const [a, b] = await Promise.all([
      placeOrder(`race-a-${Date.now()}@example.com`),
      placeOrder(`race-b-${Date.now()}@example.com`),
    ]);

    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([201, 400]);

    const updated = await prisma.promoCode.findUnique({
      where: { id: promo.body.id },
    });
    expect(updated?.redemptionCount).toBe(1);

    await request(app.getHttpServer())
      .delete(`/api/admin/promos/${promo.body.id}`)
      .set('Cookie', adminCookie)
      .expect(200);
  });

  it('rejects expired promo on validate', async () => {
    const product = await prisma.product.findFirst({
      where: { isActive: true },
      include: { variants: true },
    });
    if (!product?.variants[0]) return;

    const code = `OLD${Date.now().toString().slice(-6)}`;
    const promo = await request(app.getHttpServer())
      .post('/api/admin/promos')
      .set('Cookie', adminCookie)
      .send({
        code,
        type: PromoType.FIXED,
        value: 50,
        isActive: true,
        appliesToAllProducts: true,
        endsAt: new Date('2020-01-01T00:00:00.000Z').toISOString(),
      })
      .expect(201);

    await request(app.getHttpServer())
      .post('/api/promos/validate')
      .send({
        code,
        items: [
          {
            productId: product.id,
            price: product.variants[0].price,
            qty: 1,
          },
        ],
      })
      .expect(400);

    await request(app.getHttpServer())
      .delete(`/api/admin/promos/${promo.body.id}`)
      .set('Cookie', adminCookie)
      .expect(200);
  });
});
