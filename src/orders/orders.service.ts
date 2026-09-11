import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryMethodCode, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { PaymentsService } from '../payments/payments.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';
import { CdekService, cdekTrackingUrl } from '../cdek/cdek.service';
import { PochtaService, pochtaTrackingUrl } from '../pochta/pochta.service';
import { OzonDeliveryService } from '../ozon-delivery/ozon-delivery.service';
import { ozonTrackingUrl } from '../ozon-delivery/ozon-delivery.util';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { ListAdminOrdersDto } from './dto/list-admin-orders.dto';
import { isInventoryEnabled } from '../common/inventory';
import { resolveWeightGrams } from '../common/weight';
import { resolvePublicWebUrl } from '../common/web-origin';
import { formatPersonName, normalizeEmail } from '../common/person-name';
import { MAIL_SEND, type MailSend } from '../mail/mail.tokens';
import { buildOrderReceiptMail } from '../mail/order-receipt';
import { CdekEntityNotFoundError } from '../cdek/cdek.errors';
import { PochtaEntityNotFoundError } from '../pochta/pochta.errors';
import { YandexEntityNotFoundError } from '../yandex/yandex.errors';
import { orderStatusAfterCarrierGone, OPEN_ORDER_STATUSES } from './order-status.util';
import { FINAL_DELIVERY_STATUS_CODES } from './delivery-status.util';

const DELIVERY_SYNC_TTL_MS = 3 * 60 * 1000;

type ResolvedLine = {
  productId: string;
  variantId: string;
  productName: string;
  image: string;
  weight: string;
  weightGrams: number;
  price: number;
  qty: number;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly yandex: YandexDeliveryService,
    private readonly cdek: CdekService,
    private readonly pochta: PochtaService,
    private readonly ozonDelivery: OzonDeliveryService,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
    @Inject(MAIL_SEND) private readonly sendMail: MailSend,
  ) {}

  private inventoryOn() {
    return isInventoryEnabled(this.config);
  }

  private webOrigin(): string {
    return resolvePublicWebUrl(this.config);
  }

  private async notifyOrderReceipt(input: {
    id: string;
    number: number;
    email: string;
    total: number;
    needsLogin: boolean;
    paid: boolean;
    items: Array<{
      productName: string;
      weight: string;
      price: number;
      qty: number;
      image: string;
    }>;
  }) {
    const mail = buildOrderReceiptMail({
      orderNumber: input.number,
      total: input.total,
      items: input.items,
      webOrigin: this.webOrigin(),
      needsLogin: input.needsLogin,
      paid: input.paid,
    });
    try {
      await this.sendMail({
        to: input.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments,
      });
    } catch (err) {
      this.logger.warn(
        `Order mail failed for ${input.id}: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
    }
  }

  /** Resolve cart lines from DB — never trust client price/name/image. */
  private async resolveItems(
    items: CreateOrderDto['items'],
  ): Promise<ResolvedLine[]> {
    const resolved: ResolvedLine[] = [];

    for (const item of items) {
      if (!item.variantId?.trim()) {
        throw new BadRequestException('Укажите вариант товара (variantId)');
      }

      const variant = await this.prisma.productVariant.findUnique({
        where: { id: item.variantId.trim() },
        include: { product: true },
      });

      if (!variant || !variant.product.isActive) {
        throw new BadRequestException(
          'Товар недоступен для заказа — обновите корзину',
        );
      }
      if (this.inventoryOn() && variant.stock < item.qty) {
        throw new BadRequestException(
          `В наличии только ${variant.stock} шт. — ${variant.product.name} (${variant.weight})`,
        );
      }

      resolved.push({
        productId: variant.productId,
        variantId: variant.id,
        productName: variant.product.name,
        image: variant.product.image,
        weight: variant.weight,
        weightGrams: resolveWeightGrams(variant.weightGrams, variant.weight),
        price: variant.price,
        qty: item.qty,
      });
    }

    return resolved;
  }

  async create(
    sessionUserId: string | null,
    dto: CreateOrderDto,
    cartOpts: { guestRawToken?: string } = {},
  ) {
    const deliveryCode = dto.deliveryCode.trim().toUpperCase();
    const pickupCode = dto.pickupCode?.trim() || null;
    const payEnabled = this.payments.isConfigured();
    let externalDeliveryId: string | null = null;

    const lastName = dto.lastName.trim();
    const firstName = dto.firstName.trim();
    const phone = dto.phone.trim();
    if (!lastName || !firstName) {
      throw new BadRequestException('Укажите фамилию и имя');
    }
    if (phone.replace(/\D/g, '').length < 11) {
      throw new BadRequestException('Укажите корректный телефон');
    }

    const sessionUser = sessionUserId
      ? await this.prisma.user.findUnique({ where: { id: sessionUserId } })
      : null;
    if (sessionUserId && !sessionUser) {
      throw new BadRequestException('Сессия недействительна — войдите снова');
    }

    const email = sessionUser ? sessionUser.email : normalizeEmail(dto.email);
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Укажите корректный email');
    }

    const recipientName = formatPersonName({
      lastName,
      firstName,
    });

    const owner = sessionUser
      ? sessionUser
      : await (async () => {
          const existing = await this.prisma.user.findUnique({
            where: { email },
          });
          if (existing) {
            if (!existing.emailVerifiedAt) {
              return this.prisma.user.update({
                where: { id: existing.id },
                data: { phone, lastName, firstName },
              });
            }
            return existing;
          }
          return this.prisma.user.create({
            data: {
              email,
              phone,
              lastName,
              firstName,
            },
          });
        })();

    // Logged-in user: keep profile in sync with checkout.
    if (sessionUser) {
      await this.prisma.user.update({
        where: { id: sessionUser.id },
        data: { phone, lastName, firstName },
      });
    }

    const userId = owner.id;
    const resolvedItems = await this.resolveItems(dto.items);
    const total = resolvedItems.reduce((s, i) => s + i.price * i.qty, 0);

    if (deliveryCode === DeliveryMethodCode.YANDEX) {
      if (!pickupCode) {
        throw new BadRequestException('Выберите пункт выдачи Яндекс');
      }
      if (!this.yandex.isOrderCreationConfigured()) {
        throw new BadRequestException(
          'Оформление через Яндекс Доставку временно недоступно',
        );
      }

      // When Ozon Pay is on, create the Yandex shipment only after payment.
      if (!payEnabled) {
        const operatorRequestId = `agny-${Date.now().toString(36)}-${Math.random()
          .toString(36)
          .slice(2, 8)}`;

        const yandexOrder = await this.yandex.createPickupOrder({
          requestId: operatorRequestId,
          pickupPointId: pickupCode,
          phone,
          recipientName,
          comment: `Заказ Агнюша · ${dto.cityLabel}`,
          items: resolvedItems.map((item) => ({
            name: item.productName,
            article: item.variantId,
            price: item.price,
            qty: item.qty,
            weightGrams: item.weightGrams,
          })),
        });
        externalDeliveryId = yandexOrder.requestId;
      }
    }

    if (deliveryCode === DeliveryMethodCode.CDEK) {
      if (!pickupCode) {
        throw new BadRequestException('Выберите пункт выдачи СДЭК');
      }
      if (!this.cdek.isOrderCreationConfigured()) {
        throw new BadRequestException(
          'Оформление через СДЭК временно недоступно',
        );
      }
    }

    if (deliveryCode === DeliveryMethodCode.POST) {
      if (!pickupCode) {
        throw new BadRequestException('Выберите отделение Почты России');
      }
      if (!this.pochta.isOrderCreationConfigured()) {
        throw new BadRequestException(
          'Оформление через Почту России временно недоступно',
        );
      }
    }

    if (deliveryCode === DeliveryMethodCode.OZON) {
      if (!pickupCode) {
        throw new BadRequestException('Выберите пункт выдачи Ozon');
      }
      if (!this.ozonDelivery.isOrderCreationConfigured()) {
        throw new BadRequestException(
          'Оформление через Ozon Доставку временно недоступно',
        );
      }
    }

    let deliveryTrackNumber: string | null = null;
    let deliveryTrackingUrl: string | null = null;

    if (
      deliveryCode === DeliveryMethodCode.CDEK &&
      pickupCode &&
      !payEnabled &&
      this.cdek.isOrderCreationConfigured()
    ) {
      const cdekOrder = await this.cdek.createPickupOrder({
        orderNumber: `agny-${Date.now().toString(36)}`,
        deliveryPointCode: pickupCode,
        phone,
        recipientName,
        comment: `Заказ Агнюша · ${dto.cityLabel}`,
        items: resolvedItems.map((item) => ({
          name: item.productName,
          wareKey: item.variantId,
          price: item.price,
          qty: item.qty,
          weightGrams: item.weightGrams,
        })),
      });
      externalDeliveryId = cdekOrder.uuid;
      deliveryTrackNumber = cdekOrder.cdekNumber;
      deliveryTrackingUrl = cdekOrder.cdekNumber
        ? cdekTrackingUrl(cdekOrder.cdekNumber)
        : null;
    }

    if (
      deliveryCode === DeliveryMethodCode.POST &&
      pickupCode &&
      !payEnabled &&
      this.pochta.isOrderCreationConfigured()
    ) {
      const pochtaOrder = await this.pochta.createPickupOrder({
        orderNumber: `agny-${Date.now().toString(36)}`,
        deliveryPointCode: pickupCode,
        phone,
        recipientName,
        lastName,
        firstName,
        comment: `Заказ Агнюша · ${dto.cityLabel}`,
        cityLabel: dto.cityLabel,
        items: resolvedItems.map((item) => ({
          name: item.productName,
          wareKey: item.variantId,
          price: item.price,
          qty: item.qty,
          weightGrams: item.weightGrams,
        })),
      });
      externalDeliveryId = pochtaOrder.orderId;
      deliveryTrackNumber = pochtaOrder.barcode;
      deliveryTrackingUrl = pochtaOrder.barcode
        ? pochtaTrackingUrl(pochtaOrder.barcode)
        : null;
    }

    if (
      deliveryCode === DeliveryMethodCode.OZON &&
      pickupCode &&
      !payEnabled &&
      this.ozonDelivery.isOrderCreationConfigured()
    ) {
      const ozonOrder = await this.ozonDelivery.createPickupOrder({
        orderNumber: `agny-${Date.now().toString(36)}`,
        deliveryPointCode: pickupCode,
        phone,
        recipientName,
        comment: `Заказ Агнюша · ${dto.cityLabel}`,
        items: resolvedItems.map((item) => ({
          name: item.productName,
          wareKey: item.variantId,
          price: item.price,
          qty: item.qty,
          weightGrams: item.weightGrams,
        })),
      });
      externalDeliveryId = ozonOrder.orderNumber;
      deliveryTrackNumber = ozonOrder.postingNumber || ozonOrder.orderNumber;
      deliveryTrackingUrl =
        ozonOrder.trackingUrl || ozonTrackingUrl(ozonOrder.orderNumber);
    }

    const order = await this.prisma.$transaction(async (tx) => {
      if (this.inventoryOn()) {
        for (const item of resolvedItems) {
          const updated = await tx.productVariant.updateMany({
            where: { id: item.variantId, stock: { gte: item.qty } },
            data: { stock: { decrement: item.qty } },
          });
          if (updated.count !== 1) {
            const fresh = await tx.productVariant.findUnique({
              where: { id: item.variantId },
              include: { product: true },
            });
            throw new BadRequestException(
              `В наличии только ${fresh?.stock ?? 0} шт. — ${fresh?.product.name ?? 'товар'} (${fresh?.weight ?? ''})`,
            );
          }
        }
      }

      return tx.order.create({
        data: {
          userId,
          email,
          phone,
          lastName,
          firstName,
          contactChannel: dto.contactChannel.trim(),
          cityLabel: dto.cityLabel.trim(),
          deliveryCode,
          deliveryTitle: dto.deliveryTitle.trim(),
          pickupLabel: dto.pickupLabel?.trim() || null,
          pickupCode,
          externalDeliveryId,
          deliveryTrackNumber,
          deliveryTrackingUrl,
          total,
          items: {
            create: resolvedItems.map((i) => ({
              productId: i.productId,
              variantId: i.variantId,
              productName: i.productName,
              image: i.image,
              weight: i.weight,
              weightGrams: i.weightGrams,
              price: i.price,
              qty: i.qty,
            })),
          },
        },
        include: {
          items: {
            include: {
              product: { select: { slug: true, isActive: true } },
            },
          },
        },
      });
    });

    const clearOrderedFromCart = async () => {
      try {
        await this.cart.removeVariants({
          userId: sessionUserId,
          guestRawToken: cartOpts.guestRawToken,
          variantIds: resolvedItems.map((i) => i.variantId),
        });
      } catch (err) {
        this.logger.warn(
          `Cart cleanup after order ${order.id} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    };

    if (!payEnabled) {
      await this.notifyOrderReceipt({
        id: order.id,
        number: order.number,
        email,
        total,
        needsLogin: !sessionUser?.emailVerifiedAt,
        paid: false,
        items: order.items.map((i) => ({
          productName: i.productName,
          weight: i.weight,
          price: i.price,
          qty: i.qty,
          image: i.image,
        })),
      });
      await clearOrderedFromCart();
      return this.map(order);
    }

    try {
      const payment = await this.payments.createPayment({
        orderId: order.id,
        totalRub: total,
        items: resolvedItems.map((i) => ({
          extId: i.variantId,
          name: `${i.productName} (${i.weight})`,
          priceRub: i.price,
          qty: i.qty,
        })),
      });

      const updated = await this.prisma.order.update({
        where: { id: order.id },
        data: {
          paymentExternalId: payment.paymentExternalId,
          paymentPayLink: payment.payLink,
        },
        include: {
          items: {
            include: {
              product: { select: { slug: true, isActive: true } },
            },
          },
        },
      });

      await clearOrderedFromCart();
      return { ...this.map(updated), payUrl: payment.payLink };
    } catch (err) {
      await this.prisma.order
        .delete({ where: { id: order.id } })
        .catch(() => undefined);
      throw err;
    }
  }

  async listForUser(
    userId: string,
    query: { page?: number; limit?: number; openOnly?: boolean } = {},
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where = {
      userId,
      ...(query.openOnly
        ? { status: { in: OPEN_ORDER_STATUSES } }
        : {}),
    };

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          items: {
            include: {
              product: { select: { slug: true, isActive: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    const items: Array<ReturnType<OrdersService['map']>> = [];
    for (const order of orders) {
      items.push(this.map(await this.syncDeliveryTracking(order)));
    }

    return {
      items,
      total,
      page,
      limit,
    };
  }

  /**
   * After list is shown: sync a few unpaid NEW orders with Ozon (TTL-limited).
   * Returns only orders that changed to paid (for UI merge).
   */
  async reconcilePaymentsForUser(userId: string) {
    const paidIds = await this.payments.reconcileUnpaidOrdersForUser(userId);
    if (paidIds.length === 0) {
      return { items: [] as Array<ReturnType<OrdersService['map']>> };
    }

    const orders = await this.prisma.order.findMany({
      where: { userId, id: { in: paidIds } },
      include: {
        items: {
          include: {
            product: { select: { slug: true, isActive: true } },
          },
        },
      },
    });

    const items: Array<ReturnType<OrdersService['map']>> = [];
    for (const order of orders) {
      items.push(this.map(await this.syncDeliveryTracking(order)));
    }
    return { items };
  }

  async getForUser(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        items: {
          include: {
            product: { select: { slug: true, isActive: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return this.map(await this.syncDeliveryTracking(order));
  }

  /** Resume Ozon Pay for an unpaid order owned by the user. */
  async getPayUrlForUser(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    if (order.paidAt || order.status !== OrderStatus.NEW) {
      throw new BadRequestException('Этот заказ уже нельзя оплатить');
    }

    if (order.paymentPayLink) {
      return { payUrl: order.paymentPayLink };
    }

    if (!this.payments.isConfigured()) {
      throw new BadRequestException('Оплата временно недоступна');
    }

    const fresh = await this.payments.resolvePayLink(order.id);
    if (!fresh) {
      throw new BadRequestException(
        'Ссылка на оплату недоступна. Оформите заказ заново.',
      );
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { paymentPayLink: fresh },
    });

    return { payUrl: fresh };
  }

  async listAdmin(query: ListAdminOrdersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const q = query.q?.trim() || '';

    const searchWhere: Prisma.OrderWhereInput = {};
    if (q) {
      const asNumber = /^\d+$/.test(q) ? Number.parseInt(q, 10) : NaN;
      searchWhere.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        ...(Number.isFinite(asNumber) ? [{ number: asNumber }] : []),
        { phone: { contains: q, mode: 'insensitive' } },
        { cityLabel: { contains: q, mode: 'insensitive' } },
        { pickupLabel: { contains: q, mode: 'insensitive' } },
        { deliveryTrackNumber: { contains: q, mode: 'insensitive' } },
        { externalDeliveryId: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const where: Prisma.OrderWhereInput = {
      ...searchWhere,
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, orders, statusGroups] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: {
          user: { select: { email: true } },
          items: {
            include: {
              product: { select: { slug: true, isActive: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: searchWhere,
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
    ]);

    const counts: Record<string, number> = {
      NEW: 0,
      PAID: 0,
      CONFIRMED: 0,
      SHIPPED: 0,
      DONE: 0,
      CANCELLED: 0,
      ARCHIVED: 0,
    };
    for (const row of statusGroups) {
      const all =
        typeof row._count === 'object' && row._count != null
          ? row._count._all
          : undefined;
      counts[row.status] = all ?? 0;
    }

    const synced = await Promise.all(
      orders.map((order) => this.syncDeliveryTracking(order)),
    );

    return {
      items: synced.map((o) => this.mapAdmin(o)),
      total,
      page,
      limit,
      counts,
    };
  }

  async updateStatus(orderId: string, status: OrderStatus) {
    const existing = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('Заказ не найден');

    const order = await this.prisma.$transaction(async (tx) => {
      if (
        status === OrderStatus.CANCELLED &&
        existing.status !== OrderStatus.CANCELLED
      ) {
        await this.restoreStock(tx, existing.items);
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          status,
          ...(status === OrderStatus.PAID && !existing.paidAt
            ? { paidAt: new Date() }
            : {}),
        },
        include: {
          user: { select: { email: true } },
          items: {
            include: {
              product: { select: { slug: true, isActive: true } },
            },
          },
        },
      });
    });

    return this.mapAdmin(order);
  }

  /** Buyer may cancel only unpaid NEW orders. */
  async cancelForUser(userId: string, orderId: string) {
    const existing = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('Заказ не найден');
    if (existing.paidAt || existing.status !== OrderStatus.NEW) {
      throw new BadRequestException('Отменить можно только неоплаченный заказ');
    }

    const order = await this.prisma.$transaction(async (tx) => {
      await this.restoreStock(tx, existing.items);
      return tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
        include: {
          items: {
            include: {
              product: { select: { slug: true, isActive: true } },
            },
          },
        },
      });
    });

    return this.map(order);
  }

  private async restoreStock(
    tx: Prisma.TransactionClient,
    items: Array<{ variantId: string | null; qty: number }>,
  ) {
    if (!this.inventoryOn()) return;
    for (const item of items) {
      if (!item.variantId) continue;
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { stock: { increment: item.qty } },
      });
    }
  }

  /**
   * Poll CDEK/Yandex for tracking when TTL expired.
   * Safe on every list/get — skips when fresh or terminal.
   */
  async syncDeliveryTracking<
    T extends {
      id: string;
      status: OrderStatus;
      deliveryCode: string;
      externalDeliveryId: string | null;
      deliveryTrackNumber: string | null;
      deliveryStatusCode: string | null;
      deliveryStatusLabel: string | null;
      deliveryTrackingUrl: string | null;
      deliveryStatusAt: Date | null;
    },
  >(order: T): Promise<T> {
    if (!order.externalDeliveryId) return order;
    if (
      order.deliveryCode !== DeliveryMethodCode.CDEK &&
      order.deliveryCode !== DeliveryMethodCode.YANDEX &&
      order.deliveryCode !== DeliveryMethodCode.POST
    ) {
      return order;
    }
    if (
      order.status === OrderStatus.ARCHIVED ||
      (order.deliveryStatusCode &&
        FINAL_DELIVERY_STATUS_CODES.has(order.deliveryStatusCode))
    ) {
      return order;
    }
    if (
      order.deliveryStatusAt &&
      Date.now() - order.deliveryStatusAt.getTime() < DELIVERY_SYNC_TTL_MS
    ) {
      return order;
    }

    try {
      if (order.deliveryCode === DeliveryMethodCode.CDEK) {
        const info = await this.cdek.getOrder(order.externalDeliveryId);
        const trackNumber = info.cdekNumber || order.deliveryTrackNumber;
        const updated = await this.prisma.order.update({
          where: { id: order.id },
          data: {
            deliveryTrackNumber: trackNumber,
            deliveryStatusCode: info.statusCode,
            deliveryStatusLabel: info.statusLabel,
            deliveryTrackingUrl: trackNumber
              ? cdekTrackingUrl(trackNumber)
              : order.deliveryTrackingUrl,
            deliveryStatusAt: new Date(),
          },
        });
        return { ...order, ...updated };
      }

      if (order.deliveryCode === DeliveryMethodCode.POST) {
        const info = await this.pochta.getOrder(order.externalDeliveryId);
        const trackNumber = info.barcode || order.deliveryTrackNumber;
        const updated = await this.prisma.order.update({
          where: { id: order.id },
          data: {
            deliveryTrackNumber: trackNumber,
            deliveryStatusCode: info.statusCode,
            deliveryStatusLabel: info.statusLabel,
            deliveryTrackingUrl: trackNumber
              ? pochtaTrackingUrl(trackNumber)
              : order.deliveryTrackingUrl,
            deliveryStatusAt: new Date(),
          },
        });
        return { ...order, ...updated };
      }

      const info = await this.yandex.getRequestInfo(order.externalDeliveryId);
      const updated = await this.prisma.order.update({
        where: { id: order.id },
        data: {
          deliveryTrackNumber:
            order.deliveryTrackNumber || order.externalDeliveryId,
          deliveryStatusCode: info.statusCode,
          deliveryStatusLabel: info.statusLabel || info.statusCode,
          deliveryTrackingUrl: info.sharingUrl || order.deliveryTrackingUrl,
          deliveryStatusAt: new Date(),
        },
      });
      return { ...order, ...updated };
    } catch (err) {
      if (err instanceof CdekEntityNotFoundError) {
        return this.markCarrierShipmentGone(order, 'СДЭК');
      }
      if (err instanceof YandexEntityNotFoundError) {
        return this.markCarrierShipmentGone(order, 'Яндекс Доставка');
      }
      if (err instanceof PochtaEntityNotFoundError) {
        return this.markCarrierShipmentGone(order, 'Почта России');
      }
      this.logger.warn(
        `Delivery tracking sync failed for order ${order.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return order;
    }
  }

  /**
   * Carrier no longer has the shipment (manual delete in ЛК or purged).
   * Stop polling; move to ARCHIVED unless already DONE/CANCELLED/ARCHIVED.
   */
  private async markCarrierShipmentGone<
    T extends {
      id: string;
      status: OrderStatus;
      deliveryTrackNumber: string | null;
      deliveryStatusCode: string | null;
      deliveryStatusLabel: string | null;
      deliveryTrackingUrl: string | null;
      deliveryStatusAt: Date | null;
    },
  >(order: T, carrierLabel: string): Promise<T> {
    const nextStatus = orderStatusAfterCarrierGone(order.status);
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: nextStatus,
        deliveryStatusCode: 'REMOVED',
        deliveryStatusLabel: `Отправление недоступно в ${carrierLabel}`,
        deliveryStatusAt: new Date(),
      },
    });
    this.logger.log(
      `Order ${order.id}: carrier shipment gone (${carrierLabel}) → ` +
        `delivery=REMOVED status=${nextStatus}`,
    );
    return { ...order, ...updated };
  }

  private mapAdmin(
    order: Parameters<OrdersService['map']>[0] & {
      user?: { email: string } | null;
      email?: string;
    },
  ) {
    return {
      ...this.map(order),
      customerEmail: order.email || order.user?.email || null,
    };
  }

  private map(order: {
    id: string;
    number: number;
    status: string;
    email?: string;
    phone: string;
    lastName?: string;
    firstName?: string;
    contactChannel: string;
    cityLabel: string;
    deliveryCode: string;
    deliveryTitle: string;
    pickupLabel: string | null;
    pickupCode?: string | null;
    externalDeliveryId?: string | null;
    deliveryTrackNumber?: string | null;
    deliveryStatusCode?: string | null;
    deliveryStatusLabel?: string | null;
    deliveryTrackingUrl?: string | null;
    deliveryStatusAt?: Date | null;
    paymentExternalId?: string | null;
    paymentPayLink?: string | null;
    paidAt?: Date | null;
    total: number;
    createdAt: Date;
    items: Array<{
      id: string;
      productId: string | null;
      variantId?: string | null;
      productName: string;
      image: string;
      weight: string;
      price: number;
      qty: number;
      product?: { slug: string; isActive: boolean } | null;
    }>;
  }) {
    const hasTracking =
      Boolean(order.externalDeliveryId) ||
      Boolean(order.deliveryTrackNumber) ||
      Boolean(order.deliveryStatusLabel) ||
      Boolean(order.deliveryTrackingUrl);

    return {
      id: order.id,
      number: order.number,
      status: order.status,
      email: order.email ?? '',
      phone: order.phone,
      lastName: order.lastName ?? '',
      firstName: order.firstName ?? '',
      contactChannel: order.contactChannel,
      cityLabel: order.cityLabel,
      deliveryCode: order.deliveryCode,
      deliveryTitle: order.deliveryTitle,
      pickupLabel: order.pickupLabel,
      pickupCode: order.pickupCode ?? null,
      externalDeliveryId: order.externalDeliveryId ?? null,
      deliveryTracking: hasTracking
        ? {
            trackNumber: order.deliveryTrackNumber ?? null,
            statusCode: order.deliveryStatusCode ?? null,
            statusLabel: order.deliveryStatusLabel ?? null,
            trackingUrl: order.deliveryTrackingUrl ?? null,
            syncedAt: order.deliveryStatusAt?.toISOString() ?? null,
          }
        : null,
      paymentExternalId: order.paymentExternalId ?? null,
      paidAt: order.paidAt ?? null,
      payUrl:
        !order.paidAt &&
        order.status === OrderStatus.NEW &&
        order.paymentPayLink
          ? order.paymentPayLink
          : null,
      total: order.total,
      createdAt: order.createdAt,
      items: order.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        variantId: i.variantId ?? null,
        productSlug:
          i.product?.isActive && i.product.slug ? i.product.slug : null,
        name: i.productName,
        image: i.image,
        weight: i.weight,
        price: i.price,
        qty: i.qty,
      })),
    };
  }
}
