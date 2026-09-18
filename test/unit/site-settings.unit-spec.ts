import {
  SITE_SETTINGS_DEFAULTS,
  mergeSiteSettings,
  normalizePaidOrderNotifyEmails,
  toPublicSiteSettings,
} from '../../src/settings/site-settings';

describe('site-settings', () => {
  it('returns defaults for empty store', () => {
    expect(mergeSiteSettings({})).toEqual(SITE_SETTINGS_DEFAULTS);
  });

  it('merges partial overrides', () => {
    expect(
      mergeSiteSettings({
        freeDeliveryDisplayEnabled: true,
        reviewsEnabled: false,
        inventoryEnabled: true,
        paidOrderNotifyEmails: ['K_Aida@bk.ru', 'bad', 'k_aida@bk.ru'],
      }),
    ).toEqual({
      ...SITE_SETTINGS_DEFAULTS,
      freeDeliveryDisplayEnabled: true,
      reviewsEnabled: false,
      inventoryEnabled: true,
      paidOrderNotifyEmails: ['k_aida@bk.ru'],
    });
  });

  it('ignores removed freeDeliveryDisplayAmount key', () => {
    const dirty = { freeDeliveryDisplayAmount: 500 };
    expect(mergeSiteSettings(dirty)).toEqual(SITE_SETTINGS_DEFAULTS);
  });

  it('defaults inventoryEnabled to false', () => {
    expect(mergeSiteSettings({}).inventoryEnabled).toBe(false);
  });

  it('normalizes notify emails', () => {
    expect(
      normalizePaidOrderNotifyEmails([
        '  A@B.RU ',
        'a@b.ru',
        'not-an-email',
        1,
        '',
      ]),
    ).toEqual(['a@b.ru']);
  });

  it('public payload omits staff notify emails', () => {
    const s = mergeSiteSettings({
      promosEnabled: false,
      paidOrderNotifyEmails: ['shop@example.com'],
    });
    expect(toPublicSiteSettings(s)).toEqual({
      freeDeliveryDisplayEnabled: false,
      reviewsEnabled: true,
      articlesEnabled: true,
      promosEnabled: false,
      inventoryEnabled: false,
    });
    expect(toPublicSiteSettings(s)).not.toHaveProperty(
      'paidOrderNotifyEmails',
    );
  });
});
