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

/** Build sections from legacy description/ingredients fields (migration helper). */
export function sectionsFromLegacyFields(
  description?: string | null,
  ingredients?: string | null,
): ProductSection[] {
  const sections: ProductSection[] = [];
  const desc = String(description ?? '').trim();
  const ing = String(ingredients ?? '').trim();
  if (desc) sections.push({ title: 'Описание', body: sanitizeProductHtml(desc) });
  if (ing) sections.push({ title: 'Состав', body: sanitizeProductHtml(ing) });
  return sections;
}
