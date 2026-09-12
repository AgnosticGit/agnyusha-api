import { pochtaTelAddress } from '../../src/pochta/pochta-phone.util';

describe('pochtaTelAddress', () => {
  it('sends 10-digit national for +7 / 8 / bare mobile', () => {
    expect(pochtaTelAddress('+7 (987) 627-79-42')).toBe(9876277942);
    expect(pochtaTelAddress('8 (987) 627-79-42')).toBe(9876277942);
    expect(pochtaTelAddress('9876277942')).toBe(9876277942);
    expect(pochtaTelAddress('79876277942')).toBe(9876277942);
  });

  it('rejects incomplete numbers', () => {
    expect(pochtaTelAddress('+7 (987) 627')).toBeNull();
    expect(pochtaTelAddress('')).toBeNull();
  });
});
