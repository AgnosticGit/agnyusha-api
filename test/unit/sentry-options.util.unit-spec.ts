import {
  httpStatusFromException,
  isSentryEnabled,
  resolveSentryDsn,
  resolveTracesSampleRate,
  shouldDropHttpClientError,
} from '../../src/sentry/sentry-options.util';

describe('sentry-options.util', () => {
  it('drops 4xx and keeps 5xx', () => {
    expect(shouldDropHttpClientError(400)).toBe(true);
    expect(shouldDropHttpClientError(404)).toBe(true);
    expect(shouldDropHttpClientError(500)).toBe(false);
    expect(shouldDropHttpClientError(undefined)).toBe(false);
  });

  it('reads Nest HttpException-like status', () => {
    expect(httpStatusFromException({ getStatus: () => 409 })).toBe(409);
    expect(httpStatusFromException({ status: 503 })).toBe(503);
    expect(httpStatusFromException(new Error('x'))).toBeNull();
  });

  it('resolves DSN and sample rate from env', () => {
    expect(resolveSentryDsn({ SENTRY_DSN: '  https://x@o/1  ' })).toBe(
      'https://x@o/1',
    );
    expect(resolveSentryDsn({ SENTRY_DSN: '' })).toBeUndefined();
    expect(resolveTracesSampleRate({})).toBe(0.1);
    expect(
      resolveTracesSampleRate({
        SENTRY_TRACES_SAMPLE_RATE: '0.25',
      }),
    ).toBe(0.25);
  });

  it('enables Sentry only in production with DSN', () => {
    expect(
      isSentryEnabled({
        NODE_ENV: 'production',
        SENTRY_DSN: 'https://x@o/1',
      }),
    ).toBe(true);
    expect(
      isSentryEnabled({
        NODE_ENV: 'development',
        SENTRY_DSN: 'https://x@o/1',
      }),
    ).toBe(false);
    expect(isSentryEnabled({ NODE_ENV: 'production', SENTRY_DSN: '' })).toBe(
      false,
    );
  });
});
