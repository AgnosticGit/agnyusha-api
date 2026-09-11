import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { UserRole } from '@prisma/client';
import { createTestApp } from './helpers/cdek-test.helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import {
  CART_COOKIE,
  SESSION_COOKIE,
  createRawToken,
  hashToken,
} from '../src/auth/auth.crypto';
function pickCookie(
  setCookie: string | string[] | undefined,
  name: string,
): string | undefined {
  const raw = Array.isArray(setCookie) ? setCookie : [setCookie ?? ''];
  for (const line of raw) {
    const part = line.split(';')[0] ?? '';
    if (part.startsWith(`${name}=`)) return part;
  }
  return undefined;
}

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

/** Seed a magic-link token in DB (avoids mail cooldown / IP rate limits across the suite). */
async function createMagicToken(app: INestApplication, email: string) {
  const prisma = app.get(PrismaService);
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, role: UserRole.USER },
    update: {},
  });
  const raw = createRawToken();
  await prisma.magicLink.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(raw),
      expiresAt: new Date(Date.now() + 15 * 60_000),
    },
  });
  return { user, token: raw };
}

describe('Cart guest persist & merge (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let variantId: string;
  let lowStockVariantId: string;
  let inactiveVariantId: string;
  let productId: string;
  let inactiveProductId: string;

  beforeAll(async () => {
    const created = await createTestApp({
      cdek: 'missing',
      yandex: 'missing',
    });
    app = created.app;
    prisma = app.get(PrismaService);

    const admin = await loginAs(app, 'cart-admin@example.com', UserRole.ADMIN);

    const active = await request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Cookie', admin.cookie)
      .send({
        name: 'Cart Active Feed',
        category: 'DOGS',
        variants: [
          {
            sku: 'CART-ACTIVE-01',
            weight: '1 кг.',
            weightGrams: 1000,
            price: 500,
            stock: 10,
          },
          {
            sku: 'CART-LOW-01',
            weight: '2 кг.',
            weightGrams: 2000,
            price: 900,
            stock: 3,
          },
        ],
        sections: [{ title: 'Состав', body: '<p>t</p>' }],
      })
      .expect(201);

    productId = active.body.id;
    variantId = active.body.variants[0].id;
    lowStockVariantId = active.body.variants[1].id;

    const inactive = await request(app.getHttpServer())
      .post('/api/admin/products')
      .set('Cookie', admin.cookie)
      .send({
        name: 'Cart Inactive Feed',
        category: 'CATS',
        variants: [
          {
            sku: 'CART-INACTIVE-01',
            weight: '0,5 кг.',
            weightGrams: 500,
            price: 400,
            stock: 8,
          },
        ],
        sections: [{ title: 'Состав', body: '<p>t</p>' }],
      })
      .expect(201);

    inactiveProductId = inactive.body.id;
    inactiveVariantId = inactive.body.variants[0].id;
    await prisma.product.update({
      where: { id: inactiveProductId },
      data: { isActive: false },
    });
  });

  afterAll(async () => {
    await prisma.cartItem.deleteMany({
      where: {
        OR: [
          { variantId },
          { variantId: lowStockVariantId },
          { variantId: inactiveVariantId },
        ],
      },
    });
    await prisma.cart.deleteMany({
      where: {
        OR: [
          { user: { email: { contains: 'cart-' } } },
          { guestTokenHash: { not: null } },
        ],
      },
    });
    if (productId) {
      await prisma.product
        .delete({ where: { id: productId } })
        .catch(() => undefined);
    }
    if (inactiveProductId) {
      await prisma.product
        .delete({ where: { id: inactiveProductId } })
        .catch(() => undefined);
    }
    await app.close();
  });

  it('guest add sets cart cookie and persists across requests', async () => {
    const add = await request(app.getHttpServer())
      .put('/api/cart/items')
      .send({ variantId, qty: 2 })
      .expect(200);

    expect(add.body.items).toHaveLength(1);
    expect(add.body.items[0].variantId).toBe(variantId);
    expect(add.body.items[0].qty).toBe(2);
    expect(add.body.items[0].price).toBe(500);

    const guestCookie = pickCookie(add.headers['set-cookie'], CART_COOKIE);
    expect(guestCookie).toBeTruthy();
    expect(String(add.headers['set-cookie'])).toMatch(/HttpOnly/i);

    const again = await request(app.getHttpServer())
      .get('/api/cart')
      .set('Cookie', guestCookie!)
      .expect(200);

    expect(again.body.items).toHaveLength(1);
    expect(again.body.items[0].qty).toBe(2);
  });

  it('caps qty to stock on upsert', async () => {
    if (process.env.INVENTORY_ENABLED !== 'true') return;

    const add = await request(app.getHttpServer())
      .put('/api/cart/items')
      .send({ variantId: lowStockVariantId, qty: 99 })
      .expect(200);

    expect(add.body.items[0].qty).toBe(3);
    expect(add.body.adjustments.capped).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          variantId: lowStockVariantId,
          from: 99,
          to: 3,
        }),
      ]),
    );
  });

  it('rejects inactive product and missing variant', async () => {
    await request(app.getHttpServer())
      .put('/api/cart/items')
      .send({ variantId: inactiveVariantId, qty: 1 })
      .expect(400);

    await request(app.getHttpServer())
      .put('/api/cart/items')
      .send({ variantId: 'missing-variant-id', qty: 1 })
      .expect(404);
  });

  it('rejects out-of-stock add', async () => {
    if (process.env.INVENTORY_ENABLED !== 'true') return;

    await prisma.productVariant.update({
      where: { id: lowStockVariantId },
      data: { stock: 0 },
    });

    await request(app.getHttpServer())
      .put('/api/cart/items')
      .send({ variantId: lowStockVariantId, qty: 1 })
      .expect(400);

    await prisma.productVariant.update({
      where: { id: lowStockVariantId },
      data: { stock: 3 },
    });
  });

  it('login merges guest cart into empty user cart and clears guest cookie', async () => {
    const email = 'cart-merge-empty@example.com';
    const { token } = await createMagicToken(app, email);

    const guestAdd = await request(app.getHttpServer())
      .put('/api/cart/items')
      .send({ variantId, qty: 2 })
      .expect(200);
    expect(guestAdd.body.items).toHaveLength(1);
    expect(guestAdd.body.items[0].productSlug).toBeTruthy();
    const guestCookie = pickCookie(
      guestAdd.headers['set-cookie'],
      CART_COOKIE,
    )!;

    const verify = await request(app.getHttpServer())
      .post('/api/auth/verify')
      .set('Cookie', guestCookie)
      .send({ token })
      .expect(200);

    expect(verify.body.user.email).toBe(email);
    expect(verify.body.cart.items).toHaveLength(1);
    expect(verify.body.cart.items[0].qty).toBe(2);

    const setCookie = verify.headers['set-cookie'];
    const session = pickCookie(setCookie, SESSION_COOKIE)!;
    expect(String(setCookie)).toMatch(new RegExp(`${CART_COOKIE}=;`));

    const cart = await request(app.getHttpServer())
      .get('/api/cart')
      .set('Cookie', session)
      .expect(200);
    expect(cart.body.items).toHaveLength(1);
    expect(cart.body.items[0].qty).toBe(2);
  });

  it('login merge sums qtys then caps to stock', async () => {
    const email = 'cart-merge-cap@example.com';
    const user = await loginAs(app, email);

    await request(app.getHttpServer())
      .put('/api/cart/items')
      .set('Cookie', user.cookie)
      .send({ variantId: lowStockVariantId, qty: 2 })
      .expect(200);

    const guestAdd = await request(app.getHttpServer())
      .put('/api/cart/items')
      .send({ variantId: lowStockVariantId, qty: 2 })
      .expect(200);
    const guestCookie = pickCookie(
      guestAdd.headers['set-cookie'],
      CART_COOKIE,
    )!;

    const merged = await request(app.getHttpServer())
      .get('/api/cart')
      .set('Cookie', `${user.cookie}; ${guestCookie}`)
      .expect(200);

    expect(merged.body.items).toHaveLength(1);
    if (process.env.INVENTORY_ENABLED === 'true') {
      expect(merged.body.items[0].qty).toBe(3);
      expect(merged.body.adjustments.capped).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            variantId: lowStockVariantId,
            from: 4,
            to: 3,
          }),
        ]),
      );
    } else {
      expect(merged.body.items[0].qty).toBe(4);
      expect(merged.body.adjustments.capped).toEqual([]);
    }
  });

  it('merge drops inactive and out-of-stock lines', async () => {
    const email = 'cart-merge-drop@example.com';
    const user = await loginAs(app, email);

    // Temporarily activate inactive product to add as guest, then deactivate
    await prisma.product.update({
      where: { id: inactiveProductId },
      data: { isActive: true },
    });
    const guestInactive = await request(app.getHttpServer())
      .put('/api/cart/items')
      .send({ variantId: inactiveVariantId, qty: 1 })
      .expect(200);
    let guestCookie = pickCookie(
      guestInactive.headers['set-cookie'],
      CART_COOKIE,
    )!;

    const oosVariant = await prisma.productVariant.create({
      data: {
        productId,
        sku: `CART-OOS-${Date.now()}`,
        weight: '3 кг.',
        weightGrams: 3000,
        price: 100,
        stock: 5,
      },
    });
    const guestOos = await request(app.getHttpServer())
      .put('/api/cart/items')
      .set('Cookie', guestCookie)
      .send({ variantId: oosVariant.id, qty: 2 })
      .expect(200);
    guestCookie =
      pickCookie(guestOos.headers['set-cookie'], CART_COOKIE) ?? guestCookie;

    await request(app.getHttpServer())
      .put('/api/cart/items')
      .set('Cookie', guestCookie)
      .send({ variantId, qty: 1 })
      .expect(200);

    await prisma.product.update({
      where: { id: inactiveProductId },
      data: { isActive: false },
    });
    await prisma.productVariant.update({
      where: { id: oosVariant.id },
      data: { stock: 0 },
    });

    const merged = await request(app.getHttpServer())
      .get('/api/cart')
      .set('Cookie', `${user.cookie}; ${guestCookie}`)
      .expect(200);

    if (process.env.INVENTORY_ENABLED === 'true') {
      expect(
        merged.body.items.map((i: { variantId: string }) => i.variantId),
      ).toEqual([variantId]);
      expect(merged.body.adjustments.removed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            variantId: inactiveVariantId,
            reason: 'inactive',
          }),
          expect.objectContaining({
            variantId: oosVariant.id,
            reason: 'out_of_stock',
          }),
        ]),
      );
    } else {
      expect(
        merged.body.items.map((i: { variantId: string }) => i.variantId).sort(),
      ).toEqual([variantId, oosVariant.id].sort());
      expect(merged.body.adjustments.removed).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            variantId: inactiveVariantId,
            reason: 'inactive',
          }),
        ]),
      );
      expect(
        merged.body.adjustments.removed.some(
          (r: { reason: string }) => r.reason === 'out_of_stock',
        ),
      ).toBe(false);
    }

    await prisma.cartItem.deleteMany({ where: { variantId: oosVariant.id } });
    await prisma.productVariant.delete({ where: { id: oosVariant.id } });
  });

  it('GET cart after merge with only session returns merged cart', async () => {
    const email = 'cart-merge-session@example.com';
    const user = await loginAs(app, email);

    const guestAdd = await request(app.getHttpServer())
      .put('/api/cart/items')
      .send({ variantId, qty: 1 })
      .expect(200);
    const guestCookie = pickCookie(
      guestAdd.headers['set-cookie'],
      CART_COOKIE,
    )!;

    await request(app.getHttpServer())
      .get('/api/cart')
      .set('Cookie', `${user.cookie}; ${guestCookie}`)
      .expect(200);

    const onlySession = await request(app.getHttpServer())
      .get('/api/cart')
      .set('Cookie', user.cookie)
      .expect(200);

    expect(
      onlySession.body.items.some(
        (i: { variantId: string }) => i.variantId === variantId,
      ),
    ).toBe(true);
  });

  it('DELETE item and clear cart', async () => {
    const add = await request(app.getHttpServer())
      .put('/api/cart/items')
      .send({ variantId, qty: 2 })
      .expect(200);
    const guestCookie = pickCookie(add.headers['set-cookie'], CART_COOKIE)!;

    await request(app.getHttpServer())
      .delete(`/api/cart/items/${variantId}`)
      .set('Cookie', guestCookie)
      .expect(200)
      .expect((res) => {
        expect(res.body.items).toHaveLength(0);
      });

    await request(app.getHttpServer())
      .put('/api/cart/items')
      .set('Cookie', guestCookie)
      .send({ variantId, qty: 1 })
      .expect(200);

    await request(app.getHttpServer())
      .delete('/api/cart')
      .set('Cookie', guestCookie)
      .expect(200)
      .expect((res) => {
        expect(res.body.items).toHaveLength(0);
      });
  });

  it('creating an order removes ordered variants from the cart', async () => {
    const buyer = await loginAs(app, 'cart-order-buyer@example.com');
    const add = await request(app.getHttpServer())
      .put('/api/cart/items')
      .set('Cookie', buyer.cookie)
      .send({ variantId, qty: 2 })
      .expect(200);
    expect(add.body.items).toHaveLength(1);

    await request(app.getHttpServer())
      .post('/api/orders')
      .set('Cookie', buyer.cookie)
      .send({
        email: 'cart-order-buyer@example.com',
        lastName: 'Иванов',
        firstName: 'Иван',
        phone: '+7 (999) 111-22-33',
        contactChannel: 'Telegram',
        cityLabel: 'Санкт-Петербург',
        deliveryCode: 'PICKUP',
        deliveryTitle: 'Самовывоз',
        items: [{ variantId, qty: 2 }],
      })
      .expect(201);

    const cart = await request(app.getHttpServer())
      .get('/api/cart')
      .set('Cookie', buyer.cookie)
      .expect(200);
    expect(cart.body.items).toHaveLength(0);
  });

  it('guest order clears ordered variants from the guest cart', async () => {
    const add = await request(app.getHttpServer())
      .put('/api/cart/items')
      .send({ variantId, qty: 1 })
      .expect(200);
    const guestCookie = pickCookie(add.headers['set-cookie'], CART_COOKIE);
    expect(guestCookie).toBeTruthy();

    await request(app.getHttpServer())
      .post('/api/orders')
      .set('Cookie', guestCookie!)
      .send({
        email: 'cart-guest-order@example.com',
        lastName: 'Петров',
        firstName: 'Пётр',
        phone: '+7 (999) 222-33-44',
        contactChannel: 'WhatsApp',
        cityLabel: 'Москва',
        deliveryCode: 'PICKUP',
        deliveryTitle: 'Самовывоз',
        items: [{ variantId, qty: 1 }],
      })
      .expect(201);

    const cart = await request(app.getHttpServer())
      .get('/api/cart')
      .set('Cookie', guestCookie!)
      .expect(200);
    expect(cart.body.items).toHaveLength(0);
  });

  it('order removes only ordered variants and keeps the rest', async () => {
    const buyer = await loginAs(app, 'cart-order-partial@example.com');
    await request(app.getHttpServer())
      .put('/api/cart/items')
      .set('Cookie', buyer.cookie)
      .send({ variantId, qty: 1 })
      .expect(200);
    await request(app.getHttpServer())
      .put('/api/cart/items')
      .set('Cookie', buyer.cookie)
      .send({ variantId: lowStockVariantId, qty: 1 })
      .expect(200);

    await request(app.getHttpServer())
      .post('/api/orders')
      .set('Cookie', buyer.cookie)
      .send({
        email: 'cart-order-partial@example.com',
        lastName: 'Сидоров',
        firstName: 'Сидор',
        phone: '+7 (999) 333-44-55',
        contactChannel: 'Telegram',
        cityLabel: 'Казань',
        deliveryCode: 'PICKUP',
        deliveryTitle: 'Самовывоз',
        items: [{ variantId, qty: 1 }],
      })
      .expect(201);

    const cart = await request(app.getHttpServer())
      .get('/api/cart')
      .set('Cookie', buyer.cookie)
      .expect(200);
    expect(cart.body.items).toHaveLength(1);
    expect(cart.body.items[0].variantId).toBe(lowStockVariantId);
  });
});
