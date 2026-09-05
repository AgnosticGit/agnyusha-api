import {
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CDEK_FETCH, type CdekFetch } from './cdek.tokens';

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

  private assertConfigured() {
    if (!this.isConfigured()) {
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }
  }

  private async getAccessToken(): Promise<string> {
    this.assertConfigured();

    if (this.tokenCache && Date.now() < this.tokenCache.expiresAt) {
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
      this.logger.error(`CDEK auth failed with status ${res.status}`);
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    const data = (await res.json()) as {
      access_token: string;
      expires_in: number;
    };

    this.tokenCache = {
      accessToken: data.access_token,
      expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };

    return data.access_token;
  }

  private async cdekGet<T>(
    path: string,
    query: Record<string, string | number | undefined>,
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

    if (!res.ok) {
      this.logger.error(`CDEK ${path} failed with status ${res.status}`);
      throw new ServiceUnavailableException(
        'Служба доставки временно недоступна',
      );
    }

    return (await res.json()) as T;
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

    return (Array.isArray(rows) ? rows : []).map((p) => ({
      code: p.code,
      name: p.name,
      type: p.type || 'PVZ',
      address: p.location?.address || p.address || '',
      city: p.location?.city || '',
      region: p.location?.region || '',
      postalCode: p.location?.postal_code || null,
      workTime: p.work_time || null,
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
