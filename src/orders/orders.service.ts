import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DeliveryMethodCode } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';
import type { CreateOrderDto } from './dto/create-order.dto';

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

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly yandex: YandexDeliveryService,
  ) {}

  async create(userId: string, dto: CreateOrderDto) {
    const deliveryCode = dto.deliveryCode.trim().toUpperCase();
    const pickupCode = dto.pickupCode?.trim() || null;
    let externalDeliveryId: string | null = null;

    if (deliveryCode === DeliveryMethodCode.YANDEX) {
      if (!pickupCode) {
        throw new BadRequestException('Выберите пункт выдачи Яндекс');
      }
      if (!this.yandex.isOrderCreationConfigured()) {
        throw new BadRequestException(
          'Оформление через Яндекс Доставку временно недоступно',
        );
      }

      const operatorRequestId = `agny-${Date.now().toString(36)}-${Math.random()
        .toString(36)
        .slice(2, 8)}`;

      const yandexOrder = await this.yandex.createPickupOrder({
        requestId: operatorRequestId,
        pickupPointId: pickupCode,
        phone: dto.phone,
        recipientName: 'Покупатель',
        comment: `Заказ Агнюша · ${dto.cityLabel}`,
        items: dto.items.map((item, index) => ({
          name: item.name,
          article: item.variantId || item.productId || `SKU-${index + 1}`,
          price: item.price,
          qty: item.qty,
          weightGrams: estimateWeightGrams(item.weight),
        })),
      });
      externalDeliveryId = yandexOrder.requestId;
    }

    const total = dto.items.reduce((s, i) => s + i.price * i.qty, 0);

    const order = await this.prisma.$transaction(async (tx) => {
      const resolvedItems: Array<{
        productId: string | null;
        variantId: string | null;
        productName: string;
        image: string;
        weight: string;
        price: number;
        qty: number;
      }> = [];

      for (const item of dto.items) {
        let variant =
          item.variantId != null
            ? await tx.productVariant.findUnique({
                where: { id: item.variantId },
                include: { product: true },
              })
            : null;

        if (!variant && item.productId) {
          variant = await tx.productVariant.findFirst({
            where: {
              productId: item.productId,
              weight: item.weight.trim(),
            },
            include: { product: true },
          });
        }

        if (variant) {
          if (variant.stock < item.qty) {
            throw new BadRequestException(
              `В наличии только ${variant.stock} шт. — ${variant.product.name} (${variant.weight})`,
            );
          }
          const updated = await tx.productVariant.updateMany({
            where: { id: variant.id, stock: { gte: item.qty } },
            data: { stock: { decrement: item.qty } },
          });
          if (updated.count !== 1) {
            const fresh = await tx.productVariant.findUnique({
              where: { id: variant.id },
            });
            throw new BadRequestException(
              `В наличии только ${fresh?.stock ?? 0} шт. — ${variant.product.name} (${variant.weight})`,
            );
          }
          resolvedItems.push({
            productId: variant.productId,
            variantId: variant.id,
            productName: item.name,
            image: item.image,
            weight: variant.weight,
            price: item.price,
            qty: item.qty,
          });
        } else {
          resolvedItems.push({
            productId: item.productId || null,
            variantId: null,
            productName: item.name,
            image: item.image,
            weight: item.weight,
            price: item.price,
            qty: item.qty,
          });
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
            create: resolvedItems,
          },
        },
        include: { items: true },
      });
    });

    return this.map(order);
  }

  async listForUser(userId: string) {
    const orders = await this.prisma.order.findMany({
      where: { userId },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    return orders.map((o) => this.map(o));
  }

  async getForUser(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return this.map(order);
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
      total: order.total,
      createdAt: order.createdAt,
      items: order.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        variantId: i.variantId ?? null,
        name: i.productName,
        image: i.image,
        weight: i.weight,
        price: i.price,
        qty: i.qty,
      })),
    };
  }
}
