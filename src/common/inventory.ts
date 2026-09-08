import { ConfigService } from '@nestjs/config';

/** Stock / inventory enforcement. Default off — set INVENTORY_ENABLED=true to enable. */
export function isInventoryEnabled(config: ConfigService): boolean {
  const raw = (config.get<string>('INVENTORY_ENABLED') ?? 'false')
    .trim()
    .toLowerCase();
  return raw === 'true' || raw === '1' || raw === 'yes';
}
