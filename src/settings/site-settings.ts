export type SiteSettings = {
  freeDeliveryDisplayEnabled: boolean;
  reviewsEnabled: boolean;
  articlesEnabled: boolean;
  promosEnabled: boolean;
  inventoryEnabled: boolean;
  /** Admin-only: recipients for “paid order” staff alerts. */
  paidOrderNotifyEmails: string[];
};

/** Flags safe to expose on the public storefront. */
export type PublicSiteSettings = Omit<SiteSettings, 'paidOrderNotifyEmails'>;

export const SITE_SETTINGS_DEFAULTS: SiteSettings = {
  freeDeliveryDisplayEnabled: false,
  reviewsEnabled: true,
  articlesEnabled: true,
  promosEnabled: true,
  inventoryEnabled: false,
  paidOrderNotifyEmails: [],
};

export const SITE_SETTING_KEYS = Object.keys(
  SITE_SETTINGS_DEFAULTS,
) as Array<keyof SiteSettings>;

const SITE_SETTING_BOOL_KEYS = [
  'freeDeliveryDisplayEnabled',
  'reviewsEnabled',
  'articlesEnabled',
  'promosEnabled',
  'inventoryEnabled',
] as const satisfies ReadonlyArray<keyof SiteSettings>;

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_PAID_ORDER_NOTIFY_EMAILS = 20;

/** Normalize, dedupe, and validate staff notify emails. */
export function normalizePaidOrderNotifyEmails(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const email = item.trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email)) continue;
    if (seen.has(email)) continue;
    seen.add(email);
    out.push(email);
    if (out.length >= MAX_PAID_ORDER_NOTIFY_EMAILS) break;
  }
  return out;
}

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
    paidOrderNotifyEmails: normalizePaidOrderNotifyEmails(
      stored.paidOrderNotifyEmails ??
        SITE_SETTINGS_DEFAULTS.paidOrderNotifyEmails,
    ),
  };
}

/** Public payload — never expose staff notify emails. */
export function toPublicSiteSettings(
  settings: SiteSettings,
): PublicSiteSettings {
  return {
    freeDeliveryDisplayEnabled: settings.freeDeliveryDisplayEnabled,
    reviewsEnabled: settings.reviewsEnabled,
    articlesEnabled: settings.articlesEnabled,
    promosEnabled: settings.promosEnabled,
    inventoryEnabled: settings.inventoryEnabled,
  };
}

export { SITE_SETTING_BOOL_KEYS };
