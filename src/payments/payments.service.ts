import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryMethodCode, OrderStatus } from '@prisma/client';
import { createHmac, timingSafeEqual } from 'crypto';
import { PrismaService } from '../prisma/prisma.service';
import { CdekService } from '../cdek/cdek.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';
import { PochtaService, pochtaTrackingUrl } from '../pochta/pochta.service';
import { SlidingWindowRateLimiter } from '../common/rate-limit';
import { resolveWeightGrams } from '../common/weight';
import { formatPersonName } from '../common/person-name';
import { resolvePublicWebUrl } from '../common/web-origin';
import { MAIL_SEND, type MailSend } from '../mail/mail.tokens';
import { buildOrderReceiptMail } from '../mail/order-receipt';
import { parseOzonNotification } from './ozon-notification.util';

function cdekTrackingUrl(trackNumber: string) {
  return `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(trackNumber)}`;
}

export type OzonPaymentLine = {
  extId: string;
  name: string;
  priceRub: number;
  qty: number;
};

export type OzonCreatePaymentResult = {
  payLink: string;
  paymentExternalId: string;
};

@Injectable()
export class PaymentsService {
  private readonly logger = new Logger(PaymentsService.name);
  private readonly confirmLimiter = new SlidingWindowRateLimiter(20, 60_000);
  /** Last Ozon reconcile attempt per order id (in-memory TTL). */
  private readonly paymentReconcileAt = new Map<string, number>();
  private static readonly RECONCILE_TTL_MS = 45_000;
  private static readonly RECONCILE_MAX_PER_CALL = 3;

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly yandex: YandexDeliveryService,
    private readonly cdek: CdekService,
    private readonly pochta: PochtaService,
    @Inject(MAIL_SEND) private readonly sendMail: MailSend,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.accessKey());
  }

  /**
   * Health probe: verify credentials shape against Ozon API.
   * Uses getOrderDetails with a sentinel id — auth failures vs missing order
   * distinguish bad keys from healthy API reachability.
   */
  async ping(): Promise<{ ok: boolean; message: string }> {
    const accessKey = this.accessKey();
    if (!accessKey) {
      return { ok: false, message: 'OZON_PAY_ACCESS_KEY не задан' };
    }

    const res = await fetch(`${this.apiBase()}/getOrderDetails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        accessKey,
        orderNumber: '__agnyusha_health_probe__',
      }),
    });

    // Reachable API with valid key typically returns 4xx for unknown order.
    // 401/403 → bad credentials. Network errors throw above.
    if (res.status === 401 || res.status === 403) {
      return { ok: false, message: `Ozon Pay отклонил ключ (${res.status})` };
    }
    if (res.status >= 500) {
      return { ok: false, message: `Ozon Pay недоступен (${res.status})` };
    }
    return {
      ok: true,
      message: `API отвечает (HTTP ${res.status})`,
    };
  }

  private accessKey() {
    return (this.config.get<string>('OZON_PAY_ACCESS_KEY') ?? '').trim();
  }

  private apiBase() {
    return (
      this.config.get<string>('OZON_PAY_API_URL') ?? 'https://payapi.ozon.ru/v1'
    )
      .trim()
      .replace(/\/$/, '');
  }

  private publicWebUrl() {
    return resolvePublicWebUrl(this.config);
  }

  /** Amount in kopecks for Ozon Pay. */
  private toKopecks(rub: number): number {
    return Math.max(0, Math.round(Number(rub) * 100));
  }

  async createPayment(input: {
    orderId: string;
    totalRub: number;
    items: OzonPaymentLine[];
  }): Promise<OzonCreatePaymentResult> {
    const accessKey = this.accessKey();
    if (!accessKey) {
      throw new BadRequestException('Ozon Pay не настроен');
    }

    const totalKop = this.toKopecks(input.totalRub);
    if (totalKop < 100) {
      throw new BadRequestException(
        'Минимальная сумма оплаты через Ozon Pay — 1 ₽',
      );
    }

    const web = this.publicWebUrl();
    const payload = {
      accessKey,
      amount: { currencyCode: '643', value: totalKop },
      enableFiscalization: false,
      extId: input.orderId,
      fiscalizationType: 'FISCAL_TYPE_SINGLE',
      paymentAlgorithm: 'PAY_ALGO_SMS',
      successUrl: `${web}/payment/success?orderId=${encodeURIComponent(input.orderId)}`,
      failUrl: `${web}/payment/fail?orderId=${encodeURIComponent(input.orderId)}`,
      notificationUrl: `${web}/api/payments/ozon/webhook`,
      items: input.items.map((item) => ({
        extId: item.extId,
        name: item.name.slice(0, 128),
        needMark: false,
        price: {
          currencyCode: '643',
          value: this.toKopecks(item.priceRub),
        },
        quantity: item.qty,
        type: 'TYPE_PRODUCT',
        unitType: 'UNIT_PIECE',
        vat: 'VAT_NONE',
      })),
    };

    const res = await fetch(`${this.apiBase()}/createOrder`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const raw = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!res.ok) {
      this.logger.warn(
        `Ozon createOrder failed status=${res.status} body=${JSON.stringify(raw)}`,
      );
      throw new BadRequestException('Не удалось создать платёж Ozon Pay');
    }

    const order =
      raw && typeof raw.order === 'object' && raw.order
        ? (raw.order as Record<string, unknown>)
        : null;
    const payLink = typeof order?.payLink === 'string' ? order.payLink : null;
    const paymentExternalId = typeof order?.id === 'string' ? order.id : null;

    if (!payLink || !paymentExternalId) {
      this.logger.warn(
        `Ozon createOrder missing payLink/id: ${JSON.stringify(raw)}`,
      );
      throw new BadRequestException('Ozon Pay вернул неполный ответ');
    }

    return { payLink, paymentExternalId };
  }

  /**
   * Reconcile local order with Ozon getOrderDetails.
   * Used when webhook is delayed/blocked (e.g. free ngrok interstitial).
   */
  async confirmPaidByOrderId(
    orderId: string,
    clientKey: string,
  ): Promise<{ status: string; paid: boolean }> {
    if (!this.confirmLimiter.tryConsume(clientKey || 'anon')) {
      throw new BadRequestException('Слишком много запросов, подождите');
    }

    const id = orderId.trim();
    if (!id) throw new BadRequestException('Укажите orderId');

    const order = await this.prisma.order.findUnique({ where: { id } });
    if (!order) throw new NotFoundException('Заказ не найден');

    if (order.paidAt || order.status === OrderStatus.PAID) {
      // Retry shipment create if pay succeeded but CDEK/Yandex failed earlier.
      if (!order.externalDeliveryId) {
        await this.markOrderPaid(id, order.paymentExternalId);
      }
      const updated = await this.prisma.order.findUnique({ where: { id } });
      return {
        status: updated?.status ?? order.status,
        paid: true,
      };
    }

    if (!this.isConfigured()) {
      return { status: order.status, paid: false };
    }

    const details = await this.fetchOzonOrderDetails(id);
    if (!details) {
      return { status: order.status, paid: false };
    }

    if (!this.isPaidStatus(details.status)) {
      this.logger.log(
        `Ozon confirm order=${id} still status=${details.status}`,
      );
      return { status: order.status, paid: false };
    }

    await this.markOrderPaid(id, details.id);
    const updated = await this.prisma.order.findUnique({ where: { id } });
    return {
      status: updated?.status ?? OrderStatus.PAID,
      paid: true,
    };
  }

  private async fetchOzonOrderDetails(extId: string): Promise<{
    id: string | null;
    status: string;
    payLink: string | null;
  } | null> {
    const accessKey = this.accessKey();
    if (!accessKey) return null;

    const res = await fetch(`${this.apiBase()}/getOrderDetails`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accessKey, extId }),
    });
    const raw = (await res.json().catch(() => null)) as Record<
      string,
      unknown
    > | null;

    if (!res.ok) {
      this.logger.warn(
        `Ozon getOrderDetails failed status=${res.status} body=${JSON.stringify(raw)}`,
      );
      return null;
    }

    const item =
      raw && typeof raw.item === 'object' && raw.item
        ? (raw.item as Record<string, unknown>)
        : null;
    const status = this.asString(item?.status);
    if (!status) return null;

    return {
      id: this.asString(item?.id),
      status,
      payLink: this.asString(item?.payLink),
    };
  }

  /** Fresh pay link for an unpaid order (from Ozon getOrderDetails). */
  async resolvePayLink(extId: string): Promise<string | null> {
    const details = await this.fetchOzonOrderDetails(extId);
    if (!details) return null;
    if (this.isPaidStatus(details.status)) return null;
    return details.payLink;
  }

  /**
   * Best-effort sync for unpaid NEW orders (missed webhook / AUTHORIZED race).
   * Only checks orders past TTL, at most RECONCILE_MAX_PER_CALL per call.
   * Returns ids that transitioned to paid.
   */
  async reconcileUnpaidOrdersForUser(
    userId: string,
    orderIds?: string[],
  ): Promise<string[]> {
    if (!this.isConfigured()) return [];

    const candidates = await this.prisma.order.findMany({
      where: {
        userId,
        status: OrderStatus.NEW,
        paidAt: null,
        OR: [
          { paymentExternalId: { not: null } },
          { paymentPayLink: { not: null } },
        ],
        ...(orderIds?.length ? { id: { in: orderIds } } : {}),
      },
      select: { id: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });

    const now = Date.now();
    const due = candidates
      .filter((order) => {
        const last = this.paymentReconcileAt.get(order.id) ?? 0;
        return now - last >= PaymentsService.RECONCILE_TTL_MS;
      })
      .slice(0, PaymentsService.RECONCILE_MAX_PER_CALL);

    if (due.length === 0) return [];

    const paidIds: string[] = [];
    await Promise.all(
      due.map(async (order) => {
        this.paymentReconcileAt.set(order.id, now);
        try {
          const details = await this.fetchOzonOrderDetails(order.id);
          if (!details) return;
          if (!this.isPaidStatus(details.status)) {
            this.logger.log(
              `Ozon reconcile order=${order.id} still status=${details.status}`,
            );
            return;
          }
          await this.markOrderPaid(order.id, details.id);
          paidIds.push(order.id);
        } catch (err) {
          this.logger.warn(
            `Ozon reconcile failed for ${order.id}: ${
              err instanceof Error ? err.message : 'unknown'
            }`,
          );
        }
      }),
    );

    return paidIds;
  }

  async handleOzonNotification(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ ok: true }> {
    const parsed = parseOzonNotification(body);
    let extId = parsed.extId;
    let ozonId = parsed.ozonId;
    const status = parsed.status;

    this.logger.log(
      `Ozon Pay notification${extId ? ` order=${extId}` : ''}${
        ozonId ? ` ozonId=${ozonId}` : ''
      }${status ? ` status=${status}` : ''} keys=${parsed.keys.join(',') || '-'} headers=${Object.keys(
        headers,
      )
        .map((k) => k.toLowerCase())
        .sort()
        .join(',')}`,
    );

    const auth = this.resolveNotificationAuth(headers, body);
    if (auth === 'mismatch') {
      this.logger.warn(
        `Ozon webhook auth failed; header keys=${Object.keys(headers)
          .map((k) => k.toLowerCase())
          .sort()
          .join(',')}`,
      );
      throw new UnauthorizedException('Неверная подпись уведомления');
    }

    // Secret configured but Ozon sent no auth material → must be able to
    // verify via API access key (even if we cannot resolve the order yet).
    if (auth === 'absent' && !this.accessKey()) {
      this.logger.warn(
        'Ozon webhook has no auth material and OZON_PAY_ACCESS_KEY is empty',
      );
      throw new UnauthorizedException('Неверная подпись уведомления');
    }

    const resolved = await this.resolveOrderIdFromNotification(extId, ozonId);
    if (!resolved) {
      this.logger.warn(
        `Ozon webhook could not resolve local order (extId=${extId ?? '-'} ozonId=${ozonId ?? '-'} keys=${parsed.keys.join(',') || '-'})`,
      );
      return { ok: true };
    }
    extId = resolved.orderId;
    ozonId = resolved.ozonId;

    // Ozon often sends webhooks without a notification secret header (only
    // x-o3-trace). Prefer explicit paid status from the payload; otherwise
    // confirm via getOrderDetails (covers AUTHORIZED → PAID lag).
    if (auth === 'absent') {
      if (status && this.isPaidStatus(status)) {
        await this.markOrderPaid(extId, ozonId);
        return { ok: true };
      }
      const details = await this.fetchOzonOrderDetails(extId);
      if (details && this.isPaidStatus(details.status)) {
        await this.markOrderPaid(extId, details.id ?? ozonId);
      } else {
        this.logger.warn(
          `Ozon webhook for ${extId}: no signature; API status=${details?.status ?? 'unknown'} webhookStatus=${status ?? 'unknown'}`,
        );
      }
      return { ok: true };
    }

    if (status && this.isPaidStatus(status)) {
      await this.markOrderPaid(extId, ozonId);
    } else {
      const details = await this.fetchOzonOrderDetails(extId);
      if (details && this.isPaidStatus(details.status)) {
        await this.markOrderPaid(extId, details.id ?? ozonId);
      }
    }

    return { ok: true };
  }

  /** Resolve our order id from webhook extId and/or stored Ozon payment id. */
  private async resolveOrderIdFromNotification(
    extId: string | null,
    ozonId: string | null,
  ): Promise<{ orderId: string; ozonId: string | null } | null> {
    if (extId) {
      const byExt = await this.prisma.order.findUnique({
        where: { id: extId },
        select: { id: true, paymentExternalId: true },
      });
      if (byExt) {
        return {
          orderId: byExt.id,
          ozonId: ozonId ?? byExt.paymentExternalId,
        };
      }
    }

    if (ozonId) {
      const byPay = await this.prisma.order.findFirst({
        where: { paymentExternalId: ozonId },
        select: { id: true, paymentExternalId: true },
        orderBy: { createdAt: 'desc' },
      });
      if (byPay) {
        return {
          orderId: byPay.id,
          ozonId: byPay.paymentExternalId ?? ozonId,
        };
      }
    }

    return null;
  }

  private isPaidStatus(status: string) {
    const normalized = status.toUpperCase().replace(/^STATUS_/, '');
    return (
      normalized === 'PAID' ||
      normalized === 'PAYMENT_CONFIRMED' ||
      normalized === 'COMPLETED' ||
      status === 'STATUS_PAID' ||
      status === 'PAYMENT_CONFIRMED'
    );
  }

  private asString(value: unknown): string | null {
    return typeof value === 'string' && value.trim() ? value.trim() : null;
  }

  private async notifyOrderPaid(order: {
    id: string;
    email: string;
    total: number;
    items: Array<{
      productName: string;
      weight: string;
      price: number;
      qty: number;
      image: string;
    }>;
    user?: { emailVerifiedAt: Date | null } | null;
  }) {
    const mail = buildOrderReceiptMail({
      orderId: order.id,
      total: order.total,
      items: order.items,
      webOrigin: this.publicWebUrl(),
      needsLogin: !order.user?.emailVerifiedAt,
      paid: true,
    });
    try {
      await this.sendMail({
        to: order.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments,
      });
    } catch (err) {
      this.logger.warn(
        `Paid order mail failed for ${order.id}: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
    }
  }

  private async markOrderPaid(extId: string, ozonId: string | null) {
    const order = await this.prisma.order.findUnique({
      where: { id: extId },
      include: {
        items: true,
        user: { select: { emailVerifiedAt: true } },
      },
    });
    if (!order) {
      this.logger.warn(`Ozon paid notification for unknown order ${extId}`);
      return;
    }

    const alreadyPaid = Boolean(order.paidAt);
    if (alreadyPaid && order.externalDeliveryId) {
      return;
    }

    let externalDeliveryId = order.externalDeliveryId;
    let deliveryTrackNumber = order.deliveryTrackNumber;
    let deliveryTrackingUrl = order.deliveryTrackingUrl;

    if (
      order.status !== OrderStatus.CANCELLED &&
      order.deliveryCode === DeliveryMethodCode.YANDEX &&
      order.pickupCode &&
      !externalDeliveryId &&
      this.yandex.isOrderCreationConfigured()
    ) {
      try {
        const yandexOrder = await this.yandex.createPickupOrder({
          requestId: `agny-pay-${order.id.slice(-10)}-${Date.now().toString(36)}`,
          pickupPointId: order.pickupCode,
          phone: order.phone,
          recipientName: formatPersonName(order),
          comment: `Заказ Агнюша · ${order.cityLabel}`,
          items: order.items.map((item) => ({
            name: item.productName,
            article: item.variantId ?? item.id,
            price: item.price,
            qty: item.qty,
            weightGrams: resolveWeightGrams(item.weightGrams, item.weight),
          })),
        });
        externalDeliveryId = yandexOrder.requestId;
        deliveryTrackNumber = deliveryTrackNumber || yandexOrder.requestId;
        this.logger.log(
          `Yandex shipment after pay for ${order.id}: requestId=${externalDeliveryId}`,
        );
      } catch (err) {
        this.logger.error(
          `Yandex create after pay failed for ${order.id}: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        );
      }
    }

    if (
      order.status !== OrderStatus.CANCELLED &&
      order.deliveryCode === DeliveryMethodCode.CDEK &&
      order.pickupCode &&
      !externalDeliveryId &&
      this.cdek.isOrderCreationConfigured()
    ) {
      try {
        const cdekOrder = await this.cdek.createPickupOrder({
          orderNumber: `agny-pay-${order.id.slice(-12)}`,
          deliveryPointCode: order.pickupCode,
          phone: order.phone,
          recipientName: formatPersonName(order),
          comment: `Заказ Агнюша · ${order.cityLabel}`,
          items: order.items.map((item) => ({
            name: item.productName,
            wareKey: item.variantId ?? item.id,
            price: item.price,
            qty: item.qty,
            weightGrams: resolveWeightGrams(item.weightGrams, item.weight),
          })),
        });
        externalDeliveryId = cdekOrder.uuid;
        deliveryTrackNumber = cdekOrder.cdekNumber || deliveryTrackNumber;
        deliveryTrackingUrl = cdekOrder.cdekNumber
          ? cdekTrackingUrl(cdekOrder.cdekNumber)
          : deliveryTrackingUrl;
        this.logger.log(
          `CDEK shipment after pay for ${order.id}: uuid=${externalDeliveryId}` +
            (cdekOrder.cdekNumber ? ` track=${cdekOrder.cdekNumber}` : ''),
        );
      } catch (err) {
        this.logger.error(
          `CDEK create after pay failed for ${order.id}: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        );
      }
    }

    if (
      order.status !== OrderStatus.CANCELLED &&
      order.deliveryCode === DeliveryMethodCode.POST &&
      order.pickupCode &&
      !externalDeliveryId &&
      this.pochta.isOrderCreationConfigured()
    ) {
      try {
        const pochtaOrder = await this.pochta.createPickupOrder({
          orderNumber: `agny-pay-${order.id.slice(-12)}`,
          deliveryPointCode: order.pickupCode,
          phone: order.phone,
          recipientName: formatPersonName(order),
          lastName: order.lastName,
          firstName: order.firstName,
          middleName: order.middleName ?? undefined,
          comment: `Заказ Агнюша · ${order.cityLabel}`,
          cityLabel: order.cityLabel,
          items: order.items.map((item) => ({
            name: item.productName,
            wareKey: item.variantId ?? item.id,
            price: item.price,
            qty: item.qty,
            weightGrams: resolveWeightGrams(item.weightGrams, item.weight),
          })),
        });
        externalDeliveryId = pochtaOrder.orderId;
        deliveryTrackNumber = pochtaOrder.barcode || deliveryTrackNumber;
        deliveryTrackingUrl = pochtaOrder.barcode
          ? pochtaTrackingUrl(pochtaOrder.barcode)
          : deliveryTrackingUrl;
        this.logger.log(
          `Pochta shipment after pay for ${order.id}: id=${externalDeliveryId}` +
            (pochtaOrder.barcode ? ` track=${pochtaOrder.barcode}` : ''),
        );
      } catch (err) {
        this.logger.error(
          `Pochta create after pay failed for ${order.id}: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        );
      }
    }

    const deliveryChanged =
      externalDeliveryId !== order.externalDeliveryId ||
      deliveryTrackNumber !== order.deliveryTrackNumber ||
      deliveryTrackingUrl !== order.deliveryTrackingUrl;

    if (alreadyPaid && !deliveryChanged) {
      return;
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        // Do not downgrade CONFIRMED/SHIPPED/DONE back to PAID.
        status:
          order.status === OrderStatus.NEW || order.status === OrderStatus.PAID
            ? OrderStatus.PAID
            : order.status,
        paidAt: order.paidAt ?? new Date(),
        paymentExternalId: ozonId ?? order.paymentExternalId,
        externalDeliveryId,
        deliveryTrackNumber,
        deliveryTrackingUrl,
      },
    });
    if (!alreadyPaid) {
      this.logger.log(`Order ${order.id} marked PAID`);
      await this.notifyOrderPaid(order);
    } else if (deliveryChanged) {
      this.logger.log(
        `Order ${order.id} shipment backfilled after pay (externalDeliveryId=${externalDeliveryId})`,
      );
    }
  }

  /**
   * Ozon notification auth:
   * - no secret configured → match (open webhook; tests / local)
   * - secret matches header/body/HMAC → match
   * - secret set but Ozon sent no auth material → absent (verify via API)
   * - secret set and wrong auth material → mismatch
   */
  private resolveNotificationAuth(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ): 'match' | 'absent' | 'mismatch' {
    const secret = (
      this.config.get<string>('OZON_PAY_NOTIFICATION_SECRET') ?? ''
    ).trim();
    if (!secret) return 'match';

    const candidates: string[] = [];
    const headerNames = [
      'x-ozon-notification-secret',
      'x-notification-secret',
      'notification-secret',
      'x-o3-notification-secret',
      'authorization',
      'access-token',
      'x-access-token',
      'x-api-key',
    ];
    for (const name of headerNames) {
      const headerVal = headers[name] ?? headers[name.toLowerCase()];
      const provided = Array.isArray(headerVal) ? headerVal[0] : headerVal;
      if (typeof provided === 'string' && provided.trim()) {
        candidates.push(provided.trim());
        if (provided.toLowerCase().startsWith('bearer ')) {
          candidates.push(provided.slice(7).trim());
        }
      }
    }

    const collectSecretFields = (value: unknown, depth = 0) => {
      if (!value || typeof value !== 'object' || depth > 2) return;
      const obj = value as Record<string, unknown>;
      for (const key of [
        'notificationSecret',
        'notification_secret',
        'secret',
      ]) {
        const v = obj[key];
        if (typeof v === 'string' && v.trim()) candidates.push(v.trim());
      }
      for (const nestedKey of ['order', 'item', 'data', 'payload']) {
        if (nestedKey in obj) collectSecretFields(obj[nestedKey], depth + 1);
      }
    };
    collectSecretFields(body);

    if (candidates.some((c) => c === secret)) return 'match';

    const sigHeaderNames = [
      'x-signature',
      'x-ozon-signature',
      'x-o3-signature',
      'signature',
    ];
    let sig: string | undefined;
    for (const name of sigHeaderNames) {
      const headerVal = headers[name] ?? headers[name.toLowerCase()];
      const provided = Array.isArray(headerVal) ? headerVal[0] : headerVal;
      if (typeof provided === 'string' && provided.trim()) {
        sig = provided.trim();
        break;
      }
    }
    if (sig) {
      const raw = typeof body === 'string' ? body : JSON.stringify(body ?? {});
      const expected = createHmac('sha256', secret).update(raw).digest('hex');
      const normalized = sig.replace(/^sha256=/i, '');
      const a = Buffer.from(normalized);
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) return 'match';
      return 'mismatch';
    }

    if (candidates.length > 0) return 'mismatch';
    return 'absent';
  }
}