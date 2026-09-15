/** Human-readable detail for undici/Node fetch failures (timeouts, DNS, etc.). */
export function describeOzonFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const parts = [err.message];
  const cause = err.cause;
  if (cause instanceof Error) {
    parts.push(cause.message);
    const code = (cause as Error & { code?: unknown }).code;
    if (typeof code === 'string' && code && !cause.message.includes(code)) {
      parts.push(code);
    }
  } else if (cause && typeof cause === 'object') {
    const c = cause as { code?: unknown; name?: unknown; message?: unknown };
    if (typeof c.message === 'string' && c.message) parts.push(c.message);
    else if (typeof c.name === 'string' && c.name) parts.push(c.name);
    if (typeof c.code === 'string' && c.code) parts.push(c.code);
  }

  return parts.join(' — ');
}
