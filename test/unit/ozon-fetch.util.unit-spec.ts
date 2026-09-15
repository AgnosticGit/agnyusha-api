import { describeOzonFetchError } from '../../src/payments/ozon-fetch.util';

describe('describeOzonFetchError', () => {
  it('includes undici ConnectTimeoutError cause (Sentry AGNYUSHA-API-1)', () => {
    const err = new TypeError('fetch failed');
    Object.assign(err, {
      cause: Object.assign(new Error('Connect Timeout Error'), {
        code: 'UND_ERR_CONNECT_TIMEOUT',
        name: 'ConnectTimeoutError',
      }),
    });

    expect(describeOzonFetchError(err)).toContain('fetch failed');
    expect(describeOzonFetchError(err)).toContain('Connect Timeout Error');
    expect(describeOzonFetchError(err)).toContain('UND_ERR_CONNECT_TIMEOUT');
  });

  it('handles plain errors without cause', () => {
    expect(describeOzonFetchError(new Error('boom'))).toBe('boom');
    expect(describeOzonFetchError('raw')).toBe('raw');
  });
});
