import { ProductBadge } from '@prisma/client';

const HEX_RE = /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/;

export const BADGE_DEFAULT_COLOR = '#5fa88a';

export function normalizeBadgeColor(raw: string | null | undefined): string {
  const value = String(raw ?? '').trim();
  if (!HEX_RE.test(value)) return '';
  if (value.length === 4) {
    const [, r, g, b] = value;
    return `#${r}${r}${g}${g}${b}${b}`.toLowerCase();
  }
  return value.toLowerCase();
}

export function legacyBadgeFields(badge: ProductBadge, discountPercent: number | null) {
  if (badge === ProductBadge.HIT) {
    return { badgeLabel: 'Хит', badgeColor: '#5fa88a' };
  }
  if (badge === ProductBadge.NEW) {
    return { badgeLabel: 'Новинка', badgeColor: '#e0f0e8' };
  }
  if (badge === ProductBadge.SALE) {
    return {
      badgeLabel: discountPercent ? `-${discountPercent}%` : 'Скидка',
      badgeColor: '#c45c26',
    };
  }
  return { badgeLabel: '', badgeColor: '' };
}

export function resolveBadgeWrite(input: {
  badgeLabel?: string | null;
  badgeColor?: string | null;
  badge?: ProductBadge | null;
  discountPercent?: number | null;
}) {
  let badgeLabel = String(input.badgeLabel ?? '').trim().slice(0, 32);
  let badgeColor = normalizeBadgeColor(input.badgeColor);
  let badge = input.badge ?? ProductBadge.NONE;
  let discountPercent =
    input.discountPercent != null && Number.isFinite(input.discountPercent)
      ? Math.trunc(input.discountPercent)
      : null;

  if (!badgeLabel && badge !== ProductBadge.NONE) {
    const legacy = legacyBadgeFields(badge, discountPercent);
    badgeLabel = legacy.badgeLabel;
    badgeColor = legacy.badgeColor;
  }

  if (badgeLabel && !badgeColor) {
    badgeColor = BADGE_DEFAULT_COLOR;
  }
  if (!badgeLabel) {
    badgeColor = '';
    badge = ProductBadge.NONE;
    discountPercent = null;
  } else {
    const lower = badgeLabel.toLowerCase();
    if (lower === 'хит') badge = ProductBadge.HIT;
    else if (lower === 'новинка') badge = ProductBadge.NEW;
    else if (lower.includes('скид') || /^-?\d+%$/.test(badgeLabel)) {
      badge = ProductBadge.SALE;
      const match = badgeLabel.match(/(\d+)\s*%/);
      if (match) discountPercent = Number(match[1]);
    } else {
      badge = ProductBadge.NONE;
      discountPercent = null;
    }
  }

  return { badgeLabel, badgeColor, badge, discountPercent };
}

export function resolveBadgeRead(product: {
  badge: ProductBadge;
  badgeLabel: string;
  badgeColor: string;
  discountPercent: number | null;
}) {
  const label = product.badgeLabel.trim();
  if (label) {
    return {
      badgeLabel: label,
      badgeColor:
        normalizeBadgeColor(product.badgeColor) || BADGE_DEFAULT_COLOR,
    };
  }
  return legacyBadgeFields(product.badge, product.discountPercent);
}
