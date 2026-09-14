import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { OrderStatus, UserRole } from '@prisma/client';
import {
  createRawToken,
  hashToken,
  SESSION_COOKIE,
} from '../src/auth/auth.crypto';
import { PrismaService } from '../src/prisma/prisma.service';
import { createTestApp } from './helpers/cdek-test.helpers';
import type { SendMailInput } from '../src/mail/mail.tokens';

describe('Order DONE email (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  const sent: SendMailInput[] = [];

  beforeAll(async () => {
    const created = await createTestApp({
      mailSend: async (input) => {
        sent.push(input);
      },
    });
    app = created.app;
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  it('sends HTML mail when status becomes DONE', async () => {
    sent.length = 0;
    const email = `done-mail-${Date.now()}@example.com`;
    const admin = await prisma.user.create({
      data: {
        email: `admin-${Date.now()}@example.com`,
        role: UserRole.ADMIN,
        emailVerifiedAt: new Date(),
      },
    });
    const raw = createRawToken();
    await prisma.session.create({
      data: {
        userId: admin.id,
        tokenHash: hashToken(raw),
        expiresAt: new Date(Date.now() + 86400000),
      },
    });
    const cookie = `${SESSION_COOKIE}=${raw}`;

    const product = await prisma.product.findFirst({
      where: { isActive: true },
      include: { variants: true },
    });
    if (!product?.variants[0]) return;

    const order = await prisma.order.create({
      data: {
        userId: null,
        status: OrderStatus.SHIPPED,
        email,
        phone: '+79991234567',
        lastName: 'Тест',
        firstName: 'Клиент',
        contactChannel: 'phone',
        cityLabel: 'Москва',
        deliveryCode: 'CDEK',
        deliveryTitle: 'СДЭК',
        pickupLabel: 'ПВЗ Тест',
        subtotal: product.variants[0].price,
        total: product.variants[0].price,
        items: {
          create: {
            productId: product.id,
            variantId: product.variants[0].id,
            productName: product.name,
            image: product.image,
            weight: product.variants[0].weight,
            weightGrams: product.variants[0].weightGrams,
            lengthCm: product.variants[0].lengthCm,
            widthCm: product.variants[0].widthCm,
            heightCm: product.variants[0].heightCm,
            price: product.variants[0].price,
            qty: 1,
          },
        },
      },
    });

    await request(app.getHttpServer())
      .patch(`/api/admin/orders/${order.id}/status`)
      .set('Cookie', cookie)
      .send({ status: 'DONE' })
      .expect(200);

    // mail is fire-and-forget
    await new Promise((r) => setTimeout(r, 50));
    expect(sent.length).toBeGreaterThanOrEqual(1);
    const mail = sent.find((m) => m.to === email);
    expect(mail).toBeTruthy();
    expect(mail!.html).toMatch(/заверш|получен|заказ/i);
    expect(mail!.subject).toContain(`№`);
    expect(mail!.html).toContain('account');
  });
});
