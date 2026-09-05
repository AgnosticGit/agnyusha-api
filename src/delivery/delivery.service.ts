import { Injectable } from '@nestjs/common';
import { DeliveryMethodCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CdekService } from '../cdek/cdek.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';

function isLocalArea(...parts: Array<string | undefined>) {
  const text = parts.filter(Boolean).join(' ').toLowerCase();
  return (
    text.includes('санкт-петербург') ||
    text.includes('ленинградская') ||
    text.includes('петербург')
  );
}

@Injectable()
export class DeliveryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cdek: CdekService,
    private readonly yandex: YandexDeliveryService,
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
    const yandexReady = this.yandex.isConfigured();

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
      if (m.code === DeliveryMethodCode.COURIER) {
        return {
          ...m,
          available: local,
          note: local
            ? 'Курьерская доставка по адресу'
            : 'Курьер доступен в СПб и ЛО',
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
        return {
          ...m,
          available: yandexReady,
          note: yandexReady
            ? 'Выберите пункт выдачи Яндекс Доставки'
            : 'Яндекс Доставка временно недоступна',
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
