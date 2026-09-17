import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CdekService } from '../cdek/cdek.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';
import { PochtaService } from '../pochta/pochta.service';
import { OzonDeliveryService } from '../ozon-delivery/ozon-delivery.service';
import { withTimeout } from '../common/http-utils';
import { mapDeliveryAvailability } from './delivery-availability';
import {
  applyEtaToMethod,
  pickEtaForCode,
  type DeliveryEta,
  type DeliveryMethodWithEta,
} from './delivery-eta';

/** Cap per-carrier ETA so one hung API cannot block checkout method list. */
export const DELIVERY_ETA_TIMEOUT_MS = 4_000;

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
  private activeMethodsCache: {
    value: Awaited<ReturnType<DeliveryService['listUncached']>>;
    expiresAt: number;
  } | null = null;
  private static readonly METHODS_CACHE_TTL_MS = 5_000;

  constructor(
    private readonly prisma: PrismaService,
    private readonly cdek: CdekService,
    private readonly yandex: YandexDeliveryService,
    private readonly pochta: PochtaService,
    private readonly ozonDelivery: OzonDeliveryService,
  ) {}

  private listUncached() {
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

  async list() {
    const cacheDisabled = process.env.NODE_ENV === 'test';
    const now = Date.now();
    if (
      !cacheDisabled &&
      this.activeMethodsCache &&
      this.activeMethodsCache.expiresAt > now
    ) {
      return this.activeMethodsCache.value;
    }
    const value = await this.listUncached();
    if (!cacheDisabled) {
      this.activeMethodsCache = {
        value,
        expiresAt: now + DeliveryService.METHODS_CACHE_TTL_MS,
      };
    }
    return value;
  }

  adminList() {
    return this.prisma.deliveryMethod.findMany({
      orderBy: { sortOrder: 'asc' },
      select: {
        id: true,
        code: true,
        title: true,
        description: true,
        sortOrder: true,
        isActive: true,
      },
    });
  }

  async updateActiveStates(
    updates: Array<{ id: string; isActive: boolean }>,
  ) {
    const ids = [...new Set(updates.map((u) => u.id.trim()).filter(Boolean))];
    if (!ids.length) return this.adminList();

    const existing = await this.prisma.deliveryMethod.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    if (existing.length !== ids.length) {
      throw new NotFoundException('Способ доставки не найден');
    }

    const byId = new Map(updates.map((u) => [u.id, Boolean(u.isActive)]));
    await this.prisma.$transaction(
      ids.map((id) =>
        this.prisma.deliveryMethod.update({
          where: { id },
          data: { isActive: byId.get(id) ?? true },
        }),
      ),
    );
    this.activeMethodsCache = null;
    return this.adminList();
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

    const etaOrNull = async (
      label: string,
      run: () => Promise<DeliveryEta | null>,
    ): Promise<DeliveryEta | null> => {
      try {
        return await withTimeout(run(), DELIVERY_ETA_TIMEOUT_MS, label);
      } catch (err) {
        this.logger.warn(
          `${label}: ${err instanceof Error ? err.message : String(err)}`,
        );
        return null;
      }
    };

    const [cdek, yandex, pochta] = await Promise.all([
      needCdek
        ? etaOrNull('CDEK ETA', () =>
            this.cdek.estimateDeliveryEta(input.cdekCode!, input.weightGrams),
          )
        : Promise.resolve(null),
      needYandex
        ? etaOrNull('Yandex ETA', () =>
            this.yandex.estimateDeliveryEta(input.yandexGeoId!, {
              fullAddress: yandexAddress,
            }),
          )
        : Promise.resolve(null),
      needPochta
        ? etaOrNull('Pochta ETA', () =>
            this.pochta.estimateDeliveryEta({
              settlement: input.settlement,
              region: input.region,
              weightGrams: input.weightGrams,
            }),
          )
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
