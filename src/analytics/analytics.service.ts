import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  ANALYTICS_MAX_RANGE_DAYS,
  analyticsDateKey,
  resolveAnalyticsRange,
} from './analytics-range.util';

@Injectable()
export class AnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  async overview(from?: string, to?: string, productId?: string) {
    const range = this.resolveRange(from, to);
    if (!range) return this.empty();

    const { start, end } = range;
    const selectedId = productId?.trim() || null;

    let selectedProduct: {
      id: string;
      name: string;
      slug: string;
    } | null = null;

    if (selectedId) {
      const product = await this.prisma.product.findUnique({
        where: { id: selectedId },
        select: { id: true, name: true, slug: true },
      });
      if (!product) {
        throw new NotFoundException('Товар не найден');
      }
      selectedProduct = product;
    }

    const orders = await this.prisma.order.findMany({
      where: {
        createdAt: { gte: start, lte: end },
        status: { not: 'CANCELLED' },
        ...(selectedId ? { items: { some: { productId: selectedId } } } : {}),
      },
      select: {
        total: true,
        createdAt: true,
        items: {
          select: {
            productId: true,
            productName: true,
            variantId: true,
            weight: true,
            price: true,
            qty: true,
          },
        },
      },
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
      const key = analyticsDateKey(cursor);
      dayMap.set(key, { date: key, revenue: 0, orders: 0 });
    }

    const productSales = new Map<
      string,
      { productId: string | null; name: string; qty: number; revenue: number }
    >();
    const variantSales = new Map<
      string,
      {
        variantId: string | null;
        weight: string;
        qty: number;
        revenue: number;
      }
    >();

    let revenue = 0;
    let itemsSold = 0;

    for (const order of orders) {
      const relevantItems = selectedId
        ? order.items.filter((item) => item.productId === selectedId)
        : order.items;
      if (!relevantItems.length) continue;

      let dayRevenue = 0;
      for (const item of relevantItems) {
        const lineRevenue = item.price * item.qty;
        dayRevenue += lineRevenue;
        itemsSold += item.qty;

        const pid = item.productId || item.productName;
        const prev = productSales.get(pid) ?? {
          productId: item.productId,
          name: item.productName,
          qty: 0,
          revenue: 0,
        };
        prev.qty += item.qty;
        prev.revenue += lineRevenue;
        if (!prev.productId && item.productId) prev.productId = item.productId;
        productSales.set(pid, prev);

        if (selectedId) {
          const vid = item.variantId || `${item.weight}:${item.price}`;
          const vPrev = variantSales.get(vid) ?? {
            variantId: item.variantId,
            weight: item.weight,
            qty: 0,
            revenue: 0,
          };
          vPrev.qty += item.qty;
          vPrev.revenue += lineRevenue;
          variantSales.set(vid, vPrev);
        }
      }

      // Overall: order.total. Product filter: sum of that product's lines.
      const countedRevenue = selectedId ? dayRevenue : order.total;
      revenue += countedRevenue;

      const key = analyticsDateKey(order.createdAt);
      const bucket = dayMap.get(key) ?? {
        date: key,
        revenue: 0,
        orders: 0,
      };
      bucket.revenue += countedRevenue;
      bucket.orders += 1;
      dayMap.set(key, bucket);
    }

    const lowStock = (await this.settings.isInventoryEnabled())
      ? await this.prisma.productVariant.findMany({
          where: {
            stock: { lte: 5 },
            ...(selectedId ? { productId: selectedId } : {}),
          },
          orderBy: { stock: 'asc' },
          take: 10,
          include: {
            product: { select: { name: true, slug: true } },
          },
        })
      : [];

    const topProducts = [...productSales.values()]
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 8)
      .map((row) => ({
        productId: row.productId,
        name: row.name,
        qty: row.qty,
        revenue: row.revenue,
      }));

    const byVariant = selectedId
      ? [...variantSales.values()]
          .sort((a, b) => b.revenue - a.revenue)
          .map((row) => ({
            variantId: row.variantId,
            weight: row.weight,
            qty: row.qty,
            revenue: row.revenue,
          }))
      : [];

    const productOptions = await this.prisma.product.findMany({
      where: { isActive: true },
      select: { id: true, name: true },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    });

    return {
      from: start.toISOString(),
      to: end.toISOString(),
      selectedProduct,
      productOptions,
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
      byVariant,
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

  private resolveRange(from?: string, to?: string) {
    const resolved = resolveAnalyticsRange(from, to);
    if (!resolved.ok) {
      if (resolved.reason === 'inverted') return null;
      throw new BadRequestException(
        `Период аналитики не больше ${resolved.maxDays ?? ANALYTICS_MAX_RANGE_DAYS} дней`,
      );
    }
    return { start: resolved.start, end: resolved.end };
  }

  private empty() {
    return {
      from: null,
      to: null,
      selectedProduct: null,
      productOptions: [],
      totals: {
        revenue: 0,
        orders: 0,
        itemsSold: 0,
        averageOrderValue: 0,
      },
      revenueByDay: [],
      topProducts: [],
      byVariant: [],
      lowStock: [],
    };
  }
}
