import type { INestApplication } from '@nestjs/common';
import { DeliveryMethodCode, OrderStatus, UserRole } from '@prisma/client';
import {
  createMockCdekFetch,
  createMockYandexFetch,
  createTestApp,
  jsonResponse,
} from './helpers/cdek-test.helpers';
import { PrismaService } from '../src/prisma/prisma.service';
import { DeliveryTrackingPoller } from '../src/orders/delivery-tracking.poller';

async function seedOrder(
  prisma: PrismaService,
  data: {
    email: string;
    deliveryCode: DeliveryMethodCode;
    externalDeliveryId: string;
    deliveryStatusCode?: string | null;
    deliveryStatusAt?: Date | null;
  },
) {
  return prisma.order.create({
    data: {
      email: data.email,
      lastName: 'Иванов',
      firstName: 'Иван',
      phone: '+79001112233',
      contactChannel: 'Telegram',
      cityLabel: 'Москва',
      deliveryCode: data.deliveryCode,
      deliveryTitle: data.deliveryCode,
      pickupLabel: 'ПВЗ',
      pickupCode: 'MSK1',
      status: OrderStatus.PAID,
      paidAt: new Date(),
      total: 500,
      externalDeliveryId: data.externalDeliveryId,
      deliveryStatusCode: data.deliveryStatusCode ?? null,
      deliveryStatusAt: data.deliveryStatusAt ?? null,
      items: {
        create: [
          {
            productName: 'Корм',
            image: '/assets/product-turkey.png',
            weight: '1 кг.',
            weightGrams: 1000,
            price: 500,
            qty: 1,
          },
        ],
      },
    },
  });
}

describe('Delivery tracking background poller (e2e)', () => {
  let app: INestApplication;
  const cdekGets: string[] = [];
  let yandexInfoCalls = 0;

  beforeAll(async () => {
    process.env.CDEK_POLL_INTERVAL_MIN = '60';
    process.env.CDEK_POLL_GAP_MS = '100';
    process.env.YANDEX_POLL_INTERVAL_MIN = '60';
    process.env.YANDEX_POLL_GAP_MS = '100';

    const cdek = createMockCdekFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('/v2/oauth/token') && method === 'POST') {
        return jsonResponse({
          access_token: 'poller-token',
          token_type: 'bearer',
          expires_in: 3600,
        });
      }
      const orderMatch = url.match(/\/v2\/orders\/([^/?]+)/);
      if (orderMatch && method === 'GET') {
        cdekGets.push(orderMatch[1]);
        return jsonResponse({
          entity: {
            uuid: orderMatch[1],
            cdek_number: '1100999',
            statuses: [{ code: 'ACCEPTED', name: 'Принят' }],
          },
        });
      }
      return jsonResponse({ message: `unexpected ${method} ${url}` }, 500);
    });

    const yandex = createMockYandexFetch(async (input, init) => {
      const url = String(input);
      const method = (init?.method || 'GET').toUpperCase();
      if (url.includes('/request/info') && method === 'GET') {
        yandexInfoCalls += 1;
        return jsonResponse({
          request_id: 'ya-poll-1',
          state: { status: 'DELIVERY_ARRIVED', description: 'В ПВЗ' },
        });
      }
      return jsonResponse({ message: `unexpected ${method} ${url}` }, 500);
    });

    const created = await createTestApp({
      cdekFetch: cdek.fetchMock,
      yandexFetch: yandex.fetchMock,
      cdek: 'present',
      yandex: 'present',
    });
    app = created.app;
  });

  afterAll(async () => {
    await app.close();
  });

  it('polls CDEK due orders one-by-one with GAP and ignores Yandex / finals', async () => {
    const prisma = app.get(PrismaService);
    const poller = app.get(DeliveryTrackingPoller);
    const user = await prisma.user.upsert({
      where: { email: 'poller-e2e@example.com' },
      create: { email: 'poller-e2e@example.com', role: UserRole.USER },
      update: { role: UserRole.USER },
    });

    const neverPolled = await seedOrder(prisma, {
      email: 'poll-never@example.com',
      deliveryCode: DeliveryMethodCode.CDEK,
      externalDeliveryId: 'cdek-never',
    });
    const old = await seedOrder(prisma, {
      email: 'poll-old@example.com',
      deliveryCode: DeliveryMethodCode.CDEK,
      externalDeliveryId: 'cdek-old',
      deliveryStatusAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
    });
    const delivered = await seedOrder(prisma, {
      email: 'poll-done@example.com',
      deliveryCode: DeliveryMethodCode.CDEK,
      externalDeliveryId: 'cdek-done',
      deliveryStatusCode: 'DELIVERED',
    });
    const yandexOrder = await seedOrder(prisma, {
      email: 'poll-ya@example.com',
      deliveryCode: DeliveryMethodCode.YANDEX,
      externalDeliveryId: 'ya-poll-1',
    });

    try {
      const t0 = Date.now();
      const snapBefore = await poller.snapshot('CDEK');
      expect(snapBefore.gapMs).toBe(100);
      expect(snapBefore.intervalMs).toBe(60 * 60_000);

      const yandexBeforeCdek = yandexInfoCalls;
      await poller.tickCarrier('CDEK', t0);
      expect(cdekGets.length).toBeGreaterThanOrEqual(1);
      expect(yandexInfoCalls).toBe(yandexBeforeCdek);

      const afterFirst = cdekGets.length;
      await poller.tickCarrier('CDEK', t0 + 50);
      expect(cdekGets.length).toBe(afterFirst);

      for (let i = 1; i <= 40; i++) {
        await poller.tickCarrier('CDEK', t0 + i * 100);
        const neverRow = await prisma.order.findUnique({
          where: { id: neverPolled.id },
        });
        const oldRow = await prisma.order.findUnique({ where: { id: old.id } });
        if (
          neverRow?.deliveryStatusCode === 'ACCEPTED' &&
          oldRow?.deliveryStatusCode === 'ACCEPTED'
        ) {
          break;
        }
      }

      expect(cdekGets).toEqual(
        expect.arrayContaining(['cdek-never', 'cdek-old']),
      );
      expect(cdekGets).not.toContain('cdek-done');
      expect(yandexInfoCalls).toBe(yandexBeforeCdek);

      for (let i = 0; i <= 40; i++) {
        await poller.tickCarrier('YANDEX', t0 + i * 100);
        const yaRow = await prisma.order.findUnique({
          where: { id: yandexOrder.id },
        });
        if (yaRow?.deliveryStatusCode === 'DELIVERY_ARRIVED') break;
      }

      const neverRow = await prisma.order.findUnique({
        where: { id: neverPolled.id },
      });
      const oldRow = await prisma.order.findUnique({ where: { id: old.id } });
      const doneRow = await prisma.order.findUnique({
        where: { id: delivered.id },
      });
      const yaRow = await prisma.order.findUnique({
        where: { id: yandexOrder.id },
      });

      expect(neverRow?.deliveryStatusCode).toBe('ACCEPTED');
      expect(oldRow?.deliveryStatusCode).toBe('ACCEPTED');
      expect(doneRow?.deliveryStatusCode).toBe('DELIVERED');
      expect(yaRow?.deliveryStatusCode).toBe('DELIVERY_ARRIVED');
      expect(yandexInfoCalls).toBeGreaterThan(yandexBeforeCdek);

      const snap = await poller.snapshot('CDEK');
      expect(snap.lastSuccessAt).toBeTruthy();
      expect(snap.enabled).toBe(true);
    } finally {
      await prisma.order.deleteMany({
        where: {
          id: {
            in: [neverPolled.id, old.id, delivered.id, yandexOrder.id],
          },
        },
      });
      await prisma.user
        .delete({ where: { id: user.id } })
        .catch(() => undefined);
    }
  });
});
