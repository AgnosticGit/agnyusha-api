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
        variants: [{ weight: '1 кг.', price: 1000 }],
        ingredients: 'test',
        description: 'test',
      })
      .expect(201);

    expect(create.body.name).toBe('Тестовый корм');
    expect(create.body.badge).toBe('HIT');
    expect(create.body.badgeLabel).toBe('Хит');
    expect(create.body.badgeColor).toBe('#5fa88a');

    const xss = await request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Cookie', admin.cookie)
      .send({
        name: 'HTML описание',
        category: 'DOGS',
        variants: [{ weight: '1 кг.', price: 500 }],
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
        variants: [{ weight: '1 кг.', price: 700 }],
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
        variants: [{ weight: '1 кг.', price: 500 }],
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
        variants: [{ weight: '1 кг.', price: 500 }],
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
});
