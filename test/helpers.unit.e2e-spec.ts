import { SlidingWindowRateLimiter } from '../src/common/rate-limit';
import { sanitizeProductHtml } from '../src/products/sanitize-description';
import {
  normalizeBadgeColor,
  resolveBadgeWrite,
} from '../src/products/badge.util';
import { ProductBadge } from '@prisma/client';

describe('shared helpers', () => {
  it('rate-limits after the configured burst', () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
    expect(limiter.tryConsume('b')).toBe(true);
  });

  it('sanitizes product html and escapes plain text', () => {
    expect(sanitizeProductHtml('hello')).toBe('<p>hello</p>');
    expect(
      sanitizeProductHtml(
        '<p>ok <strong>x</strong></p><script>alert(1)</script>',
      ),
    ).toBe('<p>ok <strong>x</strong></p>');
    expect(
      sanitizeProductHtml(
        '<span style="font-size: 1.25rem; color: red">x</span>',
      ),
    ).toBe('<span style="font-size: 1.25rem">x</span>');
  });

  it('normalizes and resolves custom badges', () => {
    expect(normalizeBadgeColor('#ABC')).toBe('#aabbcc');
    expect(normalizeBadgeColor('red')).toBe('');
    const custom = resolveBadgeWrite({
      badgeLabel: 'Акция',
      badgeColor: '#c45c26',
    });
    expect(custom.badgeLabel).toBe('Акция');
    expect(custom.badgeColor).toBe('#c45c26');
    expect(custom.badge).toBe(ProductBadge.NONE);

    const hit = resolveBadgeWrite({ badge: ProductBadge.HIT });
    expect(hit.badgeLabel).toBe('Хит');
    expect(hit.badgeColor).toBe('#5fa88a');
  });
});
