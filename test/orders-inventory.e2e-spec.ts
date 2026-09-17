import type { INestApplication } from '@nestjs/common';
import { testStorePickupAt } from './helpers/pickup-slot';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import {
  createTestApp,
  setSiteInventoryEnabled,
} from './helpers/cdek-test.helpers';
import { loginAs } from './helpers/login-as';
import { PrismaService } from '../src/prisma/prisma.service';

describe('Orders inventory (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const created = await createTestApp({ cdek: 'missing', yandex: 'missing' });
    app = created.app;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await setSiteInventoryEnabled(prisma, false);
    await app.close();
  });

  async function withInventory<T>(fn: () => Promise<T>): Promise<T> {
    await setSiteInventoryEnabled(prisma, true);
    try {
      return await fn();
    } finally {
      await setSiteInventoryEnabled(prisma, false);
    }
  }

  async function createStockProduct(stock: number, price = 500) {
    const admin = await loginAs(
      app,
      `inv-admin-${Date.now()}@example.com`,
      UserRole.ADMIN,
    );
    const created = await request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Cookie', admin.cookie)
      .send({
        name: `Inventory ${Date.now()}`,
        category: 'DOGS',
        variants: [
          {
            sku: `INV-${Date.now()}`,
            weight: '1 кг.',
            weightGrams: 1000,
            lengthCm: 20,
            widthCm: 15,
            heightCm: 10,
            price,
            stock,
          },
        ],
        sections: [{ title: 'Состав', body: '<p>test</p>' }],
      })
      .expect(201);
    return { admin, product: created.body };
  }

  function orderBody(
    product: {
      id: string;
      name: string;
      image: string;
      variants: Array<{ id: string; price: number }>;
    },
    qty: number,
  ) {
    return {
      email: 'inv-buyer@example.com',
      lastName: 'Иванов',
      firstName: 'Иван',
      phone: '+7 (999) 111-22-33',
      contactChannel: 'Telegram',
      cityLabel: 'Санкт-Петербург',
      deliveryCode: 'PICKUP',
      deliveryTitle: 'Самовывоз',
        storePickupAt: testStorePickupAt(),
      privacyConsent: true,
      items: [
        {
          productId: product.id,
          variantId: product.variants[0].id,
          name: product.name,
          image: product.image,
          weight: '1 кг.',
          price: product.variants[0].price,
          qty,
        },
      ],
    };
  }

  it('decrements stock on create and restores on buyer cancel', async () => {
    await withInventory(async () => {
      const { admin, product } = await createStockProduct(5);
      const buyer = await loginAs(app, `inv-buyer-${Date.now()}@example.com`);

      const order = await request(app.getHttpServer())
        .post('/api/orders')
        .set('Cookie', buyer.cookie)
        .send(orderBody(product, 2))
        .expect(201);

      const afterCreate = await request(app.getHttpServer())
        .get(`/api/admin/products/${product.id}`)
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(afterCreate.body.variants[0].stock).toBe(3);

      await request(app.getHttpServer())
        .post(`/api/orders/${order.body.id}/cancel`)
        .set('Cookie', buyer.cookie)
        .expect(200);

      const afterCancel = await request(app.getHttpServer())
        .get(`/api/admin/products/${product.id}`)
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(afterCancel.body.variants[0].stock).toBe(5);

      await request(app.getHttpServer())
        .delete(`/api/admin/products/${product.id}`)
        .set('Cookie', admin.cookie)
        .expect(200);
    });
  });

  it('rejects oversell when qty exceeds stock', async () => {
    await withInventory(async () => {
      const { admin, product } = await createStockProduct(1);
      const buyer = await loginAs(
        app,
        `inv-oversell-${Date.now()}@example.com`,
      );

      await request(app.getHttpServer())
        .post('/api/orders')
        .set('Cookie', buyer.cookie)
        .send(orderBody(product, 2))
        .expect(400);

      const still = await request(app.getHttpServer())
        .get(`/api/admin/products/${product.id}`)
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(still.body.variants[0].stock).toBe(1);

      await request(app.getHttpServer())
        .delete(`/api/admin/products/${product.id}`)
        .set('Cookie', admin.cookie)
        .expect(200);
    });
  });

  it('restores stock once when admin cancels', async () => {
    await withInventory(async () => {
      const { admin, product } = await createStockProduct(4);
      const buyer = await loginAs(
        app,
        `inv-admin-cancel-${Date.now()}@example.com`,
      );

      const order = await request(app.getHttpServer())
        .post('/api/orders')
        .set('Cookie', buyer.cookie)
        .send(orderBody(product, 1))
        .expect(201);

      await request(app.getHttpServer())
        .patch(`/api/admin/orders/${order.body.id}/status`)
        .set('Cookie', admin.cookie)
        .send({ status: 'CANCELLED' })
        .expect(200);

      const after = await request(app.getHttpServer())
        .get(`/api/admin/products/${product.id}`)
        .set('Cookie', admin.cookie)
        .expect(200);
      expect(after.body.variants[0].stock).toBe(4);

      await request(app.getHttpServer())
        .delete(`/api/admin/products/${product.id}`)
        .set('Cookie', admin.cookie)
        .expect(200);
    });
  });
});
