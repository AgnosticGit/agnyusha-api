/** Region fragment in "City, Region, Country" style labels (RU). */
export const REGION_HINT =
  /область|край|республика|округ|Москва|Петербург|Севастополь/i;

export function sanitizeSearchName(value: string, maxLen = 100): string {
  return value
    .normalize('NFKC')
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .trim()
    .slice(0, maxLen);
}

export async function readErrorBody(
  res: Response,
  maxLen = 300,
): Promise<string> {
  try {
    const text = await res.text();
    return text.slice(0, maxLen);
  } catch {
    return '';
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  ms: number,
  label: string,
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label}: timeout after ${ms}ms`)),
          ms,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
