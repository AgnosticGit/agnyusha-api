import { DeliveryService } from '../../src/delivery/delivery.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { CdekService } from '../../src/cdek/cdek.service';
import type { YandexDeliveryService } from '../../src/yandex/yandex-delivery.service';
import type { PochtaService } from '../../src/pochta/pochta.service';
import type { OzonDeliveryService } from '../../src/ozon-delivery/ozon-delivery.service';

describe('DeliveryService list cache', () => {
  function makeService() {
    const findMany = jest.fn().mockResolvedValue([
      { id: '1', code: 'CDEK', title: 'СДЭК', description: '' },
    ]);
    const prisma = {
      deliveryMethod: { findMany },
    } as unknown as PrismaService;
    const service = new DeliveryService(
      prisma,
      {} as CdekService,
      {} as YandexDeliveryService,
      {} as PochtaService,
      {} as OzonDeliveryService,
    );
    return { service, findMany };
  }

  afterEach(() => {
    delete process.env.NODE_ENV;
  });

  it('reuses active methods within TTL outside test env', async () => {
    process.env.NODE_ENV = 'development';
    const { service, findMany } = makeService();
    await service.list();
    await service.list();
    expect(findMany).toHaveBeenCalledTimes(1);
  });

  it('skips cache in test env', async () => {
    process.env.NODE_ENV = 'test';
    const { service, findMany } = makeService();
    await service.list();
    await service.list();
    expect(findMany).toHaveBeenCalledTimes(2);
  });
});
