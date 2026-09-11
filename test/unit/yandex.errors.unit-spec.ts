import {
  isYandexRequestGone,
  yandexRequestIdFromPath,
} from '../../src/yandex/yandex.errors';

describe('yandex.errors', () => {
  const infoPath =
    '/api/b2b/platform/request/info?request_id=yandex-request-test-1';

  it('treats 404 on request/info as gone', () => {
    expect(isYandexRequestGone(infoPath, 404, '')).toBe(true);
    expect(
      isYandexRequestGone(infoPath, 400, '{"code":"customer_order_not_found"}'),
    ).toBe(true);
  });

  it('does not treat create/offer 4xx as gone', () => {
    expect(
      isYandexRequestGone(
        '/api/b2b/platform/offers/create',
        400,
        'customer_order_not_found',
      ),
    ).toBe(false);
    expect(isYandexRequestGone(infoPath, 500, '')).toBe(false);
  });

  it('reads request_id from the query', () => {
    expect(yandexRequestIdFromPath(infoPath)).toBe('yandex-request-test-1');
  });
});
