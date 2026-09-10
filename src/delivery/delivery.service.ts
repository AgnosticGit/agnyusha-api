import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CdekService } from '../cdek/cdek.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';
import { PochtaService } from '../pochta/pochta.service';
import { OzonDeliveryService } from '../ozon-delivery/ozon-delivery.service';
import { mapDeliveryAvailability } from './delivery-availability';

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cdek: CdekService,
    private readonly yandex: YandexDeliveryService,
    private readonly pochta: PochtaService,
    private readonly ozonDelivery: OzonDeliveryService,
  ) {}

  list() {
    return this.prisma.deliveryMethod.findMany({
      where: { isActive: true },
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        code: true,
        title: true,
        description: true,
      },
    });
  }

  async forLocation(region?: string, label?: string) {
    const methods = await this.list();
    return mapDeliveryAvailability(methods, {
      region,
      label,
      cdekReady: this.cdek.isConfigured(),
      pochtaReady: this.pochta.isConfigured(),
      ozonReady: this.ozonDelivery.isOrderCreationConfigured(),
      yandexOrderReady: this.yandex.isOrderCreationConfigured(),
      yandexMoscowOnly: this.yandex.isTestEnvironment(),
    });
  }
}
