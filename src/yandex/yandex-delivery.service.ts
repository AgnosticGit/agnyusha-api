import {
  BadRequestException,
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

type YandexOffer = {
  offer_id: string;
  expires_at?: string;
  offer_details?: {
    pricing?: string;
    pricing_total?: string;
    delivery_interval?: { min?: string; max?: string; policy?: string };
  };
};

export type YandexCreatePickupOrderInput = {
  requestId: string;
  pickupPointId: string;
  phone: string;
  recipientName: string;
  comment?: string;
  items: Array<{
    name: string;
    article: string;
    price: number;
    qty: number;
    weightGrams: number;
  }>;
};

export type YandexCreatePickupOrderResult = {
  requestId: string;
  offerId: string;
  pricingTotal: string | null;
  deliveryFrom: string | null;
  deliveryTo: string | null;
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

function normalizeRuPhone(phone: string): string {
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 11 && digits.startsWith('8')) {
    return `7${digits.slice(1)}`;
  }
  if (digits.length === 11 && digits.startsWith('7')) return digits;
  if (digits.length === 10) return `7${digits}`;
  return digits;
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

  private get platformStationId() {
    return (
      this.config.get<string>('YANDEX_PLATFORM_STATION_ID')?.trim() || ''
    );
  }

  isConfigured() {
    return Boolean(this.token);
  }

  isOrderCreationConfigured() {
    return Boolean(this.token && this.platformStationId);
  }

  /** Test host only supports Moscow addresses. */
  isTestEnvironment() {
    return this.baseUrl.includes('tst.yandex.net');
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }
  }

  private async readErrorBody(res: Response): Promise<string> {
    try {
      const text = await res.text();
      return text.slice(0, 400);
    } catch {
      return '';
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
        ...(init.body ? { 'Content-Type': 'application/json' } : undefined),
      },
      body: init.body ? JSON.stringify(init.body) : undefined,
    });

    if (!res.ok) {
      const detail = await this.readErrorBody(res);
      this.logger.error(
        `Yandex ${path} failed with status ${res.status}${detail ? `: ${detail}` : ''}`,
      );
      if (res.status >= 400 && res.status < 500) {
        throw new BadRequestException(
          'Не удалось оформить доставку Яндекс. Проверьте город и пункт выдачи.',
        );
      }
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

    const seen = new Set<string>();
    const points: Array<{
      code: string;
      name: string;
      type: string;
      address: string;
      city: string;
      region: string;
      postalCode: string | null;
      workTime: string | null;
      latitude: number | null;
      longitude: number | null;
      paymentMethods: string[];
      label: string;
    }> = [];
    for (const p of data.points || []) {
      if (!p.id || seen.has(p.id)) continue;
      seen.add(p.id);
      const address = formatAddress(p.address);
      const name = p.name || address.full || p.id;
      points.push({
        code: p.id,
        name,
        type: p.type || 'pickup_point',
        address: address.full,
        city: address.city,
        region: address.region,
        postalCode: address.postalCode,
        workTime: null,
        latitude: p.position?.latitude ?? null,
        longitude: p.position?.longitude ?? null,
        paymentMethods: p.payment_methods || [],
        label: [name, address.full].filter(Boolean).join(' — '),
      });
    }
    return points;
  }

  async createPickupOrder(
    input: YandexCreatePickupOrderInput,
  ): Promise<YandexCreatePickupOrderResult> {
    if (!this.isOrderCreationConfigured()) {
      throw new ServiceUnavailableException(
        'Оформление через Яндекс Доставку временно недоступно',
      );
    }

    const pickupPointId = input.pickupPointId.trim();
    if (!pickupPointId) {
      throw new BadRequestException('Не выбран пункт выдачи Яндекс');
    }

    const phone = normalizeRuPhone(input.phone);
    if (phone.length < 11) {
      throw new BadRequestException('Укажите корректный телефон получателя');
    }

    const totalWeight = Math.max(
      100,
      input.items.reduce((s, i) => s + i.weightGrams * i.qty, 0),
    );
    const barcode = `BOX-${input.requestId}`.slice(0, 40);

    const offerBody = {
      info: {
        operator_request_id: input.requestId.slice(0, 64),
        comment: (input.comment || 'Заказ Агнюша').slice(0, 200),
      },
      source: {
        platform_station: {
          platform_id: this.platformStationId,
        },
      },
      destination: {
        type: 'platform_station',
        platform_station: {
          platform_id: pickupPointId,
        },
      },
      last_mile_policy: 'self_pickup',
      items: input.items.map((item, index) => ({
        count: item.qty,
        name: item.name.slice(0, 128),
        article: (item.article || `SKU-${index + 1}`).slice(0, 64),
        billing_details: {
          unit_price: item.price,
          assessed_unit_price: item.price,
        },
        physical_dims: {
          dx: 20,
          dy: 15,
          dz: 10,
          weight_gross: Math.max(100, item.weightGrams),
        },
        place_barcode: barcode,
      })),
      places: [
        {
          physical_dims: {
            dx: 20,
            dy: 15,
            dz: 10,
            weight_gross: totalWeight,
          },
          barcode,
          description: 'Коробка с кормом Агнюша',
        },
      ],
      billing_info: {
        payment_method: 'already_paid',
      },
      recipient_info: {
        first_name: (input.recipientName || 'Покупатель').slice(0, 64),
        phone,
      },
    };

    const offersResponse = await this.yandexRequest<{ offers?: YandexOffer[] }>(
      '/api/b2b/platform/offers/create',
      { method: 'POST', body: offerBody },
    );

    const offer = offersResponse.offers?.[0];
    if (!offer?.offer_id) {
      throw new ServiceUnavailableException(
        'Яндекс Доставка не вернула доступный тариф',
      );
    }

    const confirmed = await this.yandexRequest<{ request_id?: string }>(
      '/api/b2b/platform/offers/confirm',
      { method: 'POST', body: { offer_id: offer.offer_id } },
    );

    if (!confirmed.request_id) {
      throw new ServiceUnavailableException(
        'Не удалось подтвердить заявку Яндекс Доставки',
      );
    }

    return {
      requestId: confirmed.request_id,
      offerId: offer.offer_id,
      pricingTotal: offer.offer_details?.pricing_total ?? null,
      deliveryFrom: offer.offer_details?.delivery_interval?.min ?? null,
      deliveryTo: offer.offer_details?.delivery_interval?.max ?? null,
    };
  }
}
