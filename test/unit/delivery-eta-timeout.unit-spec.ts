import { DeliveryService } from '../../src/delivery/delivery.service';
import type { PrismaService } from '../../src/prisma/prisma.service';
import type { CdekService } from '../../src/cdek/cdek.service';
import type { YandexDeliveryService } from '../../src/yandex/yandex-delivery.service';
import type { PochtaService } from '../../src/pochta/pochta.service';
import type { OzonDeliveryService } from '../../src/ozon-delivery/ozon-delivery.service';

describe('DeliveryService.forLocation ETA timeout', () => {
  it('returns methods without waiting forever on a hung carrier ETA', async () => {
    const prisma = {
      deliveryMethod: {
        findMany: jest.fn().mockResolvedValue([
          {
            id: 'm1',
            code: 'CDEK',
            title: 'СДЭК',
            description: null,
          },
          {
            id: 'm2',
            code: 'YANDEX',
            title: 'Яндекс',
            description: null,
          },
          {
            id: 'm3',
            code: 'POST',
            title: 'Почта',
            description: null,
          },
        ]),
      },
    } as unknown as PrismaService;

    const cdek = {
      isConfigured: () => true,
      estimateDeliveryEta: jest.fn(
        () =>
          new Promise(() => {
            /* never resolves */
          }),
      ),
    } as unknown as CdekService;

    const yandex = {
      isTestEnvironment: () => false,
      isOrderCreationConfigured: () => true,
      estimateDeliveryEta: jest.fn().mockResolvedValue({
        minDays: 1,
        maxDays: 2,
        text: '1–2 дня',
      }),
    } as unknown as YandexDeliveryService;

    const pochta = {
      isConfigured: () => true,
      isOrderCreationConfigured: () => true,
      estimateDeliveryEta: jest.fn().mockResolvedValue(null),
    } as unknown as PochtaService;

    const ozon = {
      isOrderCreationConfigured: () => false,
    } as unknown as OzonDeliveryService;

    const service = new DeliveryService(prisma, cdek, yandex, pochta, ozon);

    const started = Date.now();
    const methods = await service.forLocation({
      region: 'Москва',
      label: 'Москва',
      settlement: 'Москва',
      cdekCode: 44,
      yandexGeoId: 213,
      weightGrams: 1000,
    });
    const elapsed = Date.now() - started;

    expect(elapsed).toBeLessThan(6_000);
    expect(methods.some((m) => m.code === 'CDEK' && m.available)).toBe(true);
    expect(methods.find((m) => m.code === 'CDEK')?.etaText ?? null).toBeNull();
    expect(methods.find((m) => m.code === 'YANDEX')?.etaText).toBe('1–2 дня');
  }, 10_000);
});
