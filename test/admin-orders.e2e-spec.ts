import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OrderStatus, StaffPermission, UserRole } from '@prisma/client';
import {
  createRawToken,
  hashToken,
  SESSION_COOKIE,
} from '../src/auth/auth.crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/cdek-test.helpers';

async function loginAs(
  app: INestApplication,
  email: string,
  role: UserRole,
  permissions: StaffPermission[] = [],
) {
  const prisma = app.get(PrismaService);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, role },
    update: { role },
  });
  await prisma.userPermission.deleteMany({ where: { userId: user.id } });
  if (permissions.length) {
    await prisma.userPermission.createMany({
      data: permissions.map((permission) => ({
        userId: user.id,
        permission,
      })),
    });
  }
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

describe('Admin orders CRM (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const created = await createTestApp({ cdek: 'missing', yandex: 'missing' });
    app = created.app;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function seedOrder(
    email: string,
    status: OrderStatus = OrderStatus.NEW,
  ) {
    const buyer = await prisma.user.upsert({
      where: { email },
      create: { email, role: UserRole.USER },
      update: {},
    });
    const product = await prisma.product.findFirst({
      where: { isActive: true },
      include: { variants: true },
    });
    expect(product?.variants[0]).toBeTruthy();
    const variant = product!.variants[0];

    return prisma.order.create({
      data: {
        userId: buyer.id,
        status,
        email: buyer.email,
        lastName: 'Иванов',
        firstName: 'Иван',
        phone: '+79990001122',
        contactChannel: 'telegram',
        cityLabel: 'Москва',
        deliveryCode: 'PICKUP',
        deliveryTitle: 'Самовывоз',
        deliveryTrackNumber: '1234567890',
        deliveryTrackingUrl:
          'https://www.cdek.ru/ru/tracking?order_id=1234567890',
        total: variant.price,
        items: {
          create: [
            {
              productId: product!.id,
              variantId: variant.id,
              productName: product!.name,
              image: product!.image,
              weight: variant.weight,
              weightGrams: variant.weightGrams,
              price: variant.price,
              qty: 1,
            },
          ],
        },
      },
    });
  }

  it('forbids admin orders without ORDER_MANAGE', async () => {
    const { cookie } = await loginAs(
      app,
      'orders-staff-no-perm@example.com',
      UserRole.STAFF,
      [StaffPermission.PRODUCT_EDIT],
    );

    await request(app.getHttpServer())
      .get('/api/admin/orders')
      .set('Cookie', cookie)
      .expect(403);
  });

  it('lists and updates order status for ORDER_MANAGE staff', async () => {
    const order = await seedOrder('orders-buyer@example.com');
    const { cookie } = await loginAs(
      app,
      'orders-staff@example.com',
      UserRole.STAFF,
      [StaffPermission.ORDER_MANAGE],
    );

    const list = await request(app.getHttpServer())
      .get('/api/admin/orders')
      .query({ q: 'orders-buyer@example.com' })
      .set('Cookie', cookie)
      .expect(200);

    expect(list.body.total).toBeGreaterThanOrEqual(1);
    expect(list.body.counts).toEqual(
      expect.objectContaining({
        NEW: expect.any(Number),
        PAID: expect.any(Number),
      }),
    );
    expect(list.body.counts.NEW).toBeGreaterThanOrEqual(1);
    expect(list.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: order.id,
          status: 'NEW',
          customerEmail: 'orders-buyer@example.com',
          deliveryTracking: expect.objectContaining({
            trackNumber: '1234567890',
          }),
        }),
      ]),
    );

    const patched = await request(app.getHttpServer())
      .patch(`/api/admin/orders/${order.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'CONFIRMED' })
      .expect(200);

    expect(patched.body.status).toBe('CONFIRMED');

    const { cookie: buyerCookie } = await loginAs(
      app,
      'orders-buyer@example.com',
      UserRole.USER,
    );
    const mine = await request(app.getHttpServer())
      .get('/api/orders')
      .set('Cookie', buyerCookie)
      .expect(200);

    expect(mine.body.items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: order.id, status: 'CONFIRMED' }),
      ]),
    );
    expect(mine.body.page).toBe(1);
    expect(mine.body.limit).toBe(10);
    expect(mine.body.total).toBeGreaterThanOrEqual(1);
  });

  it('admin can manage orders without explicit permission row', async () => {
    const order = await seedOrder('orders-admin-buyer@example.com');
    const { cookie } = await loginAs(
      app,
      'orders-admin@example.com',
      UserRole.ADMIN,
    );

    const patched = await request(app.getHttpServer())
      .patch(`/api/admin/orders/${order.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'SHIPPED' })
      .expect(200);

    expect(patched.body.status).toBe('SHIPPED');
  });

  it('buyer can cancel unpaid NEW order', async () => {
    const order = await seedOrder('orders-cancel-buyer@example.com');
    const { cookie } = await loginAs(
      app,
      'orders-cancel-buyer@example.com',
      UserRole.USER,
    );

    const cancelled = await request(app.getHttpServer())
      .post(`/api/orders/${order.id}/cancel`)
      .set('Cookie', cookie)
      .expect(200);

    expect(cancelled.body.status).toBe('CANCELLED');

    await request(app.getHttpServer())
      .post(`/api/orders/${order.id}/cancel`)
      .set('Cookie', cookie)
      .expect(400);
  });

  it('openOnly lists unfinished orders for account badge', async () => {
    const email = 'orders-open-only@example.com';
    const buyer = await prisma.user.upsert({
      where: { email },
      create: { email, role: UserRole.USER },
      update: {},
    });
    await prisma.order.deleteMany({ where: { userId: buyer.id } });

    await seedOrder(email, OrderStatus.NEW);
    await seedOrder(email, OrderStatus.PAID);
    await seedOrder(email, OrderStatus.DONE);
    await seedOrder(email, OrderStatus.CANCELLED);
    await seedOrder(email, OrderStatus.ARCHIVED);

    const { cookie } = await loginAs(app, email, UserRole.USER);

    const all = await request(app.getHttpServer())
      .get('/api/orders?limit=50')
      .set('Cookie', cookie)
      .expect(200);
    expect(all.body.total).toBe(5);

    const open = await request(app.getHttpServer())
      .get('/api/orders?openOnly=true&limit=1')
      .set('Cookie', cookie)
      .expect(200);

    expect(open.body.total).toBe(2);
    for (const item of open.body.items as Array<{ status: string }>) {
      expect(['NEW', 'PAID', 'CONFIRMED', 'SHIPPED']).toContain(item.status);
    }
  });

  it('does not expose admin order delete', async () => {
    const order = await seedOrder('orders-nodelete-buyer@example.com');
    const { cookie } = await loginAs(
      app,
      'orders-nodelete-staff@example.com',
      UserRole.STAFF,
      [StaffPermission.ORDER_MANAGE],
    );

    await request(app.getHttpServer())
      .delete(`/api/admin/orders/${order.id}`)
      .set('Cookie', cookie)
      .expect(404);

    const still = await prisma.order.findUnique({ where: { id: order.id } });
    expect(still).not.toBeNull();
  });
});
