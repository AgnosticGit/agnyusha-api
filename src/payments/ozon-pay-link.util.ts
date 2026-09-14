/** Allowed hosts for Ozon Pay redirect URLs (defense-in-depth). */
const ALLOWED_PAY_HOST_SUFFIXES = [
  'ozon.ru',
  'ozon.com',
  'finance.ozon.ru',
  'pay.ozon.ru',
];

/** True when URL is https and hosted on a known Ozon Pay domain. */
export function isAllowedOzonPayLink(payUrl: string): boolean {
  try {
    const u = new URL(payUrl.trim());
    if (u.protocol !== 'https:') return false;
    const host = u.hostname.toLowerCase();
    return ALLOWED_PAY_HOST_SUFFIXES.some(
      (suffix) => host === suffix || host.endsWith(`.${suffix}`),
    );
  } catch {
    return false;
  }
}
