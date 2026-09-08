import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryMethodCode, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';
import { CdekService } from '../cdek/cdek.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { ListAdminOrdersDto } from './dto/list-admin-orders.dto';
import { isInventoryEnabled } from '../common/inventory';

const DELIVERY_SYNC_TTL_MS = 3 * 60 * 1000;

const FINAL_DELIVERY_STATUS_CODES = new Set([
  'DELIVERED',
  'NOT_DELIVERED',
  'REMOVED',
  'INVALID',
  'DESTROYED',
  'DELIVERED_FINISH',
  'RETURNED_FINISH',
  'CANCELLED',
  'CANCELLED_USER',
  'SORTING_CENTER_CANCELLED',
  'DELIVERY_TRACKING_FINISHED',
]);

function estimateWeightGrams(weight: string): number {
  const normalized = weight.replace(',', '.').toLowerCase();
  const match = normalized.match(/(\d+(?:\.\d+)?)/);
  if (!match) return 800;
  const value = Number(match[1]);
  if (!Number.isFinite(value) || value <= 0) return 800;
  if (/г(?!\w)|g\b/.test(normalized) && !/кг|kg/.test(normalized)) {
    return Math.max(100, Math.round(value));
  }
  return Math.max(100, Math.round(value * 1000));
}

function cdekTrackingUrl(trackNumber: string) {
  return `https://www.cdek.ru/ru/tracking?order_id=${encodeURIComponent(trackNumber)}`;
}

type ResolvedLine = {
  productId: string;
  variantId: string;
  productName: string;
  image: string;
  weight: string;
  price: number;
  qty: number;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly yandex: YandexDeliveryService,
    private readonly cdek: CdekService,
    private readonly payments: PaymentsService,
    private readonly config: ConfigService,
  ) {}

  private inventoryOn() {
    return isInventoryEnabled(this.config);
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
        price: variant.price,
        qty: item.qty,
      });
    }

    return resolved;
  }

  async create(userId: string | null, dto: CreateOrderDto) {
    const deliveryCode = dto.deliveryCode.trim().toUpperCase();
    const pickupCode = dto.pickupCode?.trim() || null;
    const payEnabled = this.payments.isConfigured();
    let externalDeliveryId: string | null = null;

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
          phone: dto.phone,
          recipientName: 'Покупатель',
          comment: `Заказ Агнюша · ${dto.cityLabel}`,
          items: resolvedItems.map((item) => ({
            name: item.productName,
            article: item.variantId,
            price: item.price,
            qty: item.qty,
            weightGrams: estimateWeightGrams(item.weight),
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
        phone: dto.phone,
        recipientName: 'Покупатель',
        comment: `Заказ Агнюша · ${dto.cityLabel}`,
        items: resolvedItems.map((item) => ({
          name: item.productName,
          wareKey: item.variantId,
          price: item.price,
          qty: item.qty,
          weightGrams: estimateWeightGrams(item.weight),
        })),
      });
      externalDeliveryId = cdekOrder.uuid;
      deliveryTrackNumber = cdekOrder.cdekNumber;
      deliveryTrackingUrl = cdekOrder.cdekNumber
        ? cdekTrackingUrl(cdekOrder.cdekNumber)
        : null;
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
          phone: dto.phone.trim(),
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

    if (!payEnabled) {
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
    query: { page?: number; limit?: number } = {},
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where = { userId };

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
      searchWhere.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { cityLabel: { contains: q, mode: 'insensitive' } },
        { pickupLabel: { contains: q, mode: 'insensitive' } },
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
    };
    for (const row of statusGroups) {
      const all =
        typeof row._count === 'object' && row._count != null
          ? row._count._all
          : undefined;
      counts[row.status] = all ?? 0;
    }

    return {
      items: orders.map((o) => this.mapAdmin(o)),
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
      throw new BadRequestException(
        'Отменить можно только неоплаченный заказ',
      );
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
      order.deliveryCode !== DeliveryMethodCode.YANDEX
    ) {
      return order;
    }
    if (
      order.deliveryStatusCode &&
      FINAL_DELIVERY_STATUS_CODES.has(order.deliveryStatusCode)
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
      this.logger.warn(
        `Delivery tracking sync failed for order ${order.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return order;
    }
  }

  private mapAdmin(
    order: Parameters<OrdersService['map']>[0] & {
      user?: { email: string } | null;
    },
  ) {
    return {
      ...this.map(order),
      customerEmail: order.user?.email ?? null,
    };
  }

  private map(order: {
    id: string;
    status: string;
    phone: string;
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
      status: order.status,
      phone: order.phone,
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
