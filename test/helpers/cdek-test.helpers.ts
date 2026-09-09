import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { AppModule } from '../../src/app.module';
import { CDEK_FETCH, type CdekFetch } from '../../src/cdek/cdek.tokens';
import { CdekService } from '../../src/cdek/cdek.service';
import { YANDEX_FETCH, type YandexFetch } from '../../src/yandex/yandex.tokens';
import { MAIL_SEND, type MailSend } from '../../src/mail/mail.tokens';
import { GOOGLE_FETCH, type GoogleFetch } from '../../src/auth/google.tokens';
import { PrismaService } from '../../src/prisma/prisma.service';
import { DeliveryMethodCode } from '@prisma/client';
import { createOriginGuard } from '../../src/common/origin.guard';

export type MockHttpCall = {
  url: string;
  method: string;
};

export function applyTestDeliveryEnv(options?: {
  cdek?: 'present' | 'missing';
  yandex?: 'present' | 'missing';
  google?: 'present' | 'missing';
  ozon?: 'present' | 'missing';
  ozonNotificationSecret?: string;
}) {
  const cdek = options?.cdek ?? 'present';
  const yandex = options?.yandex ?? 'missing';
  const google = options?.google ?? 'missing';
  const ozon = options?.ozon ?? 'missing';

  process.env.NODE_ENV = 'test';
  process.env.DATABASE_URL =
    process.env.DATABASE_URL ||
    'postgresql://agnyusha:agnyusha@localhost:5433/agnyusha?schema=public';
  process.env.CORS_ORIGIN = 'http://localhost:3000';
  process.env.CDEK_API_URL = 'https://api.edu.cdek.ru';
  process.env.YANDEX_DELIVERY_API_URL = 'https://b2b.taxi.tst.yandex.net';
  process.env.MAIL_DRIVER = 'resend';
  process.env.MAIL_FROM = 'Агнюша <onboarding@resend.dev>';
  process.env.RESEND_API_KEY = '';
  process.env.MAGIC_LINK_EXPIRES_MINUTES = '15';
  process.env.INVENTORY_ENABLED = 'false';
  process.env.PUBLIC_WEB_URL = 'http://localhost:3000';
  // Force empty unless a test opts in — otherwise local .env secrets leak into e2e.
  process.env.OZON_PAY_NOTIFICATION_SECRET =
    options?.ozonNotificationSecret ?? '';

  if (ozon === 'present') {
    process.env.OZON_PAY_ACCESS_KEY =
      process.env.OZON_PAY_ACCESS_KEY || 'test-access-key';
  } else {
    process.env.OZON_PAY_ACCESS_KEY = '';
  }

  if (cdek === 'present') {
    process.env.CDEK_CLIENT_ID = 'test-client-id';
    process.env.CDEK_CLIENT_SECRET = 'test-client-secret';
    process.env.CDEK_FROM_LOCATION = process.env.CDEK_FROM_LOCATION || 'MSK1';
    process.env.CDEK_TARIFF_CODE = process.env.CDEK_TARIFF_CODE || '136';
  } else {
    process.env.CDEK_CLIENT_ID = '';
    process.env.CDEK_CLIENT_SECRET = '';
    process.env.CDEK_FROM_LOCATION = '';
  }

  if (yandex === 'present') {
    process.env.YANDEX_DELIVERY_TOKEN = 'test-yandex-token';
    process.env.YANDEX_PLATFORM_STATION_ID =
      'fbed3aa1-2cc6-4370-ab4d-59c5cc9bb924';
  } else {
    process.env.YANDEX_DELIVERY_TOKEN = '';
    process.env.YANDEX_PLATFORM_STATION_ID = '';
  }

  if (google === 'present') {
    process.env.GOOGLE_CLIENT_ID = 'test-google-client-id';
    process.env.GOOGLE_CLIENT_SECRET = 'test-google-client-secret';
    process.env.GOOGLE_CALLBACK_URL =
      'http://localhost:3001/api/auth/google/callback';
  } else {
    process.env.GOOGLE_CLIENT_ID = '';
    process.env.GOOGLE_CLIENT_SECRET = '';
    process.env.GOOGLE_CALLBACK_URL = '';
  }
}

export function createMockFetch(
  allowedHostPattern: RegExp,
  handler: typeof fetch,
) {
  const calls: MockHttpCall[] = [];

  const fetchMock: typeof fetch = async (input, init) => {
    const url = String(input);
    const method = (init?.method || 'GET').toUpperCase();
    calls.push({ url, method });

    if (!allowedHostPattern.test(url)) {
      throw new Error(`Unexpected URL in mock fetch: ${url}`);
    }

    return handler(input, init);
  };

  return { fetchMock, calls };
}

export function createMockCdekFetch(handler: CdekFetch) {
  return createMockFetch(/^https:\/\/api\.(edu\.)?cdek\.ru\//, handler);
}

export function createMockYandexFetch(handler: YandexFetch) {
  return createMockFetch(
    /^https:\/\/b2b(\.taxi\.tst|-authproxy\.taxi)\.yandex\.net\//,
    handler,
  );
}

export function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export async function createTestApp(options: {
  cdekFetch?: CdekFetch;
  yandexFetch?: YandexFetch;
  googleFetch?: GoogleFetch;
  mailSend?: MailSend;
  cdek?: 'present' | 'missing';
  yandex?: 'present' | 'missing';
  google?: 'present' | 'missing';
  ozon?: 'present' | 'missing';
  ozonNotificationSecret?: string;
}) {
  applyTestDeliveryEnv({
    cdek: options.cdek ?? (options.cdekFetch ? 'present' : 'missing'),
    yandex: options.yandex ?? (options.yandexFetch ? 'present' : 'missing'),
    google: options.google ?? (options.googleFetch ? 'present' : 'missing'),
    ozon: options.ozon ?? 'missing',
    ozonNotificationSecret: options.ozonNotificationSecret,
  });

  let builder = Test.createTestingModule({
    imports: [AppModule],
  });

  if (options.cdekFetch) {
    builder = builder.overrideProvider(CDEK_FETCH).useValue(options.cdekFetch);
  } else {
    builder = builder.overrideProvider(CDEK_FETCH).useValue(async () => {
      throw new Error('CDEK fetch should not be called');
    });
  }

  if (options.yandexFetch) {
    builder = builder
      .overrideProvider(YANDEX_FETCH)
      .useValue(options.yandexFetch);
  } else {
    builder = builder.overrideProvider(YANDEX_FETCH).useValue(async () => {
      throw new Error('Yandex fetch should not be called');
    });
  }

  if (options.googleFetch) {
    builder = builder
      .overrideProvider(GOOGLE_FETCH)
      .useValue(options.googleFetch);
  }

  if (options.mailSend) {
    builder = builder.overrideProvider(MAIL_SEND).useValue(options.mailSend);
  }

  const moduleFixture: TestingModule = await builder.compile();
  const app = moduleFixture.createNestApplication();
  app.use(cookieParser());
  app.setGlobalPrefix('api');
  app.use(
    createOriginGuard(
      (process.env.CORS_ORIGIN ?? 'http://localhost:3000')
        .split(',')
        .map((o) => o.trim()),
    ),
  );
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );
  await app.init();

  if (options.cdekFetch) {
    app.get(CdekService).clearTokenCache();
  }

  return { app, moduleFixture };
}

export async function ensureDeliveryMethods(app: INestApplication) {
  const prisma = app.get(PrismaService);
  const methods = [
    {
      code: DeliveryMethodCode.CDEK,
      title: 'СДЭК',
      description: 'Доставка в пункт выдачи СДЭК',
      sortOrder: 1,
      isActive: true,
    },
    {
      code: DeliveryMethodCode.YANDEX,
      title: 'Яндекс Доставка',
      description: 'Доставка в пункт выдачи Яндекс',
      sortOrder: 2,
      isActive: true,
    },
    {
      code: DeliveryMethodCode.POST,
      title: 'Почта России',
      description: 'Доставка Почтой России',
      sortOrder: 3,
      isActive: true,
    },
    {
      code: DeliveryMethodCode.PICKUP,
      title: 'Самовывоз',
      description: 'Из пункта в Ленинградской области',
      sortOrder: 4,
      isActive: true,
    },
    {
      code: DeliveryMethodCode.COURIER,
      title: 'Курьер',
      description: 'Доставка курьером по адресу',
      sortOrder: 99,
      isActive: false,
    },
  ];

  for (const method of methods) {
    await prisma.deliveryMethod.upsert({
      where: { code: method.code },
      create: method,
      update: {
        title: method.title,
        description: method.description,
        sortOrder: method.sortOrder,
        isActive: method.isActive,
      },
    });
  }
}
