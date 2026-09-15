/** Drop expected client/validation errors — keep 5xx and unknown failures. */
export function shouldDropHttpClientError(
  status: number | null | undefined,
): boolean {
  return typeof status === 'number' && status >= 400 && status < 500;
}

export function httpStatusFromException(error: unknown): number | null {
  if (!error || typeof error !== 'object') return null;
  const withGetStatus = error as { getStatus?: () => unknown };
  if (typeof withGetStatus.getStatus === 'function') {
    const status = withGetStatus.getStatus();
    return typeof status === 'number' ? status : null;
  }
  const withStatus = error as { status?: unknown };
  return typeof withStatus.status === 'number' ? withStatus.status : null;
}

export function resolveSentryDsn(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  const dsn = env.SENTRY_DSN?.trim();
  return dsn || undefined;
}

/** Sentry is production-only — never send from local/dev/test. */
export function isSentryEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  return env.NODE_ENV === 'production' && Boolean(resolveSentryDsn(env));
}

export function resolveTracesSampleRate(
  env: NodeJS.ProcessEnv = process.env,
): number {
  const raw = env.SENTRY_TRACES_SAMPLE_RATE?.trim();
  if (raw) {
    const n = Number(raw);
    if (Number.isFinite(n) && n >= 0 && n <= 1) return n;
  }
  return 0.1;
}
