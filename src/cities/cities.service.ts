import {
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { CdekService } from '../cdek/cdek.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';

export type UnifiedCity = {
  id: string;
  name: string;
  region: string;
  label: string;
  cdekCode: number | null;
  yandexGeoId: number | null;
};

function normalizeKey(label: string) {
  return label.toLowerCase().replace(/\s+/g, ' ').trim();
}

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

    const byKey = new Map<string, UnifiedCity>();
    const byCdekCode = new Map<number, UnifiedCity>();
    const byYandexGeoId = new Map<number, UnifiedCity>();

    for (const city of cdekCities) {
      const existingByCode = byCdekCode.get(city.code);
      if (existingByCode) continue;

      const key = normalizeKey(city.label || city.name);
      const existing = byKey.get(key);
      if (existing) {
        existing.cdekCode = city.code;
        byCdekCode.set(city.code, existing);
        continue;
      }
      const row: UnifiedCity = {
        id: `cdek:${city.code}`,
        name: city.name,
        region: city.region,
        label: city.label,
        cdekCode: city.code,
        yandexGeoId: null,
      };
      byKey.set(key, row);
      byCdekCode.set(city.code, row);
    }

    for (const city of yandexCities) {
      const existingByGeo = byYandexGeoId.get(city.geoId);
      if (existingByGeo) continue;

      const key = normalizeKey(city.label || city.name);
      const existing = byKey.get(key);
      if (existing) {
        existing.yandexGeoId = city.geoId;
        if (!existing.id.startsWith('both:')) {
          existing.id = `both:${existing.cdekCode ?? 'x'}:${city.geoId}`;
        }
        byYandexGeoId.set(city.geoId, existing);
        continue;
      }
      const row: UnifiedCity = {
        id: `yandex:${city.geoId}`,
        name: city.name,
        region: city.region,
        label: city.label,
        cdekCode: null,
        yandexGeoId: city.geoId,
      };
      byKey.set(key, row);
      byYandexGeoId.set(city.geoId, row);
    }

    return Array.from(byKey.values()).slice(0, limit);
  }
}
