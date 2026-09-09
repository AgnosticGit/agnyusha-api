import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  absoluteMediaUrl,
  buildOrderReceiptMail,
  resolveLocalImagePath,
} from '../../src/mail/order-receipt';

describe('order-receipt', () => {
  describe('absoluteMediaUrl', () => {
    it('joins relative paths and keeps absolute URLs', () => {
      expect(absoluteMediaUrl('https://shop.test', '/uploads/a.png')).toBe(
        'https://shop.test/uploads/a.png',
      );
      expect(absoluteMediaUrl('https://shop.test/', 'uploads/a.png')).toBe(
        'https://shop.test/uploads/a.png',
      );
      expect(
        absoluteMediaUrl('https://shop.test', 'https://cdn.test/x.png'),
      ).toBe('https://cdn.test/x.png');
      expect(absoluteMediaUrl('https://shop.test', '  ')).toBe('');
    });
  });

  describe('buildOrderReceiptMail', () => {
    it('builds paid order receipt with items and optional login invite', () => {
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

    it('uses оформлен wording when unpaid', () => {
      const mail = buildOrderReceiptMail({
        orderId: 'abcdefghijklmnop',
        total: 100,
        webOrigin: 'https://shop.test',
        needsLogin: false,
        paid: false,
        items: [],
      });
      expect(mail.text).toContain('оформлен');
      expect(mail.text).not.toContain('оплачен');
    });
  });

  describe('resolveLocalImagePath + cid attachments', () => {
    it('embeds local product images as cid attachments', () => {
      const dir = join(tmpdir(), `agny-mail-${Date.now()}`);
      const uploads = join(dir, 'uploads');
      const assets = join(dir, 'public', 'assets');
      mkdirSync(uploads, { recursive: true });
      mkdirSync(assets, { recursive: true });
      const png = Buffer.from(
        'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
        'base64',
      );
      writeFileSync(join(uploads, 'a.png'), png);
      writeFileSync(join(assets, 'b.png'), png);

      try {
        expect(
          resolveLocalImagePath('/uploads/a.png', { uploadsDir: uploads }),
        ).toBe(join(uploads, 'a.png'));
        expect(
          resolveLocalImagePath('/assets/b.png', {
            webPublicDir: join(dir, 'public'),
          }),
        ).toBe(join(assets, 'b.png'));
        expect(
          resolveLocalImagePath('/uploads/../secret', { uploadsDir: uploads }),
        ).toBeNull();
        expect(
          resolveLocalImagePath('https://cdn.test/x.png', {
            uploadsDir: uploads,
          }),
        ).toBeNull();

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
});
