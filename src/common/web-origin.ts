import type { ConfigService } from '@nestjs/config';

/** Prefer PUBLIC_WEB_URL, else first CORS_ORIGIN entry. */
export function resolvePublicWebUrl(config: ConfigService): string {
  const fromEnv = (config.get<string>('PUBLIC_WEB_URL') ?? '').trim();
  if (fromEnv) return fromEnv.replace(/\/$/, '');
  const cors = (config.get<string>('CORS_ORIGIN') ?? '')
    .split(',')[0]
    ?.trim();
  return (cors || 'http://localhost:3000').replace(/\/$/, '');
}
