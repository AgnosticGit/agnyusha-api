import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { CDEK_FETCH } from '../src/cdek/cdek.tokens';
import { YANDEX_FETCH } from '../src/yandex/yandex.tokens';
import {
  applyTestDeliveryEnv,
  createMockCdekFetch,
  createTestApp,
  jsonResponse,
} from './helpers/cdek-test.helpers';

describe('Delivery configuration (e2e)', () => {
  it('returns generic 503 when no delivery providers are configured', async () => {
    applyTestDeliveryEnv({ cdek: 'missing', yandex: 'missing' });

    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(CDEK_FETCH)
      .useValue(async () => {
        throw new Error('fetch must not be called');
      })
      .overrideProvider(YANDEX_FETCH)
      .useValue(async () => {
        throw new Error('fetch must not be called');
      })
      .compile();

    const app: INestApplication = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api');
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        transform: true,
        transformOptions: { enableImplicitConversion: true },
      }),
    );
    await app.init();

    const res = await request(app.getHttpServer())
      .get('/api/cities/search')
      .query({ q: 'Москва' })
      .expect(503);

    expect(res.body.message).toBe('Служба доставки временно недоступна');
    expect(JSON.stringify(res.body)).not.toMatch(/CLIENT|SECRET|TOKEN|\.env/i);

    await app.close();
  });

  it('returns generic 503 when CDEK auth fails (mocked)', async () => {
    const mock = createMockCdekFetch(async (input) => {
      const url = String(input);
      if (url.includes('/oauth/token')) {
        return jsonResponse({ error: 'unauthorized' }, 401);
      }
      return jsonResponse({}, 500);
    });

    const { app } = await createTestApp({
      cdekFetch: mock.fetchMock,
      cdek: 'present',
      yandex: 'missing',
    });

    const res = await request(app.getHttpServer())
      .get('/api/cities/search')
      .query({ q: 'Москва' })
      .expect(503);

    expect(res.body.message).toBe('Служба доставки временно недоступна');
    await app.close();
  });
});
