import { ProductsService } from '../../src/products/products.service';
import type { PrismaService } from '../../src/prisma/prisma.service';

describe('ProductsService.listPublic', () => {
  it('maps catalog rows from the narrow select (incl. variant.productId)', async () => {
    const productId = 'prod-1';
    const findMany = jest.fn().mockResolvedValue([
      {
        id: productId,
        slug: 'turkey',
        name: 'Индейка',
        subtitle: 'Тест',
        image: '/assets/turkey.png',
        category: 'DOGS',
        badge: 'HIT',
        badgeLabel: 'Хит',
        badgeColor: '#5fa88a',
        discountPercent: null,
        ratingAverage: 0,
        ratingCount: 0,
        sortOrder: 1,
        isActive: true,
        isPopular: true,
        createdAt: new Date('2024-01-01'),
        updatedAt: new Date('2024-01-02'),
        variants: [
          {
            id: 'var-1',
            productId,
            sku: 'SKU-1',
            weight: '1 кг.',
            weightGrams: 1000,
            lengthCm: 20,
            widthCm: 15,
            heightCm: 10,
            price: 500,
            stock: 3,
            sortOrder: 0,
          },
        ],
      },
    ]);

    const service = new ProductsService({
      product: { findMany },
    } as unknown as PrismaService);

    const items = await service.listPublic();

    const call = findMany.mock.calls[0][0] as {
      select: Record<string, unknown> & {
        variants: { select: Record<string, unknown> };
      };
    };
    expect(call.select).not.toHaveProperty('sections');
    expect(call.select).not.toHaveProperty('images');
    expect(call.select).not.toHaveProperty('nutritionProtein');
    expect(call.select.variants.select).toEqual(
      expect.objectContaining({
        id: true,
        productId: true,
        price: true,
        stock: true,
      }),
    );

    expect(items).toHaveLength(1);
    expect(items[0]).toEqual(
      expect.objectContaining({
        id: productId,
        slug: 'turkey',
        name: 'Индейка',
        sections: [],
        images: ['/assets/turkey.png'],
        fromPrice: 500,
        variants: [
          expect.objectContaining({
            id: 'var-1',
            sku: 'SKU-1',
            weight: '1 кг.',
            price: 500,
            stock: 3,
          }),
        ],
      }),
    );
  });
});
