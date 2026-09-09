import { BadRequestException, NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { AnalyticsService } from '../../src/analytics/analytics.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

function fakeConfig(values: Record<string, string | undefined> = {}): ConfigService {
  return {
    get: jest.fn((key: string) => values[key]),
  } as unknown as ConfigService;
}

function makePrisma(overrides: Partial<{
  product: { findUnique: jest.Mock; findMany: jest.Mock };
  order: { findMany: jest.Mock };
  productVariant: { findMany: jest.Mock };
}> = {}) {
  return {
    product: {
      findUnique: jest.fn(),
      findMany: jest.fn().mockResolvedValue([]),
      ...overrides.product,
    },
    order: {
      findMany: jest.fn().mockResolvedValue([]),
      ...overrides.order,
    },
    productVariant: {
      findMany: jest.fn().mockResolvedValue([]),
      ...overrides.productVariant,
    },
  } as unknown as PrismaService;
}

describe('AnalyticsService', () => {
  it('aggregates revenue for the default range with sample orders', async () => {
    const day1 = new Date();
    day1.setHours(12, 0, 0, 0);
    const day0 = new Date(day1);
    day0.setDate(day0.getDate() - 1);
    day0.setHours(10, 0, 0, 0);

    const orders = [
      {
        total: 1000,
        createdAt: day0,
        items: [
          {
            productId: 'p1',
            productName: 'Индейка',
            variantId: 'v1',
            weight: '1 кг.',
            price: 500,
            qty: 2,
          },
        ],
      },
      {
        total: 300,
        createdAt: day1,
        items: [
          {
            productId: 'p2',
            productName: 'Говядина',
            variantId: 'v2',
            weight: '0,5 кг.',
            price: 300,
            qty: 1,
          },
        ],
      },
    ];

    const prisma = makePrisma({
      order: { findMany: jest.fn().mockResolvedValue(orders) },
      product: {
        findUnique: jest.fn(),
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'p1', name: 'Индейка' }]),
      },
    });
    const service = new AnalyticsService(prisma, fakeConfig());

    const result = await service.overview();

    expect(result.totals.revenue).toBe(1300);
    expect(result.totals.orders).toBe(2);
    expect(result.totals.itemsSold).toBe(3);
    expect(result.totals.averageOrderValue).toBe(650);
    expect(result.topProducts[0]).toMatchObject({
      productId: 'p1',
      name: 'Индейка',
      qty: 2,
      revenue: 1000,
    });
    expect(result.revenueByDay.length).toBeGreaterThanOrEqual(30);
    expect(result.selectedProduct).toBeNull();
    expect(result.productOptions).toEqual([{ id: 'p1', name: 'Индейка' }]);
    expect(result.lowStock).toEqual([]);
  });

  it('throws NotFound when product filter id is missing', async () => {
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue(null),
        findMany: jest.fn(),
      },
    });
    const service = new AnalyticsService(prisma, fakeConfig());

    await expect(service.overview(undefined, undefined, 'missing')).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it('returns empty() when start > end', async () => {
    const prisma = makePrisma();
    const service = new AnalyticsService(prisma, fakeConfig());

    const result = await service.overview('2026-02-10', '2026-02-01');
    expect(result).toEqual({
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
    });
    expect(prisma.order.findMany).not.toHaveBeenCalled();
  });

  it('throws BadRequestException when range exceeds 366 days', async () => {
    const prisma = makePrisma();
    const service = new AnalyticsService(prisma, fakeConfig());

    await expect(
      service.overview('2024-01-01', '2025-12-31'),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('filters revenue by product lines when productId is set', async () => {
    const createdAt = new Date('2026-03-15T12:00:00');
    const prisma = makePrisma({
      product: {
        findUnique: jest.fn().mockResolvedValue({
          id: 'p1',
          name: 'Индейка',
          slug: 'indeyka',
        }),
        findMany: jest.fn().mockResolvedValue([]),
      },
      order: {
        findMany: jest.fn().mockResolvedValue([
          {
            total: 9999,
            createdAt,
            items: [
              {
                productId: 'p1',
                productName: 'Индейка',
                variantId: 'v1',
                weight: '1 кг.',
                price: 400,
                qty: 2,
              },
              {
                productId: 'p2',
                productName: 'Other',
                variantId: 'v2',
                weight: '1 кг.',
                price: 100,
                qty: 1,
              },
            ],
          },
        ]),
      },
    });
    const service = new AnalyticsService(prisma, fakeConfig());

    const result = await service.overview('2026-03-15', '2026-03-15', 'p1');
    expect(result.selectedProduct).toEqual({
      id: 'p1',
      name: 'Индейка',
      slug: 'indeyka',
    });
    expect(result.totals.revenue).toBe(800);
    expect(result.totals.itemsSold).toBe(2);
    expect(result.byVariant).toEqual([
      { variantId: 'v1', weight: '1 кг.', qty: 2, revenue: 800 },
    ]);
  });
});
