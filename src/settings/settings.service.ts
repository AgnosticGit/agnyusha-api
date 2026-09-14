import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SITE_SETTING_KEYS,
  SITE_SETTINGS_DEFAULTS,
  mergeSiteSettings,
  toPublicSiteSettings,
  type SiteSettings,
} from './site-settings';

const BUNDLE_KEY = 'site';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getAll(): Promise<SiteSettings> {
    const row = await this.prisma.siteSetting.findUnique({
      where: { key: BUNDLE_KEY },
    });
    const raw =
      row?.value && typeof row.value === 'object' && !Array.isArray(row.value)
        ? (row.value as Record<string, unknown>)
        : {};
    return mergeSiteSettings(raw);
  }

  async getPublic(): Promise<SiteSettings> {
    return toPublicSiteSettings(await this.getAll());
  }

  async isInventoryEnabled(): Promise<boolean> {
    return (await this.getAll()).inventoryEnabled;
  }

  async update(patch: Partial<SiteSettings>): Promise<SiteSettings> {
    const current = await this.getAll();
    const next: SiteSettings = { ...current };

    for (const key of SITE_SETTING_KEYS) {
      if (patch[key] === undefined) continue;
      next[key] = Boolean(patch[key]) as never;
    }

    await this.prisma.siteSetting.upsert({
      where: { key: BUNDLE_KEY },
      create: { key: BUNDLE_KEY, value: next },
      update: { value: next },
    });

    return next;
  }

  defaults(): SiteSettings {
    return { ...SITE_SETTINGS_DEFAULTS };
  }
}
