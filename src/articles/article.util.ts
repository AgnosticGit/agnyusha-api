import { slugify } from '../products/product.util';

export type ArticleTocItem = { id: string; text: string; level: 2 | 3 };
export type TocItem = ArticleTocItem;

const ALLOWED_IFRAME_HOSTS = [
  'www.youtube.com',
  'youtube.com',
  'www.youtube-nocookie.com',
  'youtu.be',
  'player.vimeo.com',
];

export function slugifyTitle(title: string): string {
  return slugify(title) || `article-${Date.now()}`;
}

/** @deprecated use slugifyTitle */
export function articleSlugFromTitle(title: string): string {
  return slugifyTitle(title);
}

function headingIdFromText(text: string, used: Set<string>): string {
  let base = slugify(text) || 'section';
  let id = base;
  let n = 2;
  while (used.has(id)) {
    id = `${base}-${n}`;
    n += 1;
  }
  used.add(id);
  return id;
}

/**
 * Assign missing heading ids and return TOC + rewritten HTML.
 */
export function extractTocFromHtml(html: string): {
  toc: ArticleTocItem[];
  html: string;
} {
  const used = new Set<string>();
  const toc: ArticleTocItem[] = [];

  const out = String(html ?? '').replace(
    /<h([23])([^>]*)>([\s\S]*?)<\/h\1>/gi,
    (_full, levelStr: string, attrs: string, inner: string) => {
      const level = Number(levelStr) as 2 | 3;
      const text = inner.replace(/<[^>]+>/g, '').trim();
      if (!text) {
        return `<h${level}${attrs}>${inner}</h${level}>`;
      }
      const idMatch = /\bid\s*=\s*["']([^"']+)["']/i.exec(attrs);
      let id = idMatch?.[1]?.trim() || '';
      if (id) {
        used.add(id);
      } else {
        id = headingIdFromText(text, used);
        attrs = `${attrs} id="${id}"`;
      }
      toc.push({ id, text, level });
      return `<h${level}${attrs}>${inner}</h${level}>`;
    },
  );

  return { toc, html: out };
}

/** Ensure h2/h3 have ids for TOC anchors. */
export function ensureHeadingIds(html: string): string {
  return extractTocFromHtml(html).html;
}

export function isAllowedEmbedSrc(src: string): boolean {
  try {
    const u = new URL(src);
    if (u.protocol !== 'https:') return false;
    return ALLOWED_IFRAME_HOSTS.includes(u.hostname);
  } catch {
    return false;
  }
}

function sanitizeHref(href: string): string | null {
  const trimmed = href.trim();
  if (!trimmed) return null;
  const lower = trimmed.toLowerCase();
  if (lower.startsWith('javascript:') || lower.startsWith('data:')) {
    return null;
  }
  if (
    lower.startsWith('https://') ||
    lower.startsWith('http://') ||
    lower.startsWith('/') ||
    lower.startsWith('#') ||
    lower.startsWith('mailto:')
  ) {
    return trimmed;
  }
  return null;
}

/**
 * Sanitize article HTML (server-side).
 * Strips scripts; iframes only for allowlisted hosts; safe links/images.
 */
export function sanitizeArticleHtml(raw: string): string {
  let html = String(raw ?? '').trim();
  html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
  html = html.replace(/\son\w+\s*=\s*(['"]).*?\1/gi, '');

  html = html.replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (full) => {
    const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(full);
    const src = srcMatch?.[1] ?? '';
    if (!isAllowedEmbedSrc(src)) return '';
    return `<iframe src="${src}" allowfullscreen loading="lazy" title="Видео"></iframe>`;
  });
  html = html.replace(/<iframe\b[^>]*\/?>/gi, (full) => {
    const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(full);
    const src = srcMatch?.[1] ?? '';
    if (!isAllowedEmbedSrc(src)) return '';
    return `<iframe src="${src}" allowfullscreen loading="lazy" title="Видео"></iframe>`;
  });

  html = html.replace(
    /<a\b([^>]*)>/gi,
    (_full, attrs: string) => {
      const hrefMatch = /\bhref\s*=\s*["']([^"']*)["']/i.exec(attrs);
      const href = hrefMatch ? sanitizeHref(hrefMatch[1]) : null;
      if (!href) return '<a>';
      return `<a href="${href}">`;
    },
  );

  html = html.replace(
    /<img\b([^>]*)\/?>/gi,
    (_full, attrs: string) => {
      const srcMatch = /\bsrc\s*=\s*["']([^"']+)["']/i.exec(attrs);
      const altMatch = /\balt\s*=\s*["']([^"']*)["']/i.exec(attrs);
      const src = srcMatch?.[1]?.trim() ?? '';
      if (!src || /^javascript:/i.test(src) || /^data:/i.test(src)) {
        return '';
      }
      if (
        !src.startsWith('/') &&
        !src.startsWith('https://') &&
        !src.startsWith('http://')
      ) {
        return '';
      }
      const alt = altMatch?.[1] ?? '';
      return `<img src="${src}" alt="${alt}" />`;
    },
  );

  return extractTocFromHtml(html).html;
}

export function prepareArticleContent(rawHtml: string): {
  contentHtml: string;
  toc: ArticleTocItem[];
} {
  const contentHtml = sanitizeArticleHtml(rawHtml);
  const { toc } = extractTocFromHtml(contentHtml);
  return { contentHtml, toc };
}
