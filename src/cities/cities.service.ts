import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { CdekService } from '../cdek/cdek.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';
import { mergeUnifiedCities, type UnifiedCity } from './cities-merge';

export type { UnifiedCity };

@Injectable()
export class CitiesService {
  constructor(
    private readonly cdek: CdekService,
    private readonly yandex: YandexDeliveryService,
  ) {}

  async search(q: string, limit = 12): Promise<UnifiedCity[]> {
    const cdekReady = this.cdek.isConfigured();
    const yandexReady = this.yandex.isConfigured();

    if (!cdekReady && !yandexReady) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    const [cdekResult, yandexResult] = await Promise.allSettled([
      cdekReady ? this.cdek.suggestCities(q, limit) : Promise.resolve([]),
      yandexReady ? this.yandex.detectLocations(q, limit) : Promise.resolve([]),
    ]);

    const cdekCities =
      cdekResult.status === 'fulfilled' ? cdekResult.value : [];
    const yandexCities =
      yandexResult.status === 'fulfilled' ? yandexResult.value : [];

    const cdekFailed = cdekReady && cdekResult.status === 'rejected';
    const yandexFailed = yandexReady && yandexResult.status === 'rejected';
    const allConfiguredFailed =
      (!cdekReady || cdekFailed) && (!yandexReady || yandexFailed);

    if (!cdekCities.length && !yandexCities.length && allConfiguredFailed) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    return mergeUnifiedCities(cdekCities, yandexCities, limit);
  }
}
