import { emptyAdjustments } from '../../src/cart/cart.types';

describe('emptyAdjustments', () => {
  it('returns empty removed and capped arrays', () => {
    expect(emptyAdjustments()).toEqual({ removed: [], capped: [] });
    expect(emptyAdjustments()).not.toBe(emptyAdjustments());
  });
});
