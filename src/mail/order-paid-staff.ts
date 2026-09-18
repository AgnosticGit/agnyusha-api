function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type PaidOrderStaffNotifyInput = {
  orderNumber: number;
  total: number;
  customerEmail: string;
  customerName: string;
  phone: string;
  deliveryTitle: string;
  cityLabel: string;
  webOrigin: string;
  items: Array<{ productName: string; weight: string; qty: number; price: number }>;
};

/** Staff alert: a customer order was just marked paid. */
export function buildPaidOrderStaffNotifyMail(input: PaidOrderStaffNotifyInput): {
  subject: string;
  text: string;
  html: string;
} {
  const origin = input.webOrigin.replace(/\/$/, '');
  const adminUrl = `${origin}/admin/orders`;
  const total = input.total.toLocaleString('ru-RU');
  const lines = input.items.map(
    (i) =>
      `• ${i.productName} (${i.weight}) × ${i.qty} — ${(i.price * i.qty).toLocaleString('ru-RU')} ₽`,
  );

  const subject = `Оплачен заказ №${input.orderNumber}`;
  const text = [
    `Оплачен новый заказ №${input.orderNumber}.`,
    `Сумма: ${total} ₽`,
    `Покупатель: ${input.customerName}`,
    `Email: ${input.customerEmail}`,
    `Телефон: ${input.phone}`,
    `Доставка: ${input.deliveryTitle}${input.cityLabel ? ` · ${input.cityLabel}` : ''}`,
    '',
    'Состав:',
    ...lines,
    '',
    `Админка: ${adminUrl}`,
  ].join('\n');

  const htmlLines = input.items
    .map(
      (i) =>
        `<li style="margin:0 0 6px;">${escapeHtml(i.productName)} (${escapeHtml(i.weight)}) × ${i.qty} — ${(i.price * i.qty).toLocaleString('ru-RU')}&nbsp;₽</li>`,
    )
    .join('');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:#f6f3ee;font-family:Arial,sans-serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f3ee;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fff;border-radius:16px;padding:28px 24px;border:1px solid #e8e2d8;">
        <tr><td>
          <p style="margin:0 0 8px;font-size:14px;color:#6b6b6b;">Агнюша · уведомление магазину</p>
          <h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;">Оплачен заказ №${input.orderNumber}</h1>
          <p style="margin:0 0 8px;font-size:16px;"><strong>Сумма:</strong> ${escapeHtml(total)}&nbsp;₽</p>
          <p style="margin:0 0 8px;font-size:16px;"><strong>Покупатель:</strong> ${escapeHtml(input.customerName)}</p>
          <p style="margin:0 0 8px;font-size:16px;"><strong>Email:</strong> ${escapeHtml(input.customerEmail)}</p>
          <p style="margin:0 0 8px;font-size:16px;"><strong>Телефон:</strong> ${escapeHtml(input.phone)}</p>
          <p style="margin:0 0 16px;font-size:16px;"><strong>Доставка:</strong> ${escapeHtml(input.deliveryTitle)}${input.cityLabel ? ` · ${escapeHtml(input.cityLabel)}` : ''}</p>
          <p style="margin:0 0 8px;font-size:16px;font-weight:700;">Состав</p>
          <ul style="margin:0 0 20px;padding-left:20px;font-size:15px;line-height:1.45;">${htmlLines}</ul>
          <p style="margin:0;"><a href="${escapeHtml(adminUrl)}" style="display:inline-block;background:#2f6b3a;color:#fff;text-decoration:none;padding:12px 18px;border-radius:999px;font-size:15px;">Открыть заказы</a></p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, text, html };
}
