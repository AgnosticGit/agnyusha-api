import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { readErrorBody, sanitizeSearchName } from '../common/http-utils';
import {
  OZON_DELIVERY_FETCH,
  type OzonDeliveryFetch,
} from './ozon-delivery.tokens';
import {
  extractCityFromAddress,
  formatOzonSchedule,
  moneyRub,
  normalizeOzonPhone,
  ozonTrackingUrl,
  packageDimensionsMm,
  positiveRequestId,
  settlementMatches,
} from './ozon-delivery.util';

type TokenCache = {
  accessToken: string;
  expiresAtMs: number;
};

type OzonPointRow = {
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
  label: string;
  shipmentMethodIds: number[];
};

type PointsIndex = {
  builtAt: number;
  points: OzonPointRow[];
};

const INDEX_TTL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_MAX_PAGES = 300;
const INFO_BATCH = 100;

@Injectable()
export class OzonDeliveryService {
  private readonly logger = new Logger(OzonDeliveryService.name);
  private tokenCache: TokenCache | null = null;
  private pointsIndex: PointsIndex | null = null;
  private indexPromise: Promise<PointsIndex> | null = null;
  private cookieJar = '';

  constructor(
    private readonly config: ConfigService,
    @Inject(OZON_DELIVERY_FETCH) private readonly fetchFn: OzonDeliveryFetch,
  ) {}

  private get baseUrl() {
    return (
      this.config.get<string>('OZON_DELIVERY_API_URL')?.replace(/\/$/, '') ||
      'https://api-delivery.ozon.ru'
    );
  }

  private get tokenUrl() {
    return (
      this.config.get<string>('OZON_DELIVERY_TOKEN_URL')?.trim() ||
      'https://xapi.ozon.ru/oauth/token'
    );
  }

  private get clientId() {
    return this.config.get<string>('OZON_DELIVERY_CLIENT_ID')?.trim() || '';
  }

  private get clientSecret() {
    return this.config.get<string>('OZON_DELIVERY_CLIENT_SECRET')?.trim() || '';
  }

  private get scopes(): string[] {
    const raw = this.config.get<string>('OZON_DELIVERY_SCOPES')?.trim();
    if (!raw) return ['delivery-api.all'];
    return raw
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }

  private get shipmentMethodId(): number | null {
    const raw = this.config.get<string>('OZON_DELIVERY_SHIPMENT_METHOD_ID')?.trim();
    if (!raw) return null;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : null;
  }

  private get indexMaxPages(): number {
    const raw = this.config.get<string>('OZON_DELIVERY_INDEX_MAX_PAGES')?.trim();
    const n = raw ? Number(raw) : DEFAULT_MAX_PAGES;
    return Number.isInteger(n) && n > 0 ? n : DEFAULT_MAX_PAGES;
  }

  isConfigured() {
    return Boolean(this.clientId && this.clientSecret);
  }

  isOrderCreationConfigured() {
    return this.isConfigured() && this.shipmentMethodId != null;
  }

  clearCaches() {
    this.tokenCache = null;
    this.pointsIndex = null;
    this.indexPromise = null;
    this.cookieJar = '';
  }

  /** Health probe: obtain OAuth token. */
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

  private async getAccessToken(forceRefresh = false): Promise<string> {
    this.assertConfigured();
    const now = Date.now();
    if (
      !forceRefresh &&
      this.tokenCache &&
      this.tokenCache.expiresAtMs - now > 60_000
    ) {
      return this.tokenCache.accessToken;
    }

    const res = await this.fetchFn(this.tokenUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        client_id: this.clientId,
        client_secret: this.clientSecret,
        grant_type: 'client_credentials',
        scope: this.scopes,
      }),
      redirect: 'manual',
    });

    if (!res.ok) {
      const detail = await readErrorBody(res);
      this.logger.error(
        `Ozon Delivery OAuth failed status=${res.status}${detail ? `: ${detail}` : ''}`,
      );
      this.tokenCache = null;
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    const data = (await res.json()) as {
      access_token?: string;
      expires_in?: number;
    };

    if (!data.access_token || typeof data.expires_in !== 'number') {
      this.logger.error('Ozon Delivery OAuth response missing token/expiry');
      this.tokenCache = null;
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    // Observed: expires_in is an absolute Unix timestamp (seconds).
    const expiresAtMs =
      data.expires_in > 1_000_000_000
        ? data.expires_in * 1000
        : Date.now() + data.expires_in * 1000;

    if (expiresAtMs - Date.now() <= 60_000) {
      this.logger.error('Ozon Delivery OAuth expiry is not usable');
      this.tokenCache = null;
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    this.tokenCache = {
      accessToken: data.access_token,
      expiresAtMs,
    };
    return data.access_token;
  }

  private absorbCookies(res: Response) {
    const getSetCookie = (
      res.headers as Headers & { getSetCookie?: () => string[] }
    ).getSetCookie;
    const raw =
      typeof getSetCookie === 'function'
        ? getSetCookie.call(res.headers)
        : (() => {
            const single = res.headers.get('set-cookie');
            return single ? [single] : [];
          })();
    if (!raw.length) return;
    const jar = new Map<string, string>();
    for (const part of this.cookieJar.split(';').map((s) => s.trim())) {
      if (!part) continue;
      const eq = part.indexOf('=');
      if (eq > 0) jar.set(part.slice(0, eq), part.slice(eq + 1));
    }
    for (const line of raw) {
      const first = line.split(';')[0]?.trim();
      if (!first) continue;
      const eq = first.indexOf('=');
      if (eq > 0) jar.set(first.slice(0, eq), first.slice(eq + 1));
    }
    this.cookieJar = [...jar.entries()]
      .map(([k, v]) => `${k}=${v}`)
      .join('; ');
  }

  private async apiPost<T>(
    path: string,
    payload: unknown,
    options?: { idempotencyKey?: string; retried?: boolean },
  ): Promise<T> {
    this.assertConfigured();
    const token = await this.getAccessToken();
    let url = `${this.baseUrl}${path.startsWith('/') ? path : `/${path}`}`;
    const headers: Record<string, string> = {
      Authorization: `Bearer ${token}`,
      Accept: 'application/json',
      'Content-Type': 'application/json',
    };
    if (options?.idempotencyKey) {
      headers['Idempotency-Key'] = options.idempotencyKey;
    }
    if (this.cookieJar) {
      headers.Cookie = this.cookieJar;
    }

    const body = JSON.stringify(payload);
    const seen = new Set<string>([url]);
    let redirects = 0;

    while (true) {
      const res = await this.fetchFn(url, {
        method: 'POST',
        headers,
        body,
        redirect: 'manual',
      });

      this.absorbCookies(res);
      if (this.cookieJar) headers.Cookie = this.cookieJar;

      if (res.status === 302 || res.status === 307) {
        const location = res.headers.get('location');
        if (!location) {
          throw new ServiceUnavailableException(
            'Служба доставки временно недоступна',
          );
        }
        const next = new URL(location, url).toString();
        const origin = new URL(this.baseUrl).origin;
        if (!next.startsWith(origin) || seen.has(next) || redirects >= 5) {
          this.logger.warn(`Ozon Delivery unsafe/loop redirect to ${next}`);
          throw new ServiceUnavailableException(
            'Служба доставки временно недоступна',
          );
        }
        seen.add(next);
        url = next;
        redirects += 1;
        continue;
      }

      if (res.status === 401 && !options?.retried) {
        this.tokenCache = null;
        return this.apiPost(path, payload, {
          ...options,
          retried: true,
        });
      }

      if (!res.ok) {
        const detail = await readErrorBody(res);
        this.logger.warn(
          `Ozon Delivery ${path} failed status=${res.status}${detail ? `: ${detail}` : ''}`,
        );
        throw new ServiceUnavailableException(
          'Служба доставки временно недоступна',
        );
      }

      return (await res.json()) as T;
    }
  }

  private async ensurePointsIndex(): Promise<PointsIndex> {
    const now = Date.now();
    if (this.pointsIndex && now - this.pointsIndex.builtAt < INDEX_TTL_MS) {
      return this.pointsIndex;
    }
    if (this.indexPromise) return this.indexPromise;

    this.indexPromise = this.buildPointsIndex()
      .then((index) => {
        this.pointsIndex = index;
        return index;
      })
      .finally(() => {
        this.indexPromise = null;
      });

    return this.indexPromise;
  }

  private async buildPointsIndex(): Promise<PointsIndex> {
    this.logger.log('Building Ozon Delivery PVZ index…');
    const methodId = this.shipmentMethodId;
    const points: OzonPointRow[] = [];
    let cursor: string | null = null;
    let pages = 0;

    while (pages < this.indexMaxPages) {
      const page = await this.apiPost<{
        delivery_points?: Array<{
          delivery_point_id?: number;
          shipment_method_ids?: number[] | number;
        }>;
        next_cursor?: string | null;
      }>('/v1/delivery-point/list', {
        pagination: { cursor, limit: INFO_BATCH },
      });

      const summaries = Array.isArray(page.delivery_points)
        ? page.delivery_points
        : [];
      const ids = summaries
        .map((row) => {
          const id = row.delivery_point_id;
          if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) {
            return null;
          }
          let methods = row.shipment_method_ids;
          if (typeof methods === 'number') methods = [methods];
          if (!Array.isArray(methods)) methods = [];
          if (
            methodId != null &&
            methods.length > 0 &&
            !methods.includes(methodId)
          ) {
            return null;
          }
          return { id, methods: methods.filter((m) => typeof m === 'number') };
        })
        .filter((row): row is { id: number; methods: number[] } => row != null);

      for (let i = 0; i < ids.length; i += INFO_BATCH) {
        const chunk = ids.slice(i, i + INFO_BATCH);
        if (!chunk.length) continue;
        const info = await this.apiPost<{
          delivery_points?: Array<{
            delivery_point_id?: number;
            name?: string;
            full_address?: string;
            type?: string;
            is_active?: boolean;
            coordinates?: { latitude?: number; longitude?: number };
            schedule?: unknown;
          }>;
        }>('/v1/delivery-point/info', {
          delivery_point_ids: chunk.map((c) => c.id),
        });

        const methodById = new Map<number, number[]>(
          chunk.map((c): [number, number[]] => [c.id, c.methods]),
        );
        for (const row of Array.isArray(info.delivery_points)
          ? info.delivery_points
          : []) {
          if (row.is_active === false) continue;
          const id = row.delivery_point_id;
          const name = row.name?.trim();
          const address = row.full_address?.trim();
          if (
            typeof id !== 'number' ||
            !name ||
            !address
          ) {
            continue;
          }
          const city = extractCityFromAddress(address);
          const lat =
            typeof row.coordinates?.latitude === 'number'
              ? row.coordinates.latitude
              : null;
          const lon =
            typeof row.coordinates?.longitude === 'number'
              ? row.coordinates.longitude
              : null;
          points.push({
            code: String(id),
            name,
            type: row.type || 'PVZ',
            address,
            city,
            region: '',
            postalCode: null,
            workTime: formatOzonSchedule(row.schedule),
            latitude: lat,
            longitude: lon,
            label: [name, address].filter(Boolean).join(' — '),
            shipmentMethodIds: methodById.get(id) ?? [],
          });
        }
      }

      pages += 1;
      const next = page.next_cursor;
      if (next == null || next === '') break;
      cursor = next;
    }

    this.logger.log(
      `Ozon Delivery PVZ index ready: ${points.length} points (${pages} pages)`,
    );
    return { builtAt: Date.now(), points };
  }

  async deliveryPoints(input: { settlement: string; region?: string }) {
    const settlement = sanitizeSearchName(input.settlement ?? '', 120);
    if (settlement.length < 2) return [];

    const index = await this.ensurePointsIndex();
    return index.points
      .filter((p) => settlementMatches(settlement, p.city, p.address))
      .slice(0, 80)
      .map(({ shipmentMethodIds: _m, ...point }) => point);
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
  }): Promise<{
    orderNumber: string;
    postingNumber: string | null;
    trackingUrl: string | null;
  }> {
    this.assertConfigured();
    const shipmentMethodId = this.shipmentMethodId;
    if (shipmentMethodId == null) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    const deliveryPointId = Number(String(input.deliveryPointCode).trim());
    if (!Number.isInteger(deliveryPointId) || deliveryPointId <= 0) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    const phone = normalizeOzonPhone(input.phone);
    if (!phone) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    const weight = Math.max(
      100,
      input.items.reduce((sum, i) => sum + i.weightGrams * i.qty, 0),
    );
    const dimensions = packageDimensionsMm(weight);
    const declared = moneyRub(
      input.items.reduce((sum, i) => sum + i.price * i.qty, 0),
    );
    const requestId = positiveRequestId(input.orderNumber);
    const description = (
      input.comment ||
      input.items.map((i) => i.name).join(', ') ||
      'Заказ Агнюша'
    ).slice(0, 500);

    const checkout = await this.apiPost<{
      results?: Array<{
        request_id?: number;
        posting?: { cutoff_at?: string | null };
        error?: unknown;
      }>;
    }>('/v1/order/checkout', {
      recipient: { phone_number: phone },
      postings: [
        {
          request_id: requestId,
          shipment_method_id: shipmentMethodId,
          cutoff_at: null,
          declared_value: declared,
          dimensions,
        },
      ],
      delivery: {
        delivery_point: { delivery_point_id: deliveryPointId },
      },
    });

    const checkoutRow = (checkout.results || []).find(
      (r) => r.request_id === requestId,
    );
    if (checkoutRow?.error) {
      this.logger.warn(
        `Ozon Delivery checkout rejected for point ${deliveryPointId}`,
      );
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }
    const cutoffAt = checkoutRow?.posting?.cutoff_at ?? null;

    const idempotencyKey = randomUUID();
    const created = await this.apiPost<{
      order_number?: string;
      postings?: Array<{
        posting_number?: string;
        request_id?: number;
      }>;
    }>(
      '/v1/order/create',
      {
        order_external_id: input.orderNumber.slice(0, 64),
        recipient: {
          phone_number: phone,
          full_name: input.recipientName.slice(0, 200) || 'Покупатель',
        },
        delivery: {
          delivery_point: { delivery_point_id: deliveryPointId },
        },
        postings: [
          {
            request_id: requestId,
            shipment_method_id: shipmentMethodId,
            cutoff_at: cutoffAt,
            declared_value: declared,
            dimensions,
            posting_external_id: input.orderNumber.slice(0, 64),
            description,
          },
        ],
      },
      { idempotencyKey },
    );

    const orderNumber = created.order_number?.trim();
    if (!orderNumber) {
      this.logger.error('Ozon Delivery create response missing order_number');
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    const postingNumber =
      created.postings?.find((p) => p.request_id === requestId)
        ?.posting_number ||
      created.postings?.[0]?.posting_number ||
      null;

    this.logger.log(
      `Ozon Delivery order created number=${orderNumber}` +
        (postingNumber ? ` posting=${postingNumber}` : ''),
    );

    return {
      orderNumber,
      postingNumber: postingNumber?.trim() || null,
      trackingUrl: ozonTrackingUrl(orderNumber),
    };
  }
}
