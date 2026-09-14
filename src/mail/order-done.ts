function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export type OrderDoneMailInput = {
  orderNumber: number;
  webOrigin: string;
  pickupLabel: string | null;
  deliveryTitle: string;
  cityLabel: string;
};

export function buildOrderDoneMail(input: OrderDoneMailInput): {
  subject: string;
  html: string;
  text: string;
} {
  const origin = input.webOrigin.replace(/\/$/, '');
  const accountUrl = `${origin}/account`;
  const place =
    input.pickupLabel?.trim() ||
    `${input.deliveryTitle}${input.cityLabel ? ` · ${input.cityLabel}` : ''}`;

  const subject = `Заказ Агнюша №${input.orderNumber} готов к получению`;
  const text = [
    `Заказ №${input.orderNumber} завершён.`,
    `Можно забирать: ${place}.`,
    `Личный кабинет: ${accountUrl}`,
  ].join('\n');

  const html = `<!DOCTYPE html>
<html lang="ru">
<head><meta charset="utf-8"/><meta name="viewport" content="width=device-width"/></head>
<body style="margin:0;padding:0;background:#f6f3ee;font-family:Georgia,'Times New Roman',serif;color:#1a1a1a;">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:#f6f3ee;padding:32px 16px;">
    <tr><td align="center">
      <table role="presentation" width="100%" style="max-width:560px;background:#fffdf8;border:1px solid #e5dfd3;border-radius:24px;overflow:hidden;">
        <tr><td style="padding:28px 28px 8px;background:#2f5d4a;color:#fff;">
          <p style="margin:0;font-size:13px;letter-spacing:0.08em;text-transform:uppercase;opacity:0.85;">Агнюша</p>
          <h1 style="margin:8px 0 0;font-size:26px;font-weight:700;line-height:1.25;">Заказ готов к получению</h1>
        </td></tr>
        <tr><td style="padding:24px 28px;">
          <p style="margin:0 0 12px;font-size:16px;line-height:1.5;">
            Заказ <strong>№${escapeHtml(String(input.orderNumber))}</strong> отмечен как завершённый.
          </p>
          <p style="margin:0 0 20px;font-size:15px;line-height:1.55;color:#444;">
            Заберите посылку здесь:<br/>
            <strong style="color:#1a1a1a;">${escapeHtml(place)}</strong>
          </p>
          <p style="margin:0 0 28px;">
            <a href="${escapeHtml(accountUrl)}" style="display:inline-block;background:#2f5d4a;color:#fff;text-decoration:none;padding:12px 22px;border-radius:999px;font-size:15px;font-weight:600;">
              Открыть заказ в кабинете
            </a>
          </p>
          <p style="margin:0;font-size:13px;color:#777;line-height:1.45;">
            Если возникнут вопросы по получению — ответьте на это письмо или напишите нам через сайт.
          </p>
        </td></tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

  return { subject, html, text };
}
