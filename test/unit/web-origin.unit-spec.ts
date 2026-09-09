import type { ConfigService } from '@nestjs/config';
import { resolvePublicWebUrl } from '../../src/common/web-origin';

function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('resolvePublicWebUrl', () => {
  it('prefers PUBLIC_WEB_URL and strips trailing slash', () => {
    expect(
      resolvePublicWebUrl(
        fakeConfig({
          PUBLIC_WEB_URL: 'https://shop.test/',
          CORS_ORIGIN: 'https://other.test',
        }),
      ),
    ).toBe('https://shop.test');
  });

  it('falls back to first CORS_ORIGIN entry', () => {
    expect(
      resolvePublicWebUrl(
        fakeConfig({
          PUBLIC_WEB_URL: '  ',
          CORS_ORIGIN: ' https://a.test/ ,https://b.test',
        }),
      ),
    ).toBe('https://a.test');
  });

  it('defaults to localhost when nothing is set', () => {
    expect(resolvePublicWebUrl(fakeConfig({}))).toBe('http://localhost:3000');
  });
});
