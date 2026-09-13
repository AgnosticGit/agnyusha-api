import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CdekService } from '../cdek/cdek.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';
import { PochtaService } from '../pochta/pochta.service';
import { OzonDeliveryService } from '../ozon-delivery/ozon-delivery.service';
import { mapDeliveryAvailability } from './delivery-availability';
import {
  applyEtaToMethod,
  pickEtaForCode,
  type DeliveryEta,
  type DeliveryMethodWithEta,
} from './delivery-eta';

export type DeliveryMethodsQuery = {
  region?: string;
  label?: string;
  cdekCode?: number;
  yandexGeoId?: number;
  settlement?: string;
  weightGrams?: number;
};

@Injectable()
export class DeliveryService {
  private readonly logger = new Logger(DeliveryService.name);

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

  async forLocation(
    query: DeliveryMethodsQuery = {},
  ): Promise<DeliveryMethodWithEta[]> {
    const { region, label } = query;
    const methods = await this.list();
    const mapped = mapDeliveryAvailability(methods, {
      region,
      label,
      cdekReady: this.cdek.isConfigured(),
      pochtaReady: this.pochta.isConfigured(),
      ozonReady: this.ozonDelivery.isOrderCreationConfigured(),
      yandexOrderReady: this.yandex.isOrderCreationConfigured(),
      yandexMoscowOnly: this.yandex.isTestEnvironment(),
    });

    const weightGrams = Math.max(
      100,
      Math.min(Math.trunc(query.weightGrams ?? 1000) || 1000, 30_000),
    );
    const settlement =
      query.settlement?.trim() ||
      label?.split(',')[0]?.trim() ||
      undefined;

    const etas = await this.loadEtas({
      mapped,
      cdekCode: query.cdekCode,
      yandexGeoId: query.yandexGeoId,
      settlement,
      region,
      label,
      weightGrams,
    });

    return mapped.map((m) =>
      applyEtaToMethod(m, pickEtaForCode(m.code, etas)),
    );
  }

  private async loadEtas(input: {
    mapped: ReturnType<typeof mapDeliveryAvailability>;
    cdekCode?: number;
    yandexGeoId?: number;
    settlement?: string;
    region?: string;
    label?: string;
    weightGrams: number;
  }): Promise<{
    cdek: DeliveryEta | null;
    yandex: DeliveryEta | null;
    pochta: DeliveryEta | null;
  }> {
    const needCdek =
      Boolean(input.mapped.find((m) => m.code === 'CDEK')?.available) &&
      typeof input.cdekCode === 'number' &&
      input.cdekCode > 0;
    const needYandex =
      Boolean(input.mapped.find((m) => m.code === 'YANDEX')?.available) &&
      typeof input.yandexGeoId === 'number' &&
      input.yandexGeoId > 0;
    const needPochta =
      Boolean(input.mapped.find((m) => m.code === 'POST')?.available) &&
      Boolean(input.settlement && input.settlement.length >= 2);

    const yandexAddress =
      input.label?.trim() ||
      [input.settlement, input.region].filter(Boolean).join(', ') ||
      undefined;

    const [cdek, yandex, pochta] = await Promise.all([
      needCdek
        ? this.cdek.estimateDeliveryEta(input.cdekCode!, input.weightGrams)
        : Promise.resolve(null),
      needYandex
        ? this.yandex.estimateDeliveryEta(input.yandexGeoId!, {
            fullAddress: yandexAddress,
          })
        : Promise.resolve(null),
      needPochta
        ? this.pochta.estimateDeliveryEta({
            settlement: input.settlement,
            region: input.region,
            weightGrams: input.weightGrams,
          })
        : Promise.resolve(null),
    ]);

    if (needCdek || needYandex || needPochta) {
      this.logger.debug(
        `ETA loaded cdek=${cdek?.text ?? '-'} yandex=${yandex?.text ?? '-'} pochta=${pochta?.text ?? '-'}`,
      );
    }

    return { cdek, yandex, pochta };
  }
}
