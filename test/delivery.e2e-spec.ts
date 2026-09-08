import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  createMockCdekFetch,
  createTestApp,
  ensureDeliveryMethods,
  jsonResponse,
} from './helpers/cdek-test.helpers';

describe('Delivery methods (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const mock = createMockCdekFetch(async () =>
      jsonResponse({ message: 'CDEK should not be called' }, 500),
    );
    const created = await createTestApp({
      cdekFetch: mock.fetchMock,
      cdek: 'present',
      yandex: 'missing',
    });
    app = created.app;
    await ensureDeliveryMethods(app);
  });

  afterAll(async () => {
    await app.close();
  });

  it('marks pickup available only for SPb / LO labels', async () => {
    const local = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .query({
        region: 'Санкт-Петербург',
        label: 'Санкт-Петербург, Санкт-Петербург, Россия',
      })
      .expect(200);

    const byCode = Object.fromEntries(
      local.body.map((m: { code: string; available: boolean }) => [
        m.code,
        m.available,
      ]),
    );
    expect(byCode.PICKUP).toBe(true);
    expect(byCode.COURIER).toBeUndefined();
    expect(byCode.CDEK).toBe(true);
    expect(byCode.YANDEX).toBe(false);
    expect(byCode.POST).toBe(true);

    const remote = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .query({
        region: 'Москва',
        label: 'Москва, Москва, Россия',
      })
      .expect(200);

    const remoteByCode = Object.fromEntries(
      remote.body.map((m: { code: string; available: boolean }) => [
        m.code,
        m.available,
      ]),
    );
    expect(remoteByCode.PICKUP).toBe(false);
    expect(remoteByCode.COURIER).toBeUndefined();
    expect(remoteByCode.CDEK).toBe(true);
  });

  it('returns unavailable methods when location is missing', async () => {
    const res = await request(app.getHttpServer())
      .get('/api/delivery-methods')
      .expect(200);

    expect(
      res.body.every((m: { available: boolean }) => m.available === false),
    ).toBe(true);
  });
});
