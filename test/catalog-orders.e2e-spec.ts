import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { createTestApp } from './helpers/cdek-test.helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { hashToken, createRawToken } from '../src/auth/auth.crypto';
import { SESSION_COOKIE } from '../src/auth/auth.crypto';

async function loginAs(
  app: INestApplication,
  email: string,
  role: UserRole = UserRole.USER,
) {
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

describe('Catalog admin & orders (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const created = await createTestApp({ cdek: 'missing', yandex: 'missing' });
    app = created.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('lists public products', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/products')
      .expect(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
  });

  it('returns product by slug', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/products')
      .expect(200);
    const slug = list.body[0].slug as string;
    const res = await request(app.getHttpServer())
      .get(`/api/products/${slug}`)
      .expect(200);
    expect(res.body.slug).toBe(slug);
    expect(res.body.ingredients).toBeTruthy();
  });

  it('returns product by double-encoded slug', async () => {
    const list = await request(app.getHttpServer())
      .get('/api/products')
      .expect(200);
    const cyrillic = list.body.find((p: { slug: string }) =>
      /[а-яё]/i.test(p.slug),
    ) as { slug: string } | undefined;
    const target =
      cyrillic ??
      (list.body.find((p: { slug: string }) => p.slug === 'turkey') as {
        slug: string;
      });
    expect(target).toBeTruthy();

    const doubleEncoded = encodeURIComponent(encodeURIComponent(target.slug));
    const res = await request(app.getHttpServer())
      .get(`/api/products/${doubleEncoded}`)
      .expect(200);
    expect(res.body.slug).toBe(target.slug);
  });

  it('admin can create product and user can place order', async () => {
    const admin = await loginAs(app, 'admin-e2e@example.com', UserRole.ADMIN);
    const create = await request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Cookie', admin.cookie)
      .send({
        name: 'Тестовый корм',
        subtitle: 'E2E',
        category: 'DOGS',
        badge: 'HIT',
        variants: [{ sku: 'E2E-TEST-01', weight: '1 кг.', price: 1000, stock: 10 }],
        ingredients: 'test',
        description: 'test',
      })
      .expect(201);

    expect(create.body.name).toBe('Тестовый корм');
    expect(create.body.badge).toBe('HIT');
    expect(create.body.badgeLabel).toBe('Хит');
    expect(create.body.badgeColor).toBe('#5fa88a');
    expect(create.body.variants[0].sku).toBe('E2E-TEST-01');
    expect(create.body.variants[0].stock).toBe(10);

    const xss = await request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Cookie', admin.cookie)
      .send({
        name: 'HTML описание',
        category: 'DOGS',
        variants: [{ sku: 'E2E-XSS-01', weight: '1 кг.', price: 500, stock: 5 }],
        description:
          '<p>Безопасный <strong>текст</strong></p><script>alert(1)</script><img src=x onerror=alert(1)>',
      })
      .expect(201);

    expect(create.body.description).toBe('<p>test</p>');
    expect(xss.body.description).toContain('<strong>текст</strong>');
    expect(xss.body.description).not.toMatch(/script|onerror|img/i);

    const customBadge = await request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Cookie', admin.cookie)
      .send({
        name: 'Кастомный бейдж',
        category: 'CATS',
        variants: [{ sku: 'E2E-BADGE-01', weight: '1 кг.', price: 700, stock: 5 }],
        badgeLabel: 'Акция',
        badgeColor: '#c45c26',
        ingredients:
          '<p>Рис</p><script>alert(1)</script>',
        description: '<p>Ок</p>',
      })
      .expect(201);

    expect(customBadge.body.badgeLabel).toBe('Акция');
    expect(customBadge.body.badgeColor).toBe('#c45c26');
    expect(customBadge.body.ingredients).toContain('<p>Рис</p>');
    expect(customBadge.body.ingredients).not.toMatch(/script/i);

    await request(app.getHttpServer())
      .delete(`/api/admin/products/${customBadge.body.id}`)
      .set('Cookie', admin.cookie)
      .expect(200);

    await request(app.getHttpServer())
      .delete(`/api/admin/products/${xss.body.id}`)
      .set('Cookie', admin.cookie)
      .expect(200);

    const buyer = await loginAs(app, 'buyer-e2e@example.com', UserRole.USER);
    const order = await request(app.getHttpServer())
      .post('/api/orders')
      .set('Cookie', buyer.cookie)
      .send({
        phone: '+7 (999) 111-22-33',
        contactChannel: 'Telegram',
        cityLabel: 'Санкт-Петербург',
        deliveryCode: 'PICKUP',
        deliveryTitle: 'Самовывоз',
        items: [
          {
            productId: create.body.id,
            variantId: create.body.variants[0].id,
            name: create.body.name,
            image: create.body.image,
            weight: '1 кг.',
            price: 1000,
            qty: 2,
          },
        ],
      })
      .expect(201);

    expect(order.body.total).toBe(2000);

    const afterOrder = await request(app.getHttpServer())
      .get(`/api/admin/products/${create.body.id}`)
      .set('Cookie', admin.cookie)
      .expect(200);
    expect(afterOrder.body.variants[0].stock).toBe(8);

    const list = await request(app.getHttpServer())
      .get('/api/orders')
      .set('Cookie', buyer.cookie)
      .expect(200);
    expect(list.body.some((o: { id: string }) => o.id === order.body.id)).toBe(
      true,
    );

    await request(app.getHttpServer())
      .delete(`/api/admin/products/${create.body.id}`)
      .set('Cookie', admin.cookie)
      .expect(200);
  });

  it('admin can upload multiple product images', async () => {
    const admin = await loginAs(app, 'admin-images@example.com', UserRole.ADMIN);
    const create = await request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Cookie', admin.cookie)
      .send({
        name: 'Товар с галереей',
        category: 'DOGS',
        variants: [{ sku: 'E2E-IMG-01', weight: '1 кг.', price: 500, stock: 3 }],
        images: ['/assets/product-turkey.png'],
      })
      .expect(201);

    expect(create.body.images).toEqual(['/assets/product-turkey.png']);
    expect(create.body.image).toBe('/assets/product-turkey.png');

    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );

    const uploaded = await request(app.getHttpServer())
      .post(`/api/admin/products/${create.body.id}/images`)
      .set('Cookie', admin.cookie)
      .attach('files', png, { filename: 'a.png', contentType: 'image/png' })
      .attach('files', png, { filename: 'b.png', contentType: 'image/png' })
      .expect(201);

    expect(uploaded.body.images).toHaveLength(3);
    expect(uploaded.body.images[0]).toBe('/assets/product-turkey.png');
    expect(uploaded.body.images[1]).toMatch(/^\/uploads\//);
    expect(uploaded.body.image).toBe(uploaded.body.images[0]);

    const reordered = await request(app.getHttpServer())
      .patch(`/api/admin/products/${create.body.id}`)
      .set('Cookie', admin.cookie)
      .send({
        name: 'Товар с галереей',
        category: 'DOGS',
        variants: [
          {
            id: create.body.variants[0].id,
            sku: 'E2E-IMG-01',
            weight: '1 кг.',
            price: 500,
            stock: 3,
          },
        ],
        images: [uploaded.body.images[1], uploaded.body.images[0]],
      })
      .expect(200);

    expect(reordered.body.images).toHaveLength(2);
    expect(reordered.body.image).toBe(uploaded.body.images[1]);

    await request(app.getHttpServer())
      .delete(`/api/admin/products/${create.body.id}`)
      .set('Cookie', admin.cookie)
      .expect(200);
  });

  it('admin can promote user', async () => {
    const admin = await loginAs(
      app,
      'agnostex@gmail.com',
      UserRole.ADMIN,
    );
    const target = await loginAs(app, 'promote-me@example.com', UserRole.USER);

    const updated = await request(app.getHttpServer())
      .patch(`/api/admin/users/${target.user.id}/role`)
      .set('Cookie', admin.cookie)
      .send({ role: 'ADMIN' })
      .expect(200);

    expect(updated.body.role).toBe('ADMIN');
  });

  it('admin can search and paginate users', async () => {
    const admin = await loginAs(
      app,
      'agnostex@gmail.com',
      UserRole.ADMIN,
    );
    const prisma = app.get(PrismaService);

    for (let i = 0; i < 5; i++) {
      await prisma.user.upsert({
        where: { email: `page-user-${i}@example.com` },
        create: { email: `page-user-${i}@example.com`, role: UserRole.USER },
        update: {},
      });
    }
    await prisma.user.upsert({
      where: { email: 'unique-search-target@example.com' },
      create: {
        email: 'unique-search-target@example.com',
        role: UserRole.USER,
      },
      update: {},
    });

    const listed = await request(app.getHttpServer())
      .get('/api/admin/users')
      .query({ page: 1, limit: 2 })
      .set('Cookie', admin.cookie)
      .expect(200);

    expect(listed.body.items).toHaveLength(2);
    expect(listed.body.page).toBe(1);
    expect(listed.body.limit).toBe(2);
    expect(listed.body.total).toBeGreaterThanOrEqual(6);

    const page2 = await request(app.getHttpServer())
      .get('/api/admin/users')
      .query({ page: 2, limit: 2 })
      .set('Cookie', admin.cookie)
      .expect(200);

    expect(page2.body.items).toHaveLength(2);
    expect(page2.body.page).toBe(2);
    expect(page2.body.items[0].id).not.toBe(listed.body.items[0].id);

    const found = await request(app.getHttpServer())
      .get('/api/admin/users')
      .query({ q: 'unique-search-target', page: 1, limit: 20 })
      .set('Cookie', admin.cookie)
      .expect(200);

    expect(found.body.total).toBe(1);
    expect(found.body.items).toHaveLength(1);
    expect(found.body.items[0].email).toBe('unique-search-target@example.com');

    const empty = await request(app.getHttpServer())
      .get('/api/admin/users')
      .query({ q: 'no-such-user-zzz', page: 1, limit: 20 })
      .set('Cookie', admin.cookie)
      .expect(200);

    expect(empty.body.total).toBe(0);
    expect(empty.body.items).toEqual([]);
  });

  it('admin can ban and delete user', async () => {
    const admin = await loginAs(
      app,
      'agnostex@gmail.com',
      UserRole.ADMIN,
    );
    const target = await loginAs(app, 'ban-me@example.com', UserRole.USER);
    const prisma = app.get(PrismaService);

    const banned = await request(app.getHttpServer())
      .patch(`/api/admin/users/${target.user.id}/ban`)
      .set('Cookie', admin.cookie)
      .send({ banned: true })
      .expect(200);

    expect(banned.body.bannedAt).toBeTruthy();

    const meWhileBanned = await request(app.getHttpServer())
      .get('/api/auth/me')
      .set('Cookie', target.cookie)
      .expect(200);
    expect(meWhileBanned.body.user).toBeNull();

    const unbanned = await request(app.getHttpServer())
      .patch(`/api/admin/users/${target.user.id}/ban`)
      .set('Cookie', admin.cookie)
      .send({ banned: false })
      .expect(200);
    expect(unbanned.body.bannedAt).toBeNull();

    await request(app.getHttpServer())
      .delete(`/api/admin/users/${target.user.id}`)
      .set('Cookie', admin.cookie)
      .expect(200);

    const gone = await prisma.user.findUnique({
      where: { id: target.user.id },
    });
    expect(gone).toBeNull();

    await request(app.getHttpServer())
      .patch(`/api/admin/users/${admin.user.id}/ban`)
      .set('Cookie', admin.cookie)
      .send({ banned: true })
      .expect(403);

    await request(app.getHttpServer())
      .delete(`/api/admin/users/${admin.user.id}`)
      .set('Cookie', admin.cookie)
      .expect(403);
  });

  it('rejects product create without sku on variants', async () => {
    const admin = await loginAs(app, 'admin-sku@example.com', UserRole.ADMIN);
    await request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Cookie', admin.cookie)
      .send({
        name: 'Без артикула',
        category: 'DOGS',
        variants: [{ weight: '1 кг.', price: 100, stock: 1 }],
      })
      .expect(400);
  });

  it('staff permissions gate product and inventory APIs', async () => {
    const manager = await loginAs(app, 'manager-e2e@example.com', UserRole.MANAGER);
    const prisma = app.get(PrismaService);
    const staffUser = await prisma.user.upsert({
      where: { email: 'staff-stock@example.com' },
      create: { email: 'staff-stock@example.com', role: UserRole.STAFF },
      update: { role: UserRole.STAFF },
    });
    await prisma.userPermission.deleteMany({ where: { userId: staffUser.id } });
    await prisma.userPermission.create({
      data: {
        userId: staffUser.id,
        permission: 'PRODUCT_STOCK',
      },
    });
    const raw = createRawToken();
    await prisma.session.create({
      data: {
        userId: staffUser.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const staffCookie = `${SESSION_COOKIE}=${raw}`;

    await request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Cookie', staffCookie)
      .send({
        name: 'No create',
        category: 'DOGS',
        variants: [{ sku: 'NOPE-01', weight: '1 кг.', price: 100, stock: 1 }],
      })
      .expect(403);

    const admin = await loginAs(app, 'admin-stock@example.com', UserRole.ADMIN);
    const created = await request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Cookie', admin.cookie)
      .send({
        name: 'Stock gate',
        category: 'DOGS',
        variants: [{ sku: 'STOCK-GATE-01', weight: '1 кг.', price: 100, stock: 2 }],
      })
      .expect(201);

    const inv = await request(app.getHttpServer())
      .get('/api/admin/inventory')
      .query({ page: 1, limit: 10 })
      .set('Cookie', staffCookie)
      .expect(200);
    expect(Array.isArray(inv.body.items)).toBe(true);
    expect(inv.body.page).toBe(1);
    expect(inv.body.limit).toBe(10);
    expect(typeof inv.body.total).toBe('number');
    expect(inv.body.items[0]?.product?.image).toBeTruthy();

    const page2 = await request(app.getHttpServer())
      .get('/api/admin/inventory')
      .query({ page: 1, limit: 1 })
      .set('Cookie', staffCookie)
      .expect(200);
    expect(page2.body.items).toHaveLength(1);
    expect(page2.body.total).toBeGreaterThanOrEqual(1);

    await request(app.getHttpServer())
      .patch(`/api/admin/inventory/${created.body.variants[0].id}`)
      .set('Cookie', staffCookie)
      .send({ stock: 7 })
      .expect(200);

    const buyer = await loginAs(app, 'stock-buyer@example.com', UserRole.USER);
    await request(app.getHttpServer())
      .post('/api/orders')
      .set('Cookie', buyer.cookie)
      .send({
        phone: '+7 (999) 111-22-33',
        contactChannel: 'Telegram',
        cityLabel: 'Москва',
        deliveryCode: 'PICKUP',
        deliveryTitle: 'Самовывоз',
        items: [
          {
            productId: created.body.id,
            variantId: created.body.variants[0].id,
            name: created.body.name,
            image: created.body.image,
            weight: '1 кг.',
            price: 100,
            qty: 99,
          },
        ],
      })
      .expect(400);

    const analytics = await request(app.getHttpServer())
      .get('/api/admin/analytics/overview')
      .set('Cookie', manager.cookie)
      .expect(200);
    expect(analytics.body.totals).toBeDefined();
    expect(Array.isArray(analytics.body.revenueByDay)).toBe(true);

    const ranged = await request(app.getHttpServer())
      .get('/api/admin/analytics/overview')
      .query({ from: '2020-01-01', to: '2020-01-07' })
      .set('Cookie', manager.cookie)
      .expect(200);
    expect(ranged.body.revenueByDay).toHaveLength(7);
    expect(ranged.body.totals.orders).toBe(0);

    const promoted = await request(app.getHttpServer())
      .patch(`/api/admin/users/${staffUser.id}/role`)
      .set('Cookie', manager.cookie)
      .send({
        role: 'STAFF',
        permissions: ['PRODUCT_CREATE', 'PRODUCT_STOCK'],
      })
      .expect(200);
    expect(promoted.body.permissions).toEqual(
      expect.arrayContaining(['PRODUCT_CREATE', 'PRODUCT_STOCK']),
    );

    await request(app.getHttpServer())
      .delete(`/api/admin/products/${created.body.id}`)
      .set('Cookie', admin.cookie)
      .expect(200);
  });
});
