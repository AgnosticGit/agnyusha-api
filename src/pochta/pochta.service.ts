import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { readErrorBody, sanitizeSearchName } from '../common/http-utils';
import { PochtaEntityNotFoundError } from './pochta.errors';
import { pochtaTelAddress } from './pochta-phone.util';
import { POCHTA_FETCH, type PochtaFetch } from './pochta.tokens';

type PochtaOfficeSchedule = {
  'weekday-id'?: number;
  'begin-worktime'?: string;
  'end-worktime'?: string;
};

type PochtaPostOffice = {
  'postal-code'?: string;
  'address-source'?: string;
  settlement?: string;
  region?: string;
  district?: string;
  latitude?: number;
  longitude?: number;
  'is-closed'?: boolean;
  'is-temporary-closed'?: boolean;
  'type-code'?: string;
  'working-hours'?: PochtaOfficeSchedule[];
};

type PochtaBacklogCreateResponse = {
  'result-ids'?: Array<number | string>;
  orders?: Array<{
    'result-id'?: number | string;
    barcode?: string | null;
  }>;
  errors?: unknown[];
};

type PochtaOrderInfo = {
  id?: number | string;
  barcode?: string | null;
  'is-deleted'?: boolean;
  'order-num'?: string;
};

const WEEKDAY_SHORT = ['Вс', 'Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб'] as const;
const MAX_SETTLEMENT_OFFICES = 40;
const OFFICE_FETCH_CONCURRENCY = 6;

function pochtaTrackingUrl(barcode: string) {
  return `https://www.pochta.ru/tracking#${encodeURIComponent(barcode)}`;
}

@Injectable()
export class PochtaService {
  private readonly logger = new Logger(PochtaService.name);

  constructor(
    private readonly config: ConfigService,
    @Inject(POCHTA_FETCH) private readonly fetchFn: PochtaFetch,
  ) {}

  private get baseUrl() {
    return (
      this.config.get<string>('POCHTA_API_URL')?.replace(/\/$/, '') ||
      'https://otpravka-api.pochta.ru'
    );
  }

  private get accessToken() {
    return this.config.get<string>('POCHTA_ACCESS_TOKEN')?.trim() || '';
  }

  private get authorizationKey() {
    const raw =
      this.config.get<string>('POCHTA_AUTHORIZATION_KEY')?.trim() || '';
    if (!raw) return '';
    return raw.replace(/^Basic\s+/i, '').trim();
  }

  private get fromIndex() {
    return this.config.get<string>('POCHTA_FROM_INDEX')?.trim() || '';
  }

  private get mailType() {
    return (
      this.config.get<string>('POCHTA_MAIL_TYPE')?.trim() || 'ONLINE_PARCEL'
    );
  }

  private get mailCategory() {
    return (
      this.config.get<string>('POCHTA_MAIL_CATEGORY')?.trim() || 'ORDINARY'
    );
  }

  isConfigured() {
    return Boolean(this.accessToken && this.authorizationKey);
  }

  isOrderCreationConfigured() {
    return this.isConfigured() && Boolean(this.fromIndex);
  }

  /** Health probe: fetch sender OPS by index. */
  async ping(): Promise<void> {
    this.assertConfigured();
    const index = this.fromIndex || '101000';
    await this.getPostOffice(index);
  }

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }
  }

  private authHeaders(): Record<string, string> {
    return {
      Authorization: `AccessToken ${this.accessToken}`,
      'X-User-Authorization': `Basic ${this.authorizationKey}`,
      Accept: 'application/json',
      'Content-Type': 'application/json;charset=UTF-8',
    };
  }

  private async request<T>(
    method: string,
    path: string,
    options?: { query?: Record<string, string | number | undefined>; body?: unknown },
  ): Promise<T> {
    this.assertConfigured();
    const url = new URL(
      path.startsWith('http') ? path : `${this.baseUrl}/${path.replace(/^\//, '')}`,
    );
    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined || value === '') continue;
        url.searchParams.set(key, String(value));
      }
    }

    const res = await this.fetchFn(url.toString(), {
      method,
      headers: this.authHeaders(),
      body:
        options?.body === undefined ? undefined : JSON.stringify(options.body),
    });

    if (!res.ok) {
      const detail = await readErrorBody(res);
      if (res.status === 404) {
        throw new PochtaEntityNotFoundError(path);
      }
      this.logger.warn(
        `Pochta ${method} ${path} failed status=${res.status} body=${detail}`,
      );
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    if (res.status === 204) {
      return undefined as T;
    }

    const text = await res.text();
    if (!text.trim()) {
      return undefined as T;
    }

    try {
      return JSON.parse(text) as T;
    } catch {
      this.logger.warn(`Pochta ${method} ${path}: invalid JSON`);
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }
  }

  async getPostOffice(postalCode: string): Promise<PochtaPostOffice | null> {
    const code = postalCode.trim();
    if (!/^\d{5,6}$/.test(code)) return null;
    try {
      return await this.request<PochtaPostOffice>(
        'GET',
        `postoffice/1.0/${encodeURIComponent(code)}`,
      );
    } catch (err) {
      if (err instanceof PochtaEntityNotFoundError) return null;
      throw err;
    }
  }

  async deliveryPoints(input: {
    lat?: number;
    lon?: number;
    settlement?: string;
    region?: string;
  }) {
    const lat = input.lat;
    const lon = input.lon;
    const settlement = sanitizeSearchName(input.settlement ?? '', 120);
    const region = sanitizeSearchName(input.region ?? '', 120);

    let offices: PochtaPostOffice[] = [];

    if (
      typeof lat === 'number' &&
      Number.isFinite(lat) &&
      typeof lon === 'number' &&
      Number.isFinite(lon)
    ) {
      const nearby = await this.request<PochtaPostOffice[]>(
        'GET',
        'postoffice/1.0/nearby',
        {
          query: {
            latitude: lat,
            longitude: lon,
            top: 30,
          },
        },
      );
      offices = Array.isArray(nearby) ? nearby : [];
    } else if (settlement.length >= 2) {
      const codes = await this.request<string[]>(
        'GET',
        'postoffice/1.0/settlement.offices.codes',
        {
          query: {
            settlement,
            region: region || undefined,
          },
        },
      );
      const indexes = (Array.isArray(codes) ? codes : [])
        .map((c) => String(c).trim())
        .filter((c) => /^\d{5,6}$/.test(c))
        .slice(0, MAX_SETTLEMENT_OFFICES);

      offices = await this.fetchOfficesConcurrent(indexes);
    } else {
      return [];
    }

    return offices
      .filter((o) => {
        const code = o?.['postal-code']?.trim();
        if (!code) return false;
        if (o['is-closed'] || o['is-temporary-closed']) return false;
        return true;
      })
      .map((o) => this.mapOffice(o));
  }

  private async fetchOfficesConcurrent(
    indexes: string[],
  ): Promise<PochtaPostOffice[]> {
    const out: PochtaPostOffice[] = [];
    for (let i = 0; i < indexes.length; i += OFFICE_FETCH_CONCURRENCY) {
      const chunk = indexes.slice(i, i + OFFICE_FETCH_CONCURRENCY);
      const rows = await Promise.all(
        chunk.map(async (code) => {
          try {
            return await this.getPostOffice(code);
          } catch {
            return null;
          }
        }),
      );
      for (const row of rows) {
        if (row) out.push(row);
      }
    }
    return out;
  }

  private mapOffice(o: PochtaPostOffice) {
    const code = String(o['postal-code'] || '').trim();
    const address = (o['address-source'] || '').trim();
    const city = (o.settlement || '').trim();
    const region = (o.region || '').trim();
    const name = `ОПС ${code}`;
    const workTime = formatWorkingHours(o['working-hours']);
    return {
      code,
      name,
      type: o['type-code'] || 'OPS',
      address,
      city,
      region,
      postalCode: code,
      workTime,
      latitude:
        typeof o.latitude === 'number' && Number.isFinite(o.latitude)
          ? o.latitude
          : null,
      longitude:
        typeof o.longitude === 'number' && Number.isFinite(o.longitude)
          ? o.longitude
          : null,
      haveCash: true,
      haveCashless: true,
      allowedCod: false,
      label: [name, address].filter(Boolean).join(' — '),
    };
  }

  async createPickupOrder(input: {
    orderNumber: string;
    deliveryPointCode: string;
    phone: string;
    recipientName: string;
    lastName?: string;
    firstName?: string;
    comment?: string;
    cityLabel?: string;
    items: Array<{
      name: string;
      wareKey: string;
      price: number;
      qty: number;
      weightGrams: number;
    }>;
  }): Promise<{ orderId: string; barcode: string | null }> {
    this.assertConfigured();
    if (!this.fromIndex) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    const indexTo = input.deliveryPointCode.trim();
    if (!/^\d{5,6}$/.test(indexTo)) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    const office = await this.getPostOffice(indexTo);
    if (!office) {
      this.logger.error(`Pochta OPS not found for index=${indexTo}`);
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    const mass = Math.max(
      100,
      input.items.reduce((sum, i) => sum + i.weightGrams * i.qty, 0),
    );
    const phone = pochtaTelAddress(input.phone);
    if (phone == null) {
      throw new BadRequestException('Укажите корректный телефон получателя');
    }

    const surname =
      input.lastName?.trim() ||
      input.recipientName.trim().split(/\s+/)[0] ||
      'Покупатель';
    const givenName =
      input.firstName?.trim() ||
      input.recipientName.trim().split(/\s+/)[1] ||
      '';

    const placeTo =
      office.settlement?.trim() ||
      parseCityFromLabel(input.cityLabel) ||
      'Россия';
    const regionTo = office.region?.trim() || placeTo;
    const addressSource = (office['address-source'] || '').trim();

    // ISO 3166-1 numeric country code — required by Otpravka (643 = Russia).
    const mailDirect = Number(
      this.config.get<string>('POCHTA_MAIL_DIRECT')?.trim() || '643',
    );

    const backlogBody = [
      {
        'address-type-to': 'DEFAULT',
        'mail-category': this.mailCategory,
        'mail-type': this.mailType,
        'mail-direct': Number.isFinite(mailDirect) ? mailDirect : 643,
        mass,
        'order-num': input.orderNumber.slice(0, 20),
        'index-to': Number(indexTo),
        'place-to': placeTo.slice(0, 100),
        'region-to': regionTo.slice(0, 100),
        'raw-address': addressSource.slice(0, 250) || undefined,
        'recipient-name': input.recipientName.slice(0, 120) || 'Покупатель',
        surname: surname.slice(0, 50),
        'given-name': givenName.slice(0, 50) || undefined,
        'tel-address': phone,
        'postoffice-code': this.fromIndex,
        comment: input.comment?.slice(0, 255) || undefined,
      },
    ];

    const created = await this.request<PochtaBacklogCreateResponse>(
      'PUT',
      '1.0/user/backlog',
      { body: backlogBody },
    );

    const orderIdRaw =
      created?.['result-ids']?.[0] ?? created?.orders?.[0]?.['result-id'];
    const orderId =
      orderIdRaw == null || orderIdRaw === ''
        ? ''
        : String(orderIdRaw).trim();
    if (!orderId) {
      const errors = (created as { errors?: unknown } | undefined)?.errors;
      this.logger.error(
        `Pochta backlog create missing result-id` +
          (errors ? ` errors=${JSON.stringify(errors)}` : ''),
      );
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    await this.request<unknown>('POST', '1.0/user/shipment', {
      body: [Number(orderId)],
    });

    let barcode: string | null =
      created?.orders?.[0]?.barcode?.trim() || null;
    try {
      const shipped = await this.request<PochtaOrderInfo>(
        'GET',
        `1.0/shipment/${encodeURIComponent(orderId)}`,
      );
      barcode = shipped?.barcode?.trim() || barcode;
    } catch (err) {
      if (!(err instanceof PochtaEntityNotFoundError)) {
        this.logger.warn(
          `Pochta shipment fetch after batch failed id=${orderId}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }

    this.logger.log(
      `Pochta order created id=${orderId}` +
        (barcode ? ` barcode=${barcode}` : '') +
        ` index-to=${indexTo} from=${this.fromIndex}`,
    );

    return { orderId, barcode };
  }

  async getOrder(orderId: string): Promise<{
    orderId: string;
    barcode: string | null;
    statusCode: string | null;
    statusLabel: string | null;
  }> {
    this.assertConfigured();
    const id = orderId.trim();
    if (!id) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    let info: PochtaOrderInfo | null = null;
    let statusCode: string | null = null;
    let statusLabel: string | null = null;

    try {
      info = await this.request<PochtaOrderInfo>(
        'GET',
        `1.0/shipment/${encodeURIComponent(id)}`,
      );
      statusCode = 'SHIPMENT';
      statusLabel = 'В партии';
    } catch (err) {
      if (!(err instanceof PochtaEntityNotFoundError)) throw err;
      try {
        info = await this.request<PochtaOrderInfo>(
          'GET',
          `1.0/backlog/${encodeURIComponent(id)}`,
        );
        statusCode = 'BACKLOG';
        statusLabel = 'Новый';
      } catch (backlogErr) {
        if (backlogErr instanceof PochtaEntityNotFoundError) {
          throw new PochtaEntityNotFoundError(id);
        }
        throw backlogErr;
      }
    }

    if (info?.['is-deleted']) {
      throw new PochtaEntityNotFoundError(id);
    }

    const barcode = info?.barcode?.trim() || null;
    return {
      orderId: String(info?.id ?? id),
      barcode,
      statusCode,
      statusLabel,
    };
  }

  async searchByBarcode(barcode: string): Promise<{
    orderId: string | null;
    barcode: string | null;
    statusCode: string | null;
    statusLabel: string | null;
  }> {
    this.assertConfigured();
    const query = barcode.trim();
    if (!query) {
      return {
        orderId: null,
        barcode: null,
        statusCode: null,
        statusLabel: null,
      };
    }

    const rows = await this.request<PochtaOrderInfo[]>(
      'GET',
      '1.0/shipment/search',
      { query: { query } },
    );
    const first = Array.isArray(rows) ? rows[0] : null;
    if (!first) {
      throw new PochtaEntityNotFoundError(query);
    }
    if (first['is-deleted']) {
      throw new PochtaEntityNotFoundError(query);
    }

    return {
      orderId: first.id == null ? null : String(first.id),
      barcode: first.barcode?.trim() || query,
      statusCode: 'SHIPMENT',
      statusLabel: 'В партии',
    };
  }
}

export { pochtaTrackingUrl };

function formatWorkingHours(
  hours?: PochtaOfficeSchedule[] | null,
): string | null {
  if (!Array.isArray(hours) || !hours.length) return null;
  const parts = hours
    .map((h) => {
      const day =
        typeof h['weekday-id'] === 'number'
          ? WEEKDAY_SHORT[h['weekday-id'] % 7] || ''
          : '';
      const begin = formatTime(h['begin-worktime']);
      const end = formatTime(h['end-worktime']);
      if (!day || !begin || !end) return null;
      return `${day} ${begin}-${end}`;
    })
    .filter(Boolean);
  return parts.length ? parts.join(', ') : null;
}

function formatTime(value?: string | null) {
  if (!value) return null;
  // API may return ISO or HH:mm:ss
  const match = value.match(/(\d{2}):(\d{2})/);
  return match ? `${match[1]}:${match[2]}` : value.trim() || null;
}

function parseCityFromLabel(label?: string) {
  if (!label) return '';
  return label.split(',')[0]?.trim() || '';
}
