/** Yandex request/info returned 404 / customer_order_not_found. */
export class YandexEntityNotFoundError extends Error {
  constructor(public readonly requestId: string) {
    super(`Yandex request not found: ${requestId}`);
    this.name = 'YandexEntityNotFoundError';
  }
}

export function isYandexRequestGone(
  path: string,
  status: number,
  detail: string,
): boolean {
  if (!path.includes('/request/info')) return false;
  if (status === 404) return true;
  return detail.includes('customer_order_not_found');
}

export function yandexRequestIdFromPath(path: string): string {
  try {
    const url = new URL(path, 'https://b2b.taxi.yandex.net');
    return url.searchParams.get('request_id')?.trim() || path;
  } catch {
    return path;
  }
}
