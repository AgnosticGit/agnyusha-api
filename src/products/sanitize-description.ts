import { FilterXSS, escapeHtml } from 'xss';

const tags: Record<string, string[]> = {
  p: ['style'],
  br: [],
  strong: [],
  b: [],
  em: [],
  i: [],
  u: [],
  s: [],
  h2: ['style'],
  h3: ['style'],
  ul: [],
  ol: [],
  li: [],
  span: ['style'],
};

const FONT_SIZE_RE = /^\d+(?:\.\d+)?(?:px|rem|em)$/;

function sanitizeStyle(value: string): string {
  const parts = value
    .split(';')
    .map((part) => part.trim())
    .filter(Boolean)
    .flatMap((part) => {
      const colon = part.indexOf(':');
      if (colon < 0) return [];
      const prop = part.slice(0, colon).trim().toLowerCase();
      const val = part.slice(colon + 1).trim();
      if (prop === 'font-size' && FONT_SIZE_RE.test(val)) {
        return [`font-size: ${val}`];
      }
      return [];
    });
  return parts.join('; ');
}

const filter = new FilterXSS({
  whiteList: tags,
  stripIgnoreTag: true,
  stripIgnoreTagBody: ['script', 'style'],
  css: false,
  onTagAttr(_tag, name, value) {
    if (name === 'style') {
      const cleaned = sanitizeStyle(value);
      return cleaned ? `style="${cleaned}"` : '';
    }
    return undefined;
  },
});

/** Sanitize product rich-text HTML; plain text stays escaped as a paragraph. */
export function sanitizeProductHtml(raw: string | null | undefined): string {
  const input = String(raw ?? '').trim();
  if (!input) return '';

  const looksLikeHtml = /<\/?[a-z][\s\S]*>/i.test(input);
  const html = looksLikeHtml ? input : `<p>${escapeHtml(input)}</p>`;

  return filter.process(html).trim();
}
