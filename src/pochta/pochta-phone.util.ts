/**
 * Pochta `tel-address` as 10-digit national (no country code).
 *
 * Their API accepts 11-digit `7…`, but the ЛК formats that value as
 * `+7 (7XX)…` (treats the country digit as part of the area code).
 * Sending 10 digits displays as `+7 (9XX)…` correctly.
 */
export function pochtaTelAddress(phone: string): number | null {
  const digits = phone.replace(/\D/g, '');
  let withCountry = digits;
  if (digits.length === 11 && digits.startsWith('8')) {
    withCountry = `7${digits.slice(1)}`;
  } else if (digits.length === 10) {
    withCountry = `7${digits}`;
  } else if (!(digits.length === 11 && digits.startsWith('7'))) {
    return null;
  }
  if (withCountry.length !== 11 || !withCountry.startsWith('7')) {
    return null;
  }
  return Number(withCountry.slice(1));
}
