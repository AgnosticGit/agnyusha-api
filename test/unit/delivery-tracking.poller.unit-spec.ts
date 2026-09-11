import { ConfigService } from '@nestjs/config';
import { DeliveryTrackingPoller } from '../../src/orders/delivery-tracking.poller';
import type { OrdersService } from '../../src/orders/orders.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { CdekService } from '../../src/cdek/cdek.service';
import type { YandexDeliveryService } from '../../src/yandex/yandex-delivery.service';
import type { PochtaService } from '../../src/pochta/pochta.service';

function makePoller(options?: {
  intervalMin?: string;
  gapMs?: string;
  due?: { id: string } | null;
  sync?: jest.Mock;
}) {
  const config = {
    get: (key: string) => {
      if (key.endsWith('_POLL_INTERVAL_MIN')) {
        return options?.intervalMin ?? '60';
      }
      if (key.endsWith('_POLL_GAP_MS')) return options?.gapMs ?? '2500';
      return undefined;
    },
  } as unknown as ConfigService;

  const prisma = {
    order: {
      findFirst: jest.fn().mockResolvedValue(options?.due ?? null),
      count: jest.fn().mockResolvedValue(options?.due ? 1 : 0),
    },
  };

  const sync = options?.sync ?? jest.fn().mockResolvedValue(options?.due);
  const orders = {
    syncDeliveryTracking: sync,
  } as unknown as OrdersService;

  const cdek = { isConfigured: jest.fn().mockReturnValue(true) };
  const yandex = { isConfigured: jest.fn().mockReturnValue(true) };
  const pochta = { isConfigured: jest.fn().mockReturnValue(false) };

  const poller = new DeliveryTrackingPoller(
    config,
    prisma as unknown as PrismaService,
    orders,
    cdek as unknown as CdekService,
    yandex as unknown as YandexDeliveryService,
    pochta as unknown as PochtaService,
  );

  return { poller, prisma, sync, cdek, yandex };
}

describe('DeliveryTrackingPoller', () => {
  it('does not start a timer under Jest', () => {
    const { poller } = makePoller();
    poller.onModuleInit();
    poller.onModuleDestroy();
    expect(process.env.JEST_WORKER_ID).toBeTruthy();
  });

  it('polls the due CDEK order and respects GAP on the next tick', async () => {
    const due = { id: 'ord-1', deliveryCode: 'CDEK' };
    const { poller, prisma, sync } = makePoller({ due, gapMs: '2500' });

    await poller.tickCarrier('CDEK', 10_000);
    expect(prisma.order.findFirst).toHaveBeenCalledTimes(1);
    expect(sync).toHaveBeenCalledWith(due);

    await poller.tickCarrier('CDEK', 11_000);
    expect(sync).toHaveBeenCalledTimes(1);

    await poller.tickCarrier('CDEK', 12_500);
    expect(sync).toHaveBeenCalledTimes(2);
  });

  it('does not touch Yandex when ticking CDEK', async () => {
    const due = { id: 'ord-cdek' };
    const { poller, prisma, sync } = makePoller({ due });

    await poller.tickCarrier('CDEK', 1);
    expect(sync).toHaveBeenCalledTimes(1);
    const where = prisma.order.findFirst.mock.calls[0][0].where;
    expect(where.deliveryCode).toBe('CDEK');
  });

  it('skips a carrier that is not configured', async () => {
    const { poller, prisma, sync, yandex } = makePoller({
      due: { id: 'ord-ya' },
    });
    yandex.isConfigured.mockReturnValue(false);

    await poller.tickCarrier('YANDEX', 1);
    expect(prisma.order.findFirst).not.toHaveBeenCalled();
    expect(sync).not.toHaveBeenCalled();
  });

  it('skips when interval is 0', async () => {
    const { poller, sync } = makePoller({
      due: { id: 'ord-1' },
      intervalMin: '0',
    });
    await poller.tickCarrier('CDEK', 1);
    expect(sync).not.toHaveBeenCalled();
  });

  it('does not call the API when nobody is due', async () => {
    const { poller, sync } = makePoller({ due: null });
    await poller.tickCarrier('CDEK', 1);
    expect(sync).not.toHaveBeenCalled();
  });

  it('records an error without throwing out of tick', async () => {
    const { poller } = makePoller({
      due: { id: 'ord-1' },
      sync: jest.fn().mockRejectedValue(new Error('cdek timeout')),
    });
    await expect(poller.tickCarrier('CDEK', 1)).resolves.toBeUndefined();
    const snap = await poller.snapshot('CDEK');
    expect(snap.lastError).toContain('cdek timeout');
    expect(snap.lastSuccessAt).toBeNull();
  });
});
