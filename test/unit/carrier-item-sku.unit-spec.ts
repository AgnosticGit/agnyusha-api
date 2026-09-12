import { carrierItemSku } from '../../src/orders/carrier-item-sku';

describe('carrierItemSku', () => {
  it('prefers sku over cuid', () => {
    expect(
      carrierItemSku({
        sku: 'KITTY-250',
        variantId: 'cmtx7o0l700087khoivb9pbtv',
        id: 'cmitem',
      }),
    ).toBe('KITTY-250');
  });

  it('falls back to variantId then item id', () => {
    expect(
      carrierItemSku({ sku: '  ', variantId: 'cvar123', id: 'citem' }),
    ).toBe('cvar123');
    expect(carrierItemSku({ sku: null, variantId: null, id: 'citem' })).toBe(
      'citem',
    );
  });
});
