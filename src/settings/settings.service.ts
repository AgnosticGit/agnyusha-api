import { Injectable } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import {
  SITE_SETTING_BOOL_KEYS,
  SITE_SETTINGS_DEFAULTS,
  mergeSiteSettings,
  normalizePaidOrderNotifyEmails,
  toPublicSiteSettings,
  type PublicSiteSettings,
  type SiteSettings,
} from './site-settings';

const BUNDLE_KEY = 'site';
/** Short TTL — settings change rarely; hot paths call isInventoryEnabled often. */
const CACHE_TTL_MS = 5_000;

@Injectable()
export class SettingsService {
  private cache: { value: SiteSettings; expiresAt: number } | null = null;

  constructor(private readonly prisma: PrismaService) {}

  private invalidateCache() {
    this.cache = null;
  }

  async getAll(): Promise<SiteSettings> {
    const now = Date.now();
    const cacheDisabled = process.env.NODE_ENV === 'test';
    if (!cacheDisabled && this.cache && this.cache.expiresAt > now) {
      return this.cache.value;
    }

    const row = await this.prisma.siteSetting.findUnique({
      where: { key: BUNDLE_KEY },
    });
    const raw =
      row?.value && typeof row.value === 'object' && !Array.isArray(row.value)
        ? (row.value as Record<string, unknown>)
        : {};
    const value = mergeSiteSettings(raw);
    if (!cacheDisabled) {
      this.cache = { value, expiresAt: now + CACHE_TTL_MS };
    }
    return value;
  }

  async getPublic(): Promise<PublicSiteSettings> {
    return toPublicSiteSettings(await this.getAll());
  }

  async getPaidOrderNotifyEmails(): Promise<string[]> {
    return (await this.getAll()).paidOrderNotifyEmails;
  }

  async isInventoryEnabled(): Promise<boolean> {
    return (await this.getAll()).inventoryEnabled;
  }

  async isReviewsEnabled(): Promise<boolean> {
    return (await this.getAll()).reviewsEnabled;
  }

  async update(patch: Partial<SiteSettings>): Promise<SiteSettings> {
    const current = await this.getAll();
    const next: SiteSettings = { ...current };

    for (const key of SITE_SETTING_BOOL_KEYS) {
      if (patch[key] === undefined) continue;
      next[key] = Boolean(patch[key]);
    }
    if (patch.paidOrderNotifyEmails !== undefined) {
      next.paidOrderNotifyEmails = normalizePaidOrderNotifyEmails(
        patch.paidOrderNotifyEmails,
      );
    }

    await this.prisma.siteSetting.upsert({
      where: { key: BUNDLE_KEY },
      create: { key: BUNDLE_KEY, value: next },
      update: { value: next },
    });

    this.invalidateCache();
    this.cache = { value: next, expiresAt: Date.now() + CACHE_TTL_MS };
    return next;
  }

  defaults(): SiteSettings {
    return { ...SITE_SETTINGS_DEFAULTS, paidOrderNotifyEmails: [] };
  }
}
