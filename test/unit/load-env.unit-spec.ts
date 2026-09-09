import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  assertProductionCdekContour,
  syncDeliveryEnvWithNodeEnv,
} from '../../src/load-env';

describe('load-env', () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'agny-load-env-'));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it('overrides polluted edu CDEK keys from .env.production', () => {
    writeFileSync(
      join(dir, '.env.production'),
      [
        'CDEK_API_URL=https://api.cdek.ru',
        'CDEK_CLIENT_ID=prod-id',
        'CDEK_CLIENT_SECRET=prod-secret',
        'CDEK_FROM_LOCATION=SPB36',
        'CDEK_TARIFF_CODE=136',
        'POCHTA_ACCESS_TOKEN=prod-pochta-token',
        'POCHTA_FROM_INDEX=190000',
        'CORS_ORIGIN=http://should-not-touch',
      ].join('\n'),
      'utf8',
    );

    const env: NodeJS.ProcessEnv = {
      NODE_ENV: 'production',
      CDEK_API_URL: 'https://api.edu.cdek.ru',
      CDEK_FROM_LOCATION: 'MSK65',
      CDEK_CLIENT_ID: 'edu-id',
      POCHTA_ACCESS_TOKEN: 'dev-pochta',
      CORS_ORIGIN: 'https://ngrok.example',
    };

    const applied = syncDeliveryEnvWithNodeEnv(dir, env);
    expect(applied).toContain('.env.production');
    expect(env.CDEK_API_URL).toBe('https://api.cdek.ru');
    expect(env.CDEK_FROM_LOCATION).toBe('SPB36');
    expect(env.CDEK_CLIENT_ID).toBe('prod-id');
    expect(env.POCHTA_ACCESS_TOKEN).toBe('prod-pochta-token');
    expect(env.POCHTA_FROM_INDEX).toBe('190000');
    expect(env.CORS_ORIGIN).toBe('https://ngrok.example');
  });

  it('refuses production boot with edu CDEK URL', () => {
    expect(() =>
      assertProductionCdekContour({
        NODE_ENV: 'production',
        CDEK_API_URL: 'https://api.edu.cdek.ru',
      }),
    ).toThrow(/edu/);
  });

  it('allows edu in production when explicitly opted in', () => {
    expect(() =>
      assertProductionCdekContour({
        NODE_ENV: 'production',
        CDEK_API_URL: 'https://api.edu.cdek.ru',
        ALLOW_EDU_CDEK_IN_PROD: 'true',
      }),
    ).not.toThrow();
  });
});
