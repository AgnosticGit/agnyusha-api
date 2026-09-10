import {
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
import { CDEK_FETCH, type CdekFetch } from './cdek.tokens';
import { CdekEntityNotFoundError } from './cdek.errors';

type TokenCache = {
  accessToken: string;
  expiresAt: number;
};

type CdekSuggestCity = {
  city_uuid?: string;
  code: number;
  full_name: string;
  country_code?: string;
};

type CdekDeliveryPoint = {
  code: string;
  name: string;
  status?: string;
  location?: {
    city?: string;
    region?: string;
    address?: string;
    postal_code?: string;
    latitude?: number;
    longitude?: number;
  };
  address?: string;
  work_time?: string;
  type?: string;
  have_cashless?: boolean;
  have_cash?: boolean;
  allowed_cod?: boolean;
  is_handout?: boolean;
  take_only?: boolean;
};

function mapSuggestCity(row: CdekSuggestCity) {
  const parts = row.full_name.split(',').map((p) => p.trim());
  const name = parts[0] || row.full_name;
  const region =
    parts.find((p) => REGION_HINT.test(p)) || parts[parts.length - 2] || '';

  return {
    code: row.code,
    name,
    region,
    countryCode: row.country_code || 'RU',
    uuid: row.city_uuid || null,
    label: row.full_name,
  };
}

@Injectable()
export class CdekService {
  private readonly logger = new Logger(CdekService.name);
  private tokenCache: TokenCache | null = null;

  constructor(
    private readonly config: ConfigService,
    @Inject(CDEK_FETCH) private readonly fetchFn: CdekFetch,
  ) {}

  private get baseUrl() {
    return (
      this.config.get<string>('CDEK_API_URL')?.replace(/\/$/, '') ||
      'https://api.edu.cdek.ru'
    );
  }

  private get clientId() {
    return this.config.get<string>('CDEK_CLIENT_ID')?.trim() || '';
  }

  private get clientSecret() {
    return this.config.get<string>('CDEK_CLIENT_SECRET')?.trim() || '';
  }

  isConfigured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  /** Test helper: drop cached OAuth token between cases. */
  clearTokenCache() {
    this.tokenCache = null;
  }

  /** Health probe: obtain (or refresh) OAuth token. */
  async ping(): Promise<void> {
    await this.getAccessToken(true);
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }
  }

  private async readErrorBody(res: Response): Promise<string> {
    return readErrorBody(res, 300);
  }

  private async getAccessToken(forceRefresh = false): Promise<string> {
    this.assertConfigured();

    if (
      !forceRefresh &&
      this.tokenCache &&
      Date.now() < this.tokenCache.expiresAt
    ) {
      return this.tokenCache.accessToken;
    }

    const body = new URLSearchParams({
      grant_type: 'client_credentials',
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    const res = await this.fetchFn(`${this.baseUrl}/v2/oauth/token`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        Accept: 'application/json',
      },
      body,
    });

    if (!res.ok) {
      const detail = await this.readErrorBody(res);
      this.logger.error(
        `CDEK auth failed with status ${res.status}${detail ? `: ${detail}` : ''}`,
      );
      this.tokenCache = null;
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
      error?: string;
      error_description?: string;
    };

    if (!data.access_token || !data.expires_in) {
      this.logger.error(
        `CDEK auth response missing token (${data.error ?? 'unknown'})`,
      );
      this.tokenCache = null;
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    this.tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };

    return data.access_token;
  }

  private async cdekGet<T>(
    path: string,
    query: Record<string, string | number | boolean | undefined>,
    retried = false,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const url = new URL(`${this.baseUrl}/v2${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== '') {
        url.searchParams.set(key, String(value));
      }
    }

    const res = await this.fetchFn(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
      },
    });

    if (res.status === 401 && !retried) {
      this.logger.warn(`CDEK ${path} returned 401 — refreshing token`);
      this.tokenCache = null;
      await this.getAccessToken(true);
      return this.cdekGet<T>(path, query, true);
    }

    if (!res.ok) {
      const detail = await this.readErrorBody(res);
      this.logger.error(
        `CDEK ${path} failed with status ${res.status}${detail ? `: ${detail}` : ''}`,
      );
      if (
        (res.status === 404 || detail.includes('v2_entity_not_found')) &&
        path.startsWith('/orders/')
      ) {
        const uuidMatch = path.match(/\/orders\/([^/?#]+)/);
        throw new CdekEntityNotFoundError(
          uuidMatch?.[1] ? decodeURIComponent(uuidMatch[1]) : path,
        );
      }
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    return (await res.json()) as T;
  }

  private async cdekPost<T>(
    path: string,
    body: unknown,
    retried = false,
  ): Promise<T> {
    const token = await this.getAccessToken();
    const res = await this.fetchFn(`${this.baseUrl}/v2${path}`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (res.status === 401 && !retried) {
      this.logger.warn(`CDEK ${path} returned 401 — refreshing token`);
      this.tokenCache = null;
      await this.getAccessToken(true);
      return this.cdekPost<T>(path, body, true);
    }

    if (!res.ok) {
      const detail = await this.readErrorBody(res);
      this.logger.error(
        `CDEK ${path} failed with status ${res.status}${detail ? `: ${detail}` : ''}`,
      );
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    return (await res.json()) as T;
  }

  private get fromLocation() {
    return this.config.get<string>('CDEK_FROM_LOCATION')?.trim() || '';
  }

  private get tariffCode() {
    const raw = this.config.get<string>('CDEK_TARIFF_CODE')?.trim();
    const n = raw ? Number(raw) : 136;
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 136;
  }

  isOrderCreationConfigured() {
    return this.isConfigured() && Boolean(this.fromLocation);
  }

  async createPickupOrder(input: {
    orderNumber: string;
    deliveryPointCode: string;
    phone: string;
    recipientName: string;
    comment?: string;
    items: Array<{
      name: string;
      wareKey: string;
      price: number;
      qty: number;
      weightGrams: number;
    }>;
  }): Promise<{ uuid: string; cdekNumber: string | null }> {
    this.assertConfigured();
    if (!this.fromLocation) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }
    const deliveryPoint = input.deliveryPointCode.trim();
    if (!deliveryPoint) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    const weight = Math.max(
      100,
      input.items.reduce((sum, i) => sum + i.weightGrams * i.qty, 0),
    );
    const phoneDigits = input.phone.replace(/\D/g, '');
    const phone =
      phoneDigits.length >= 10
        ? `+${phoneDigits.replace(/^8/, '7')}`
        : input.phone;

    const data = await this.cdekPost<{
      entity?: { uuid?: string; cdek_number?: string | number | null };
    }>('/orders', {
      type: 1,
      number: input.orderNumber.slice(0, 40),
      tariff_code: this.tariffCode,
      shipment_point: this.fromLocation,
      delivery_point: deliveryPoint,
      comment: input.comment?.slice(0, 255) || undefined,
      recipient: {
        name: input.recipientName.slice(0, 255) || 'Покупатель',
        phones: [{ number: phone }],
      },
      packages: [
        {
          number: '1',
          weight,
          items: input.items.map((item, idx) => ({
            name: item.name.slice(0, 255),
            ware_key: item.wareKey.slice(0, 50) || `item-${idx + 1}`,
            payment: { value: 0 },
            cost: Math.max(0, Number(item.price.toFixed(2))),
            weight: Math.max(1, item.weightGrams),
            amount: item.qty,
          })),
        },
      ],
    });

    const uuid = data.entity?.uuid?.trim();
    if (!uuid) {
      this.logger.error('CDEK create order response missing uuid');
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    const rawNumber = data.entity?.cdek_number;
    const cdekNumber =
      rawNumber == null || rawNumber === ''
        ? null
        : String(rawNumber).trim() || null;

    this.logger.log(
      `CDEK order created uuid=${uuid}` +
        (cdekNumber ? ` cdek_number=${cdekNumber}` : '') +
        ` api=${this.baseUrl} shipment_point=${this.fromLocation} delivery_point=${deliveryPoint}`,
    );

    return { uuid, cdekNumber };
  }

  async getOrder(uuid: string): Promise<{
    uuid: string;
    cdekNumber: string | null;
    statusCode: string | null;
    statusLabel: string | null;
  }> {
    this.assertConfigured();
    const id = uuid.trim();
    if (!id) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    const data = await this.cdekGet<{
      entity?: {
        uuid?: string;
        cdek_number?: string | number | null;
        statuses?: Array<{
          code?: string;
          name?: string;
        }>;
      };
    }>(`/orders/${encodeURIComponent(id)}`, {});

    const entity = data.entity;
    const statuses = Array.isArray(entity?.statuses) ? entity.statuses : [];
    const latest = statuses[0];
    const rawNumber = entity?.cdek_number;
    const cdekNumber =
      rawNumber == null || rawNumber === ''
        ? null
        : String(rawNumber).trim() || null;

    return {
      uuid: entity?.uuid?.trim() || id,
      cdekNumber,
      statusCode: latest?.code?.trim() || null,
      statusLabel: latest?.name?.trim() || null,
    };
  }

  async suggestCities(name: string, limit = 12) {
    const query = sanitizeSearchName(name);
    if (query.length < 2) return [];

    const rows = await this.cdekGet<CdekSuggestCity[]>(
      '/location/suggest/cities',
      {
        name: query,
        country_code: 'RU',
      },
    );

    return (Array.isArray(rows) ? rows : [])
      .filter((row) => Number.isFinite(row?.code) && row.full_name)
      .slice(0, limit)
      .map(mapSuggestCity);
  }

  async deliveryPoints(cityCode: number, type?: 'PVZ' | 'POSTAMAT') {
    if (!Number.isInteger(cityCode) || cityCode < 1) {
      return [];
    }

    const rows = await this.cdekGet<CdekDeliveryPoint[]>('/deliverypoints', {
      city_code: cityCode,
      type,
      country_code: 'RU',
    });

    return (Array.isArray(rows) ? rows : [])
      .filter((p) => {
        if (!p?.code || !p?.name) return false;
        if (p.status && p.status !== 'ACTIVE') return false;
        // Skip intake-only offices that cannot hand out parcels.
        if (p.take_only === true && p.is_handout === false) return false;
        return true;
      })
      .map((p) => ({
        code: p.code,
        name: p.name,
        type: p.type || 'PVZ',
        address: p.location?.address || p.address || '',
        city: p.location?.city || '',
        region: p.location?.region || '',
        postalCode: p.location?.postal_code || null,
        workTime: normalizeWorkTime(p.work_time),
        latitude: p.location?.latitude ?? null,
        longitude: p.location?.longitude ?? null,
        haveCash: Boolean(p.have_cash),
        haveCashless: Boolean(p.have_cashless),
        allowedCod: Boolean(p.allowed_cod),
        label: [p.name, p.location?.address || p.address]
          .filter(Boolean)
          .join(' — '),
      }));
  }
}

function normalizeWorkTime(value?: string | null) {
  if (!value) return null;
  const oneLine = value
    .replace(/[\r\n]+/g, ', ')
    .replace(/\s*;\s*/g, ', ')
    .replace(/\s*,\s*/g, ', ')
    .replace(/\s+/g, ' ')
    .trim();
  return oneLine || null;
}

export function cdekTrackingUrl(trackNumber: string) {
  return `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(trackNumber)}`;
}
