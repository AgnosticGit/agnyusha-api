export type SiteSettings = {
  freeDeliveryDisplayEnabled: boolean;
  reviewsEnabled: boolean;
  articlesEnabled: boolean;
  promosEnabled: boolean;
  inventoryEnabled: boolean;
};

export const SITE_SETTINGS_DEFAULTS: SiteSettings = {
  freeDeliveryDisplayEnabled: false,
  reviewsEnabled: true,
  articlesEnabled: true,
  promosEnabled: true,
  inventoryEnabled: false,
};

export const SITE_SETTING_KEYS = Object.keys(
  SITE_SETTINGS_DEFAULTS,
) as Array<keyof SiteSettings>;

export function mergeSiteSettings(
  stored: Partial<Record<string, unknown>>,
): SiteSettings {
  return {
    freeDeliveryDisplayEnabled: Boolean(
      stored.freeDeliveryDisplayEnabled ??
        SITE_SETTINGS_DEFAULTS.freeDeliveryDisplayEnabled,
    ),
    reviewsEnabled: Boolean(
      stored.reviewsEnabled ?? SITE_SETTINGS_DEFAULTS.reviewsEnabled,
    ),
    articlesEnabled: Boolean(
      stored.articlesEnabled ?? SITE_SETTINGS_DEFAULTS.articlesEnabled,
    ),
    promosEnabled: Boolean(
      stored.promosEnabled ?? SITE_SETTINGS_DEFAULTS.promosEnabled,
    ),
    inventoryEnabled: Boolean(
      stored.inventoryEnabled ?? SITE_SETTINGS_DEFAULTS.inventoryEnabled,
    ),
  };
}

/** Public payload — same shape; all current flags are safe to expose. */
export function toPublicSiteSettings(settings: SiteSettings): SiteSettings {
  return { ...settings };
}
