import {
  BadRequestException,
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
import { SlidingWindowRateLimiter } from '../common/rate-limit';

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

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly yandex: YandexDeliveryService,
    private readonly cdek: CdekService,
  ) {}

  isConfigured(): boolean {
    return Boolean(this.accessKey());
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
    const fromEnv = (this.config.get<string>('PUBLIC_WEB_URL') ?? '').trim();
    if (fromEnv) return fromEnv.replace(/\/$/, '');
    const cors = (this.config.get<string>('CORS_ORIGIN') ?? '')
      .split(',')[0]
      ?.trim();
    return (cors || 'http://localhost:3000').replace(/\/$/, '');
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
      return { status: order.status, paid: true };
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

  private async fetchOzonOrderDetails(
    extId: string,
  ): Promise<{ id: string | null; status: string; payLink: string | null } | null> {
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

  async handleOzonNotification(
    body: unknown,
    headers: Record<string, string | string[] | undefined>,
  ): Promise<{ ok: true }> {
    const payload =
      body && typeof body === 'object'
        ? (body as Record<string, unknown>)
        : {};

    const nested =
      payload.order && typeof payload.order === 'object'
        ? (payload.order as Record<string, unknown>)
        : payload.item && typeof payload.item === 'object'
          ? (payload.item as Record<string, unknown>)
          : payload;

    const extId =
      this.asString(nested.extId) ??
      this.asString(payload.extId) ??
      this.asString(payload.orderId);
    const status =
      this.asString(nested.status) ??
      this.asString(payload.status) ??
      this.asString(payload.orderStatus);
    const ozonId =
      this.asString(nested.id) ?? this.asString(payload.id) ?? null;

    this.logger.log(
      `Ozon Pay notification${extId ? ` order=${extId}` : ''}${
        status ? ` status=${status}` : ''
      } headers=${Object.keys(headers)
        .map((k) => k.toLowerCase())
        .sort()
        .join(',')}`,
    );

    this.assertNotificationAuth(headers, body);

    if (extId && status && this.isPaidStatus(status)) {
      await this.markOrderPaid(extId, ozonId);
    } else if (extId && (!status || !this.isPaidStatus(status))) {
      // Webhook may omit status — verify with Ozon API.
      const details = await this.fetchOzonOrderDetails(extId);
      if (details && this.isPaidStatus(details.status)) {
        await this.markOrderPaid(extId, details.id ?? ozonId);
      }
    }

    return { ok: true };
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

  private async markOrderPaid(extId: string, ozonId: string | null) {
    const order = await this.prisma.order.findUnique({
      where: { id: extId },
      include: { items: true },
    });
    if (!order) {
      this.logger.warn(`Ozon paid notification for unknown order ${extId}`);
      return;
    }
    if (order.paidAt) {
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
          recipientName: 'Покупатель',
          comment: `Заказ Агнюша · ${order.cityLabel}`,
          items: order.items.map((item) => ({
            name: item.productName,
            article: item.variantId ?? item.id,
            price: item.price,
            qty: item.qty,
            weightGrams: 800,
          })),
        });
        externalDeliveryId = yandexOrder.requestId;
        deliveryTrackNumber = deliveryTrackNumber || yandexOrder.requestId;
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
          recipientName: 'Покупатель',
          comment: `Заказ Агнюша · ${order.cityLabel}`,
          items: order.items.map((item) => ({
            name: item.productName,
            wareKey: item.variantId ?? item.id,
            price: item.price,
            qty: item.qty,
            weightGrams: 800,
          })),
        });
        externalDeliveryId = cdekOrder.uuid;
        deliveryTrackNumber = cdekOrder.cdekNumber || deliveryTrackNumber;
        deliveryTrackingUrl = cdekOrder.cdekNumber
          ? cdekTrackingUrl(cdekOrder.cdekNumber)
          : deliveryTrackingUrl;
      } catch (err) {
        this.logger.error(
          `CDEK create after pay failed for ${order.id}: ${
            err instanceof Error ? err.message : 'unknown'
          }`,
        );
      }
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: {
        // Do not downgrade CONFIRMED/SHIPPED/DONE back to PAID.
        status:
          order.status === OrderStatus.NEW || order.status === OrderStatus.PAID
            ? OrderStatus.PAID
            : order.status,
        paidAt: new Date(),
        paymentExternalId: ozonId ?? order.paymentExternalId,
        externalDeliveryId,
        deliveryTrackNumber,
        deliveryTrackingUrl,
      },
    });
    this.logger.log(`Order ${order.id} marked PAID`);
  }

  private assertNotificationAuth(
    headers: Record<string, string | string[] | undefined>,
    body: unknown,
  ) {
    const secret = (
      this.config.get<string>('OZON_PAY_NOTIFICATION_SECRET') ?? ''
    ).trim();
    if (!secret) return;

    const candidates: string[] = [];
    const headerNames = [
      'x-ozon-notification-secret',
      'x-notification-secret',
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

    if (
      body &&
      typeof body === 'object' &&
      'notificationSecret' in body &&
      typeof (body as { notificationSecret?: unknown }).notificationSecret ===
        'string'
    ) {
      candidates.push(
        (body as { notificationSecret: string }).notificationSecret.trim(),
      );
    }

    if (candidates.some((c) => c === secret)) return;

    const sigHeader = headers['x-signature'] ?? headers['x-ozon-signature'];
    const sig = Array.isArray(sigHeader) ? sigHeader[0] : sigHeader;
    if (typeof sig === 'string' && sig.trim()) {
      const raw = typeof body === 'string' ? body : JSON.stringify(body ?? {});
      const expected = createHmac('sha256', secret).update(raw).digest('hex');
      const a = Buffer.from(sig.trim().replace(/^sha256=/i, ''));
      const b = Buffer.from(expected);
      if (a.length === b.length && timingSafeEqual(a, b)) return;
    }

    this.logger.warn(
      `Ozon webhook auth failed; header keys=${Object.keys(headers)
        .map((k) => k.toLowerCase())
        .sort()
        .join(',')}`,
    );
    throw new UnauthorizedException('Неверная подпись уведомления');
  }
}
