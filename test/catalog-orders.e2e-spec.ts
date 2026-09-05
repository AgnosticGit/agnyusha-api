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
        additives: 'test',
      })
      .expect(201);

    expect(create.body.name).toBe('Тестовый корм');
    expect(create.body.badge).toBe('HIT');

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
});
