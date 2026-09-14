import type { INestApplication } from '@nestjs/common';
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
});
