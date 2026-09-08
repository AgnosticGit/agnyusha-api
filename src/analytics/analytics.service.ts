import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { isInventoryEnabled } from '../common/inventory';

const MAX_RANGE_DAYS = 366;

function parseBoundary(value: string | undefined, endOfDay: boolean): Date | null {
  if (!value?.trim()) return null;
  const day = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (day) {
    const d = new Date(
      Number(day[1]),
      Number(day[2]) - 1,
      Number(day[3]),
      endOfDay ? 23 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 59 : 0,
      endOfDay ? 999 : 0,
    );
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

function dateKey(d: Date) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  async overview(from?: string, to?: string) {
    const now = new Date();
    const end =
      parseBoundary(to, true) ??
      (() => {
        const d = new Date(now);
        d.setHours(23, 59, 59, 999);
        return d;
      })();
    const start =
      parseBoundary(from, false) ??
      (() => {
        const d = new Date(end);
        d.setDate(d.getDate() - 29);
        d.setHours(0, 0, 0, 0);
        return d;
      })();

    if (start.getTime() > end.getTime()) {
      return this.empty();
    }

    const rangeMs = end.getTime() - start.getTime();
    const maxMs = MAX_RANGE_DAYS * 24 * 60 * 60 * 1000;
    if (rangeMs > maxMs) {
      throw new BadRequestException(
        `Период аналитики не больше ${MAX_RANGE_DAYS} дней`,
      );
    }

    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        status: { not: 'CANCELLED' },
      },
      include: { items: true },
      orderBy: { createdAt: 'asc' },
    });

    const dayMap = new Map<
      string,
      { date: string; revenue: number; orders: number }
    >();
    for (
      let cursor = new Date(start);
      cursor.getTime() <= end.getTime();
      cursor.setDate(cursor.getDate() + 1)
    ) {
      const key = dateKey(cursor);
      dayMap.set(key, { date: key, revenue: 0, orders: 0 });
    }

    const productSales = new Map<
      string,
      { name: string; qty: number; revenue: number }
    >();

    let revenue = 0;
    let itemsSold = 0;

    for (const order of orders) {
      const key = dateKey(order.createdAt);
      const bucket = dayMap.get(key) ?? {
        date: key,
        revenue: 0,
        orders: 0,
      };
      bucket.revenue += order.total;
      bucket.orders += 1;
      dayMap.set(key, bucket);
      revenue += order.total;

      for (const item of order.items) {
        itemsSold += item.qty;
        const pid = item.productId || item.productName;
        const prev = productSales.get(pid) ?? {
          name: item.productName,
          qty: 0,
          revenue: 0,
        };
        prev.qty += item.qty;
        prev.revenue += item.price * item.qty;
        productSales.set(pid, prev);
      }
    }

    const lowStock = isInventoryEnabled(this.config)
      ? await this.prisma.productVariant.findMany({
          where: { stock: { lte: 5 } },
          orderBy: { stock: 'asc' },
          take: 10,
          include: {
            product: { select: { name: true, slug: true } },
          },
        })
      : [];

    const topProducts = [...productSales.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8);

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      totals: {
        revenue,
        orders: orders.length,
        itemsSold,
        averageOrderValue: orders.length
          ? Math.round(revenue / orders.length)
          : 0,
      },
      revenueByDay: [...dayMap.values()],
      topProducts,
      lowStock: lowStock.map((v) => ({
        id: v.id,
        sku: v.sku,
        weight: v.weight,
        stock: v.stock,
        productName: v.product.name,
        productSlug: v.product.slug,
      })),
    };
  }

  private empty() {
    return {
      from: null,
      to: null,
      totals: {
        revenue: 0,
        orders: 0,
        itemsSold: 0,
        averageOrderValue: 0,
      },
      revenueByDay: [],
      topProducts: [],
      lowStock: [],
    };
  }
}
