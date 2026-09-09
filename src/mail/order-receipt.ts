import { existsSync, readFileSync } from 'node:fs';
import { basename, extname, join } from 'node:path';

export type OrderReceiptItem = {
  productName: string;
  weight: string;
  price: number;
  qty: number;
  image: string;
};

export type OrderReceiptMailAttachment = {
  filename: string;
  /** Base64-encoded file bytes for Resend. */
  content: string;
  contentId: string;
  contentType: string;
};

export type OrderReceiptMailInput = {
  orderId: string;
  total: number;
  items: OrderReceiptItem[];
  webOrigin: string;
  /** Soft invite to log in / verify email (guest or unverified). */
  needsLogin: boolean;
  /** When false, wording is "оформлен" (no payment gateway). */
  paid: boolean;
  /** Absolute path to storefront `public/` (for `/assets/...` images). */
  webPublicDir?: string;
  /** Absolute path to API uploads directory (for `/uploads/...` images). */
  uploadsDir?: string;
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function absoluteMediaUrl(webOrigin: string, image: string): string {
  const trimmed = image.trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  const base = webOrigin.replace(/\/$/, '');
  return trimmed.startsWith('/') ? `${base}${trimmed}` : `${base}/${trimmed}`;
}

function contentTypeFor(filename: string): string {
  switch (extname(filename).toLowerCase()) {
    case '.jpg':
    case '.jpeg':
      return 'image/jpeg';
    case '.png':
      return 'image/png';
    case '.webp':
      return 'image/webp';
    case '.gif':
      return 'image/gif';
    case '.svg':
      return 'image/svg+xml';
    default:
      return 'application/octet-stream';
  }
}

/** Resolve product image path on disk (uploads or storefront public assets). */
export function resolveLocalImagePath(
  image: string,
  options?: { webPublicDir?: string; uploadsDir?: string },
): string | null {
  const trimmed = image.trim();
  if (!trimmed || /^https?:\/\//i.test(trimmed)) return null;

  const rel = trimmed.replace(/^\/+/, '').replace(/\\/g, '/');
  // Reject path traversal.
  if (!rel || rel.includes('..')) return null;

  if (rel.startsWith('uploads/')) {
    const uploadsRoot = options?.uploadsDir ?? join(process.cwd(), 'uploads');
    return join(uploadsRoot, rel.slice('uploads/'.length));
  }

  if (rel.startsWith('assets/')) {
    const webPublic =
      options?.webPublicDir ??
      join(process.cwd(), '..', 'agnyusha-web', 'public');
    return join(webPublic, rel);
  }

  return null;
}

function formatRub(amount: number): string {
  return `${Math.round(amount)} ₽`;
}

export function buildOrderReceiptMail(input: OrderReceiptMailInput): {
  subject: string;
  text: string;
  html: string;
  attachments: OrderReceiptMailAttachment[];
} {
  const shortId = input.orderId.slice(-6).toUpperCase();
  const ordersUrl = `${input.webOrigin.replace(/\/$/, '')}/account/orders`;
  const statusPhrase = input.paid ? 'оплачен' : 'оформлен';
  const totalLabel = formatRub(input.total);

  const itemLines = input.items.map((item) => {
    const lineTotal = formatRub(item.price * item.qty);
    return `• ${item.productName} (${item.weight}) × ${item.qty} — ${lineTotal}`;
  });

  const loginText = input.needsLogin
    ? `\n\nЧтобы видеть заказы в личном кабинете, войдите на сайте по этому email:\n${ordersUrl}`
    : '';

  const text = [
    `Заказ Агнюша №${shortId} ${statusPhrase} на сумму ${totalLabel}.`,
    '',
    'Состав заказа:',
    ...itemLines,
    loginText,
  ]
    .filter((line) => line !== '')
    .join('\n')
    .trim();

  const attachments: OrderReceiptMailAttachment[] = [];
  const cidByPath = new Map<string, string>();

  const rowsHtml = input.items
    .map((item, index) => {
      let src = absoluteMediaUrl(input.webOrigin, item.image);
      const localPath = resolveLocalImagePath(item.image, {
        webPublicDir: input.webPublicDir,
        uploadsDir: input.uploadsDir,
      });
      if (localPath && existsSync(localPath)) {
        let contentId = cidByPath.get(localPath);
        if (!contentId) {
          contentId = `item-${attachments.length}-${index}`;
          const filename = basename(localPath) || `item-${index}.png`;
          attachments.push({
            filename,
            content: readFileSync(localPath).toString('base64'),
            contentId,
            contentType: contentTypeFor(filename),
          });
          cidByPath.set(localPath, contentId);
        }
        src = `cid:${contentId}`;
      }

      const name = escapeHtml(item.productName);
      const weight = escapeHtml(item.weight);
      const lineTotal = escapeHtml(formatRub(item.price * item.qty));
      const img = src
        ? `<img src="${escapeHtml(src)}" alt="" width="180" height="180" style="display:block;border-radius:14px;object-fit:cover;border:0;" />`
        : '';
      return `<tr>
  <td style="padding:12px 20px 12px 0;vertical-align:top;width:180px;">${img}</td>
  <td style="padding:10px 0;vertical-align:top;font-family:Arial,sans-serif;font-size:17px;line-height:1.45;color:#222;text-align:left;">
    <div style="font-weight:700;font-size:18px;">${name}</div>
    <div style="color:#666;margin-top:4px;">${weight} × ${item.qty}</div>
    <div style="margin-top:6px;font-weight:600;">${lineTotal}</div>
  </td>
</tr>`;
    })
    .join('\n');

  const loginHtml = input.needsLogin
    ? `<p style="margin:20px 0 0;font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#222;text-align:left;">Чтобы видеть заказы в личном кабинете, <a href="${escapeHtml(ordersUrl)}">войдите на сайте</a> по этому email.</p>`
    : '';

  const html = `<div style="width:100%;margin:0;padding:0;text-align:left;">
<p style="margin:0;font-family:Arial,sans-serif;font-size:20px;line-height:1.45;color:#222;text-align:left;">Заказ <strong>№${escapeHtml(shortId)}</strong> ${statusPhrase} на сумму <strong>${escapeHtml(totalLabel)}</strong>.</p>
<p style="margin:28px 0 10px;font-family:Arial,sans-serif;font-size:18px;font-weight:700;color:#222;text-align:left;">Состав заказа</p>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" align="left" style="width:100%;max-width:640px;border-collapse:collapse;margin:0;text-align:left;">
${rowsHtml}
</table>
${loginHtml}
</div>`;

  return {
    subject: `Заказ Агнюша №${shortId}`,
    text,
    html,
    attachments,
  };
}
