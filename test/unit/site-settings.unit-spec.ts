import {
  SITE_SETTINGS_DEFAULTS,
  mergeSiteSettings,
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
      }),
    ).toEqual({
      ...SITE_SETTINGS_DEFAULTS,
      freeDeliveryDisplayEnabled: true,
      reviewsEnabled: false,
      inventoryEnabled: true,
    });
  });

  it('ignores removed freeDeliveryDisplayAmount key', () => {
    const dirty = { freeDeliveryDisplayAmount: 500 };
    expect(mergeSiteSettings(dirty)).toEqual(SITE_SETTINGS_DEFAULTS);
  });

  it('defaults inventoryEnabled to false', () => {
    expect(mergeSiteSettings({}).inventoryEnabled).toBe(false);
  });

  it('public payload is a plain copy', () => {
    const s = mergeSiteSettings({ promosEnabled: false });
    expect(toPublicSiteSettings(s)).toEqual(s);
    expect(toPublicSiteSettings(s)).not.toBe(s);
  });
});
