import {
  isPochtaMissingEntityResponse,
  isPochtaShipmentId,
  isPochtaShipmentLookupPath,
} from '../../src/pochta/pochta-shipment.util';

describe('pochta-shipment.util', () => {
  describe('isPochtaShipmentId', () => {
    it('accepts numeric Otpravka ids', () => {
      expect(isPochtaShipmentId('9001')).toBe(true);
      expect(isPochtaShipmentId(' 12345678901234567890 ')).toBe(true);
    });

    it('rejects junk leftover / non-numeric ids', () => {
      expect(isPochtaShipmentId('gone-1')).toBe(false);
      expect(isPochtaShipmentId('abc')).toBe(false);
      expect(isPochtaShipmentId('')).toBe(false);
      expect(isPochtaShipmentId('12ab')).toBe(false);
    });
  });

  describe('isPochtaShipmentLookupPath', () => {
    it('matches shipment and backlog GETs', () => {
      expect(isPochtaShipmentLookupPath('1.0/shipment/9001')).toBe(true);
      expect(isPochtaShipmentLookupPath('1.0/backlog/9001')).toBe(true);
      expect(isPochtaShipmentLookupPath('postoffice/1.0/190000')).toBe(false);
      expect(isPochtaShipmentLookupPath('1.0/user/backlog')).toBe(false);
    });
  });

  describe('isPochtaMissingEntityResponse', () => {
    it('treats 404 as missing', () => {
      expect(isPochtaMissingEntityResponse(404, '')).toBe(true);
    });

    it('treats Otpravka 400 invalid id as missing', () => {
      expect(
        isPochtaMissingEntityResponse(
          400,
          '{ "code" : "BAD_REQUEST", "desc" : "Invalid request parameter" }',
        ),
      ).toBe(true);
    });

    it('does not treat unrelated errors as missing', () => {
      expect(isPochtaMissingEntityResponse(500, 'oops')).toBe(false);
      expect(isPochtaMissingEntityResponse(400, '{ "code": "OTHER" }')).toBe(
        false,
      );
      expect(isPochtaMissingEntityResponse(401, 'unauthorized')).toBe(false);
    });
  });
});
