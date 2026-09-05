import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateOrderDto } from './dto/create-order.dto';

@Injectable()
export class OrdersService {
  constructor(private readonly prisma: PrismaService) {}

  async create(userId: string, dto: CreateOrderDto) {
    const total = dto.items.reduce((s, i) => s + i.price * i.qty, 0);
    const order = await this.prisma.order.create({
      data: {
        userId,
        phone: dto.phone.trim(),
        contactChannel: dto.contactChannel.trim(),
        cityLabel: dto.cityLabel.trim(),
        deliveryCode: dto.deliveryCode.trim(),
        deliveryTitle: dto.deliveryTitle.trim(),
        pickupLabel: dto.pickupLabel?.trim() || null,
        total,
        items: {
          create: dto.items.map((item) => ({
            productId: item.productId || null,
            productName: item.name,
            image: item.image,
            weight: item.weight,
            price: item.price,
            qty: item.qty,
          })),
        },
      },
      include: { items: true },
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
    total: number;
    createdAt: Date;
    items: Array<{
      id: string;
      productId: string | null;
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
      total: order.total,
      createdAt: order.createdAt,
      items: order.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        name: i.productName,
        image: i.image,
        weight: i.weight,
        price: i.price,
        qty: i.qty,
      })),
    };
  }
}
