import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { YANDEX_FETCH, type YandexFetch } from './yandex.tokens';

type YandexDetectVariant = {
  geo_id: number;
  address: string;
};

type YandexPickupPoint = {
  id: string;
  name?: string;
  type?: string;
  address?:
    | string
    | {
        full_address?: string;
        postal_code?: string;
        locality?: string;
        region?: string;
        street?: string;
        house?: string;
      };
  position?: {
    latitude?: number;
    longitude?: number;
  };
  schedule?: {
    time_zone?: number;
    restrictions?: Array<{
      days?: number[];
      time_from?: { hours?: number; minutes?: number };
      time_to?: { hours?: number; minutes?: number };
    }>;
  };
  payment_methods?: string[];
};

const REGION_HINT =
  /область|край|республика|округ|Москва|Петербург|Севастополь/i;

function sanitizeSearchName(value: string) {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, 100);
}

function formatAddress(
  address: YandexPickupPoint['address'],
): { full: string; city: string; region: string; postalCode: string | null } {
  if (!address) {
    return { full: '', city: '', region: '', postalCode: null };
  }
  if (typeof address === 'string') {
    return { full: address, city: '', region: '', postalCode: null };
  }
  const full =
    address.full_address ||
    [address.street, address.house, address.locality, address.region]
      .filter(Boolean)
      .join(', ');
  return {
    full,
    city: address.locality || '',
    region: address.region || '',
    postalCode: address.postal_code || null,
  };
}

@Injectable()
export class YandexDeliveryService {
  private readonly logger = new Logger(YandexDeliveryService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(YANDEX_FETCH) private readonly fetchFn: YandexFetch,
  ) {}

  private get baseUrl() {
    return (
      this.config.get<string>('YANDEX_DELIVERY_API_URL')?.replace(/\/$/, '') ||
      'https://b2b.taxi.tst.yandex.net'
    );
  }

  private get token() {
    return this.config.get<string>('YANDEX_DELIVERY_TOKEN')?.trim() || '';
  }

  isConfigured() {
    return Boolean(this.token);
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }
  }

  private async yandexRequest<T>(
    path: string,
    init: { method?: string; body?: unknown } = {},
  ): Promise<T> {
    this.assertConfigured();

    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: init.method || 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
        ...(init.body
          ? { 'Content-Type': 'application/json' }
          : undefined),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    if (!res.ok) {
      this.logger.error(`Yandex ${path} failed with status ${res.status}`);
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    return (await res.json()) as T;
  }

  async detectLocations(name: string, limit = 12) {
    const query = sanitizeSearchName(name);
    if (query.length < 2) return [];

    const data = await this.yandexRequest<{
      variants?: YandexDetectVariant[];
    }>('/api/b2b/platform/location/detect', {
      method: 'POST',
      body: { location: query },
    });

    return (data.variants || []).slice(0, limit).map((row) => {
      const parts = row.address.split(',').map((p) => p.trim());
      const cityName = parts[0] || row.address;
      const region =
        parts.find((p) => REGION_HINT.test(p)) ||
        parts[parts.length - 1] ||
        '';

      return {
        geoId: row.geo_id,
        name: cityName,
        region,
        label: row.address,
      };
    });
  }

  async deliveryPoints(geoId: number, type = 'pickup_point') {
    if (!Number.isInteger(geoId) || geoId < 1) {
      return [];
    }

    const data = await this.yandexRequest<{
      points?: YandexPickupPoint[];
    }>('/api/b2b/platform/pickup-points/list', {
      method: 'POST',
      body: {
        geo_id: geoId,
        type,
      },
    });

    return (data.points || []).map((p) => {
      const address = formatAddress(p.address);
      const name = p.name || address.full || p.id;
      return {
        code: p.id,
        name,
        type: p.type || 'pickup_point',
        address: address.full,
        city: address.city,
        region: address.region,
        postalCode: address.postalCode,
        workTime: null as string | null,
        latitude: p.position?.latitude ?? null,
        longitude: p.position?.longitude ?? null,
        paymentMethods: p.payment_methods || [],
        label: [name, address.full].filter(Boolean).join(' — '),
      };
    });
  }
}
