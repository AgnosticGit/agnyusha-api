import { SlidingWindowRateLimiter } from '../src/common/rate-limit';
import {
  estimateWeightGrams,
  resolveWeightGrams,
} from '../src/common/weight';
import { formatPersonName } from '../src/common/person-name';
import { sanitizeProductHtml } from '../src/products/sanitize-description';
import {
  normalizeBadgeColor,
  resolveBadgeWrite,
} from '../src/products/badge.util';
import { ProductBadge } from '@prisma/client';
import {
  absoluteMediaUrl,
  buildOrderReceiptMail,
  resolveLocalImagePath,
} from '../src/mail/order-receipt';

describe('shared helpers', () => {
  it('rate-limits after the configured burst', () => {
    const limiter = new SlidingWindowRateLimiter(3, 60_000);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(true);
    expect(limiter.tryConsume('a')).toBe(false);
    expect(limiter.tryConsume('b')).toBe(true);
  });

  it('resolves shipping weight in grams', () => {
    expect(estimateWeightGrams('0,8 кг.')).toBe(800);
    expect(estimateWeightGrams('250 г')).toBe(250);
    expect(resolveWeightGrams(1250, '1 кг.')).toBe(1250);
    expect(resolveWeightGrams(null, '2 кг.')).toBe(2000);
  });

  it('formats recipient names', () => {
    expect(
      formatPersonName({
        lastName: 'Иванов',
        firstName: 'Иван',
        middleName: 'Иванович',
      }),
    ).toBe('Иванов Иван Иванович');
    expect(formatPersonName({ lastName: '', firstName: '' })).toBe('Покупатель');
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

  it('builds paid order receipt with items and optional login invite', () => {
    expect(absoluteMediaUrl('https://shop.test', '/uploads/a.png')).toBe(
      'https://shop.test/uploads/a.png',
    );
    const guest = buildOrderReceiptMail({
      orderId: 'cuidabcdefghijklmnop',
      total: 1500,
      webOrigin: 'https://shop.test',
      needsLogin: true,
      paid: true,
      items: [
        {
          productName: 'Индейка <b>',
          weight: '1 кг.',
          price: 750,
          qty: 2,
          image: '/uploads/turkey.png',
        },
      ],
    });
    expect(guest.subject).toMatch(/Заказ Агнюша №/);
    expect(guest.text).toContain('оплачен');
    expect(guest.text).toContain('Индейка <b>');
    expect(guest.text).toContain('войдите на сайте');
    expect(guest.html).toContain('Индейка &lt;b&gt;');
    expect(guest.html).toContain('войдите на сайте');
    // Missing local file → remote URL fallback.
    expect(guest.html).toContain('https://shop.test/uploads/turkey.png');
    expect(guest.attachments).toHaveLength(0);

    const authed = buildOrderReceiptMail({
      orderId: 'cuidabcdefghijklmnop',
      total: 750,
      webOrigin: 'https://shop.test',
      needsLogin: false,
      paid: true,
      items: [
        {
          productName: 'Говядина',
          weight: '0,5 кг.',
          price: 750,
          qty: 1,
          image: '/assets/beef.png',
        },
      ],
    });
    expect(authed.text).toContain('оплачен');
    expect(authed.text).toContain('Говядина');
    expect(authed.text).not.toContain('войдите на сайте');
    expect(authed.html).not.toContain('войдите на сайте');
  });

  it('embeds local product images as cid attachments', () => {
    const { writeFileSync, mkdirSync, rmSync } = require('node:fs') as typeof import('node:fs');
    const { join } = require('node:path') as typeof import('node:path');
    const { tmpdir } = require('node:os') as typeof import('node:os');
    const dir = join(tmpdir(), `agny-mail-${Date.now()}`);
    const uploads = join(dir, 'uploads');
    const assets = join(dir, 'public', 'assets');
    mkdirSync(uploads, { recursive: true });
    mkdirSync(assets, { recursive: true });
    // Minimal 1x1 PNG
    const png = Buffer.from(
      'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
      'base64',
    );
    writeFileSync(join(uploads, 'a.png'), png);
    writeFileSync(join(assets, 'b.png'), png);

    try {
      expect(resolveLocalImagePath('/uploads/a.png', { uploadsDir: uploads })).toBe(
        join(uploads, 'a.png'),
      );
      expect(
        resolveLocalImagePath('/assets/b.png', { webPublicDir: join(dir, 'public') }),
      ).toBe(join(assets, 'b.png'));
      expect(resolveLocalImagePath('/uploads/../secret', { uploadsDir: uploads })).toBeNull();

      const mail = buildOrderReceiptMail({
        orderId: 'cuidabcdefghijklmnop',
        total: 100,
        webOrigin: 'https://shop.test',
        needsLogin: false,
        paid: true,
        uploadsDir: uploads,
        webPublicDir: join(dir, 'public'),
        items: [
          {
            productName: 'A',
            weight: '1 кг.',
            price: 50,
            qty: 1,
            image: '/uploads/a.png',
          },
          {
            productName: 'B',
            weight: '1 кг.',
            price: 50,
            qty: 1,
            image: '/assets/b.png',
          },
          {
            productName: 'A2',
            weight: '1 кг.',
            price: 50,
            qty: 1,
            image: '/uploads/a.png',
          },
        ],
      });

      expect(mail.attachments).toHaveLength(2);
      expect(mail.html).toContain(`cid:${mail.attachments[0].contentId}`);
      expect(mail.html).toContain(`cid:${mail.attachments[1].contentId}`);
      expect(mail.html).not.toContain('https://shop.test/uploads/a.png');
      expect(mail.attachments[0].contentType).toBe('image/png');
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
