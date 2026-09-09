import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/** Keys that must match `.env.${NODE_ENV}` even if the shell/IDE already injected `.env`. */
const DELIVERY_ENV_KEYS = [
  'CDEK_API_URL',
  'CDEK_CLIENT_ID',
  'CDEK_CLIENT_SECRET',
  'CDEK_FROM_LOCATION',
  'CDEK_TARIFF_CODE',
  'YANDEX_DELIVERY_API_URL',
  'YANDEX_DELIVERY_TOKEN',
  'YANDEX_PLATFORM_STATION_ID',
] as const;

function parseEnvFile(content: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

/**
 * Nest ConfigModule does not override keys already present in `process.env`.
 * Local terminals often preload `.env` (edu CDEK), so `NODE_ENV=production`
 * still talks to api.edu.cdek.ru. Force delivery keys from `.env.${NODE_ENV}`.
 */
export function syncDeliveryEnvWithNodeEnv(
  cwd = process.cwd(),
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  const filePath = resolve(cwd, `.env.${nodeEnv}`);
  if (!existsSync(filePath)) return null;

  const parsed = parseEnvFile(readFileSync(filePath, 'utf8'));
  for (const key of DELIVERY_ENV_KEYS) {
    if (Object.prototype.hasOwnProperty.call(parsed, key)) {
      env[key] = parsed[key];
    }
  }
  return filePath;
}

export function assertProductionCdekContour(
  env: NodeJS.ProcessEnv = process.env,
): void {
  const nodeEnv = env.NODE_ENV?.trim() || 'development';
  if (nodeEnv !== 'production') return;
  if ((env.ALLOW_EDU_CDEK_IN_PROD ?? '').trim() === 'true') return;

  const url = (env.CDEK_API_URL ?? '').trim().toLowerCase();
  if (url.includes('edu.cdek.ru')) {
    throw new Error(
      `Refusing to start: NODE_ENV=production but CDEK_API_URL is edu (${env.CDEK_API_URL}). ` +
        `Fix .env.production / shell env, or set ALLOW_EDU_CDEK_IN_PROD=true for an intentional override.`,
    );
  }
}
