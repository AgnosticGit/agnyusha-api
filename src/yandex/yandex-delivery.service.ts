import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  REGION_HINT,
  readErrorBody,
  sanitizeSearchName,
} from '../common/http-utils';
import {
  etaFromIsoInterval,
  type DeliveryEta,
} from '../delivery/delivery-eta';
import { YANDEX_FETCH, type YandexFetch } from './yandex.tokens';
import {
  YandexEntityNotFoundError,
  isYandexRequestGone,
  yandexRequestIdFromPath,
} from './yandex.errors';

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

function formatAddress(address: YandexPickupPoint['address']): {
  full: string;
  city: string;
  region: string;
  postalCode: string | null;
} {
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

const YANDEX_DAY_SHORT = ['', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];

function formatClock(part?: { hours?: number; minutes?: number } | null) {
  if (part?.hours == null || !Number.isFinite(part.hours)) return null;
  const hours = Math.min(23, Math.max(0, Math.trunc(part.hours)));
  const minutes = Math.min(59, Math.max(0, Math.trunc(part.minutes ?? 0)));
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}

function formatDayRange(days: number[]) {
  const sorted = [
    ...new Set(days.filter((d) => Number.isInteger(d) && d >= 1 && d <= 7)),
  ].sort((a, b) => a - b);
  if (!sorted.length) return '';

  const ranges: string[] = [];
  let start = sorted[0];
  let prev = sorted[0];
  for (let i = 1; i <= sorted.length; i += 1) {
    const day = sorted[i];
    if (day === prev + 1) {
      prev = day;
      continue;
    }
    ranges.push(
      start === prev
        ? YANDEX_DAY_SHORT[start]
        : `${YANDEX_DAY_SHORT[start]}-${YANDEX_DAY_SHORT[prev]}`,
    );
    start = day;
    prev = day;
  }
  return ranges.join(', ');
}

/** Turn Yandex schedule.restrictions into a CDEK-like workTime string. */
export function formatYandexWorkTime(
  schedule?: YandexPickupPoint['schedule'],
): string | null {
  if (!schedule?.restrictions?.length) return null;

  const parts: string[] = [];
  for (const row of schedule.restrictions) {
    const days = (row.days || []).filter(
      (d): d is number => typeof d === 'number',
    );
    const dayLabel = formatDayRange(days);
    const from = formatClock(row.time_from);
    const to = formatClock(row.time_to);
    if (!dayLabel && !from) continue;
    if (from && to) {
      parts.push(dayLabel ? `${dayLabel} ${from}-${to}` : `${from}-${to}`);
    } else if (from) {
      parts.push(dayLabel ? `${dayLabel} с ${from}` : `с ${from}`);
    } else {
      parts.push(dayLabel);
    }
  }
  return parts.length ? parts.join(', ') : null;
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

/** offers/info may return ISO strings or unix seconds/ms. */
export function normalizeYandexTime(
  value: string | number | null | undefined,
): string | null {
  if (value == null || value === '') return null;
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value < 1e12 ? value * 1000 : value;
    return new Date(ms).toISOString();
  }
  const raw = String(value).trim();
  if (!raw) return null;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return null;
    const ms = n < 1e12 ? n * 1000 : n;
    return new Date(ms).toISOString();
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
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
    return this.config.get<string>('YANDEX_PLATFORM_STATION_ID')?.trim() || '';
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

  /** Health probe: light location detect call. */
  async ping(): Promise<void> {
    await this.detectLocations('Москва', 1);
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }
  }

  private async readErrorBody(res: Response): Promise<string> {
    return readErrorBody(res, 400);
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
      if (isYandexRequestGone(path, res.status, detail)) {
        throw new YandexEntityNotFoundError(yandexRequestIdFromPath(path));
      }
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
        parts.find((p) => REGION_HINT.test(p)) || parts[parts.length - 1] || '';

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
        workTime: formatYandexWorkTime(p.schedule),
        latitude: p.position?.latitude ?? null,
        longitude: p.position?.longitude ?? null,
        paymentMethods: p.payment_methods || [],
        label: [name, address.full].filter(Boolean).join(' — '),
      });
    }
    return points;
  }

  /**
   * Approximate ETA to a city via offers/info (address, then a few PVZ).
   * Failures return null — never throw to callers.
   */
  async estimateDeliveryEta(
    geoId: number,
    options?: { fullAddress?: string },
  ): Promise<DeliveryEta | null> {
    if (!this.isOrderCreationConfigured()) return null;
    if (!Number.isInteger(geoId) || geoId < 1) return null;

    try {
      const address = options?.fullAddress?.trim();
      if (address) {
        const byAddress = await this.fetchOffersInfoEta({
          full_address: address,
        });
        if (byAddress.eta) return byAddress.eta;
        // Warehouse has no pickup schedule — PVZ retries will fail the same way.
        if (byAddress.fatal) return null;
      }

      const points = await this.deliveryPoints(geoId);
      for (const point of points.slice(0, 8)) {
        const pickupId = point.code?.trim();
        if (!pickupId) continue;
        const byPvz = await this.fetchOffersInfoEta({
          self_pickup_id: pickupId,
          last_mile_policy: 'self_pickup',
        });
        if (byPvz.eta) return byPvz.eta;
        if (byPvz.fatal) return null;
      }
      return null;
    } catch (err) {
      this.logger.warn(
        `Yandex estimateDeliveryEta failed geoId=${geoId}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return null;
    }
  }

  private async fetchOffersInfoEta(query: {
    full_address?: string;
    self_pickup_id?: string;
    last_mile_policy?: string;
  }): Promise<{ eta: DeliveryEta | null; fatal: boolean }> {
    const params = new URLSearchParams({
      station_id: this.platformStationId,
    });
    if (query.full_address) params.set('full_address', query.full_address);
    if (query.self_pickup_id) {
      params.set('self_pickup_id', query.self_pickup_id);
    }
    if (query.last_mile_policy) {
      params.set('last_mile_policy', query.last_mile_policy);
    }

    const path = `/api/b2b/platform/offers/info?${params.toString()}`;
    const res = await this.fetchFn(`${this.baseUrl}${path}`, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${this.token}`,
        Accept: 'application/json',
      },
    });

    if (!res.ok) {
      const detail = await this.readErrorBody(res);
      this.logger.warn(
        `Yandex offers/info ${res.status}${detail ? `: ${detail}` : ''}`,
      );
      const fatal =
        detail.includes('pickups_not_configured') ||
        detail.includes('Pickups are not configured');
      return { eta: null, fatal };
    }

    const data = (await res.json()) as {
      offers?: Array<{
        from?: string | number;
        to?: string | number;
        delivery_interval?: {
          min?: string | number;
          max?: string | number;
          from?: string | number;
          to?: string | number;
        };
        offer_details?: {
          delivery_interval?: {
            min?: string | number;
            max?: string | number;
            from?: string | number;
            to?: string | number;
          };
        };
      }>;
    };

    const offers = data.offers || [];
    if (!offers.length) return { eta: null, fatal: false };

    // Use earliest and latest offer window as city ETA range.
    let minIso: string | null = null;
    let maxIso: string | null = null;
    for (const offer of offers) {
      const interval =
        offer.offer_details?.delivery_interval || offer.delivery_interval;
      const from = normalizeYandexTime(
        offer.from ?? interval?.min ?? interval?.from,
      );
      const to = normalizeYandexTime(
        offer.to ?? interval?.max ?? interval?.to,
      );
      if (from && (!minIso || from < minIso)) minIso = from;
      if (to && (!maxIso || to > maxIso)) maxIso = to;
      if (from && !to && (!maxIso || from > maxIso)) maxIso = from;
      if (to && !from && (!minIso || to < minIso)) minIso = to;
    }
    return { eta: etaFromIsoInterval(minIso, maxIso), fatal: false };
  }

  async getRequestInfo(requestId: string): Promise<{
    requestId: string;
    statusCode: string | null;
    statusLabel: string | null;
    sharingUrl: string | null;
  }> {
    this.assertConfigured();
    const id = requestId.trim();
    if (!id) {
      throw new BadRequestException('Не указан идентификатор доставки');
    }

    const data = await this.yandexRequest<{
      request_id?: string;
      state?: { status?: string; description?: string };
      sharing_url?: string;
    }>(`/api/b2b/platform/request/info?request_id=${encodeURIComponent(id)}`, {
      method: 'GET',
    });

    return {
      requestId: data.request_id?.trim() || id,
      statusCode: data.state?.status?.trim() || null,
      statusLabel: data.state?.description?.trim() || null,
      sharingUrl: data.sharing_url?.trim() || null,
    };
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
