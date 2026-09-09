import type { ConfigService } from '@nestjs/config';
import { isInventoryEnabled } from '../../src/common/inventory';

function fakeConfig(values: Record<string, string | undefined>): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

describe('isInventoryEnabled', () => {
  it('is true for true/yes/1 (case-insensitive, trimmed)', () => {
    expect(isInventoryEnabled(fakeConfig({ INVENTORY_ENABLED: 'true' }))).toBe(
      true,
    );
    expect(isInventoryEnabled(fakeConfig({ INVENTORY_ENABLED: 'YES' }))).toBe(
      true,
    );
    expect(isInventoryEnabled(fakeConfig({ INVENTORY_ENABLED: ' 1 ' }))).toBe(
      true,
    );
  });

  it('is false for empty, false, and other values', () => {
    expect(isInventoryEnabled(fakeConfig({ INVENTORY_ENABLED: '' }))).toBe(
      false,
    );
    expect(isInventoryEnabled(fakeConfig({ INVENTORY_ENABLED: 'false' }))).toBe(
      false,
    );
    expect(isInventoryEnabled(fakeConfig({ INVENTORY_ENABLED: 'no' }))).toBe(
      false,
    );
    expect(isInventoryEnabled(fakeConfig({}))).toBe(false);
  });
});
