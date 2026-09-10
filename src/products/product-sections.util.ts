import { sanitizeProductHtml } from './sanitize-description';

export type ProductSection = {
  title: string;
  body: string;
};

/** Normalize + sanitize product content sections (tabs). */
export function normalizeProductSections(raw: unknown): ProductSection[] {
  if (!Array.isArray(raw)) return [];
  const out: ProductSection[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const row = item as { title?: unknown; body?: unknown };
    const title = String(row.title ?? '')
      .trim()
      .slice(0, 120);
    const body = sanitizeProductHtml(String(row.body ?? ''));
    if (!title && !body) continue;
    out.push({ title: title || 'Раздел', body });
  }
  return out;
}
