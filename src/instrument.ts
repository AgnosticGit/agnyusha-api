import * as Sentry from '@sentry/nestjs';
import {
  httpStatusFromException,
  isSentryEnabled,
  resolveSentryDsn,
  resolveTracesSampleRate,
  shouldDropHttpClientError,
} from './sentry/sentry-options.util';

const dsn = resolveSentryDsn();

Sentry.init({
  dsn,
  enabled: isSentryEnabled(),
  environment: 'production',
  tracesSampleRate: resolveTracesSampleRate(),
  sendDefaultPii: false,
  beforeSend(event, hint) {
    const status = httpStatusFromException(hint?.originalException);
    if (shouldDropHttpClientError(status)) return null;
    return event;
  },
});
