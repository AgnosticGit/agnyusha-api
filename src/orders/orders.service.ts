import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryMethodCode, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentsService } from '../payments/payments.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { ListAdminOrdersDto } from './dto/list-admin-orders.dto';
import { isInventoryEnabled } from '../common/inventory';

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
  constructor(
    private readonly prisma: PrismaService,
    private readonly yandex: YandexDeliveryService,
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

  async listForUser(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: {
        items: {
          include: {
            product: { select: { slug: true, isActive: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((o) => this.map(o));
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
    return this.map(order);
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

    const where: Prisma.OrderWhereInput = {};
    if (query.status) where.status = query.status;
    if (q) {
      where.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        { phone: { contains: q, mode: 'insensitive' } },
        { cityLabel: { contains: q, mode: 'insensitive' } },
        { pickupLabel: { contains: q, mode: 'insensitive' } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const [total, orders] = await this.prisma.$transaction([
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
    ]);

    return {
      items: orders.map((o) => this.mapAdmin(o)),
      total,
      page,
      limit,
    };
  }

  async updateStatus(orderId: string, status: OrderStatus) {
    const existing = await this.prisma.order.findUnique({
      where: { id: orderId },
      select: { id: true, paidAt: true },
    });
    if (!existing) throw new NotFoundException('Заказ не найден');

    const order = await this.prisma.order.update({
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

    return this.mapAdmin(order);
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
