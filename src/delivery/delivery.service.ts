import { Injectable } from '@nestjs/common';
import { DeliveryMethodCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CdekService } from '../cdek/cdek.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';
import { PochtaService } from '../pochta/pochta.service';

function isLocalArea(...parts: Array<string | undefined>) {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  return (
    text.includes('санкт-петербург') ||
    text.includes('ленинградская') ||
    text.includes('петербург')
  );
}

function isMoscowArea(...parts: Array<string | undefined>) {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  return text.includes('москва') || text.includes('московская');
}

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cdek: CdekService,
    private readonly yandex: YandexDeliveryService,
    private readonly pochta: PochtaService,
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
    if (!region && !label) {
      return methods.map((m) => ({ ...m, available: false }));
    }

    const local = isLocalArea(region, label);
    const cdekReady = this.cdek.isConfigured();
    const pochtaReady = this.pochta.isConfigured();

    return methods.map((m) => {
      if (m.code === DeliveryMethodCode.PICKUP) {
        return {
          ...m,
          available: local,
          note: local
            ? 'Самовывоз из пункта в Ленинградской области'
            : 'Самовывоз доступен только для СПб и ЛО',
        };
      }
      if (m.code === DeliveryMethodCode.CDEK) {
        return {
          ...m,
          available: cdekReady,
          note: cdekReady
            ? 'Выберите пункт выдачи СДЭК'
            : 'СДЭК временно недоступен',
        };
      }
      if (m.code === DeliveryMethodCode.YANDEX) {
        const ready = this.yandex.isOrderCreationConfigured();
        const moscowOnly = this.yandex.isTestEnvironment();
        const available = ready && (!moscowOnly || isMoscowArea(region, label));
        return {
          ...m,
          available,
          note: !ready
            ? 'Яндекс Доставка временно недоступна'
            : moscowOnly && !isMoscowArea(region, label)
              ? 'В тестовой среде Яндекс доступен только для Москвы'
              : 'Выберите пункт выдачи Яндекс Доставки',
        };
      }
      if (m.code === DeliveryMethodCode.POST) {
        return {
          ...m,
          available: pochtaReady,
          note: pochtaReady
            ? 'Выберите отделение Почты России'
            : 'Почта России временно недоступна',
        };
      }
      return {
        ...m,
        available: true,
        note: 'Доставка по всей России',
      };
    });
  }
}
