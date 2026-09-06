import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { type Product, type ProductVariant } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpsertProductDto } from './dto/product.dto';
import {
  minPrice,
  normalizeProductImages,
  normalizeSlug,
  parseVariantInputs,
  slugify,
  type ProductVariantDto,
} from './product.util';
import { sanitizeProductHtml } from './sanitize-description';
import { resolveBadgeRead, resolveBadgeWrite } from './badge.util';

type ProductWithVariants = Product & { variants: ProductVariant[] };

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private mapVariant(v: ProductVariant): ProductVariantDto {
    return {
      id: v.id,
      sku: v.sku,
      weight: v.weight,
      price: v.price,
      stock: v.stock,
      sortOrder: v.sortOrder,
    };
  }

  private map(product: ProductWithVariants) {
    const variants = [...product.variants]
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((v) => this.mapVariant(v));
    const { image, images } = normalizeProductImages(
      product.images,
      product.image,
    );
    const badge = resolveBadgeRead(product);
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      subtitle: product.subtitle,
      image,
      images,
      category: product.category,
      badge: product.badge,
      badgeLabel: badge.badgeLabel,
      badgeColor: badge.badgeColor,
      discountPercent: product.discountPercent,
      ingredients: sanitizeProductHtml(product.ingredients),
      description: sanitizeProductHtml(product.description),
      nutritionProtein: product.nutritionProtein,
      nutritionFat: product.nutritionFat,
      nutritionCarbs: product.nutritionCarbs,
      variants,
      fromPrice: minPrice(variants),
      sortOrder: product.sortOrder,
      isActive: product.isActive,
      createdAt: product.createdAt,
      updatedAt: product.updatedAt,
    };
  }

  private includeVariants = {
    variants: { orderBy: { sortOrder: 'asc' as const } },
  };

  private assertUniqueSkus(variants: ProductVariantDto[]) {
    const seen = new Set<string>();
    for (const v of variants) {
      const sku = v.sku.trim().toUpperCase();
      if (seen.has(sku)) {
        throw new BadRequestException(`Дублируется артикул ${sku}`);
      }
      seen.add(sku);
    }
  }

  async listPublic() {
    const items = await this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: this.includeVariants,
    });
    return items.map((p) => this.map(p));
  }

  async listAdmin() {
    const items = await this.prisma.product.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
      include: this.includeVariants,
    });
    return items.map((p) => this.map(p));
  }

  async listInventory(params: { q?: string; page?: number; limit?: number } = {}) {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const q = params.q?.trim();

    const where = q
      ? {
          OR: [
            { sku: { contains: q, mode: 'insensitive' as const } },
            { weight: { contains: q, mode: 'insensitive' as const } },
            {
              product: {
                name: { contains: q, mode: 'insensitive' as const },
              },
            },
          ],
        }
      : {};

    const [rows, total] = await this.prisma.$transaction([
      this.prisma.productVariant.findMany({
        where,
        orderBy: [
          { product: { sortOrder: 'asc' } },
          { sortOrder: 'asc' },
        ],
        skip: (page - 1) * limit,
        take: limit,
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              image: true,
              isActive: true,
            },
          },
        },
      }),
      this.prisma.productVariant.count({ where }),
    ]);

    return {
      items: rows.map((v) => ({
        id: v.id,
        sku: v.sku,
        weight: v.weight,
        price: v.price,
        stock: v.stock,
        product: v.product,
      })),
      total,
      page,
      limit,
    };
  }

  async updateStock(variantId: string, stock: number) {
    if (!Number.isFinite(stock) || stock < 0) {
      throw new BadRequestException('Количество не может быть отрицательным');
    }
    try {
      const variant = await this.prisma.productVariant.update({
        where: { id: variantId },
        data: { stock: Math.round(stock) },
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              image: true,
              isActive: true,
            },
          },
        },
      });
      return {
        id: variant.id,
        sku: variant.sku,
        weight: variant.weight,
        price: variant.price,
        stock: variant.stock,
        product: variant.product,
      };
    } catch {
      throw new NotFoundException('Фасовка не найдена');
    }
  }

  async getById(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: this.includeVariants,
    });
    if (!product) throw new NotFoundException('Товар не найден');
    return this.map(product);
  }

  async getPublicBySlug(slug: string) {
    const normalized = normalizeSlug(slug);
    const product = await this.prisma.product.findFirst({
      where: { slug: normalized, isActive: true },
      include: this.includeVariants,
    });
    if (!product) throw new NotFoundException('Товар не найден');
    return this.map(product);
  }

  private async uniqueSlug(base: string, excludeId?: string) {
    let slug = slugify(base);
    let i = 0;
    while (true) {
      const candidate = i === 0 ? slug : `${slug}-${i}`;
      const existing = await this.prisma.product.findUnique({
        where: { slug: candidate },
      });
      if (!existing || existing.id === excludeId) return candidate;
      i += 1;
    }
  }

  private async assertSkusAvailable(
    variants: ProductVariantDto[],
    productId?: string,
  ) {
    this.assertUniqueSkus(variants);
    for (const v of variants) {
      const existing = await this.prisma.productVariant.findUnique({
        where: { sku: v.sku },
      });
      if (!existing) continue;
      if (v.id && existing.id === v.id) continue;
      if (
        productId &&
        existing.productId === productId &&
        variants.some((x) => x.id === existing.id)
      ) {
        continue;
      }
      if (productId && existing.productId === productId && !v.id) {
        // Same product updating sku of another row — conflict if different row keeps old sku
        // Handled by unique constraint; treat as conflict if sku belongs to sibling being kept
        const kept = variants.find((x) => x.id === existing.id);
        if (kept && kept.sku !== v.sku) continue;
      }
      throw new ConflictException(`Артикул ${v.sku} уже используется`);
    }
  }

  async create(dto: UpsertProductDto) {
    const variants = parseVariantInputs(dto.variants);
    if (!variants.length) {
      throw new BadRequestException('Добавьте хотя бы один вариант');
    }
    await this.assertSkusAvailable(variants);
    const { image, images } = normalizeProductImages(dto.images, dto.image);
    const slug = await this.uniqueSlug(dto.slug || dto.name);
    const badgeFields = resolveBadgeWrite(dto);
    const product = await this.prisma.product.create({
      data: {
        slug,
        name: dto.name.trim(),
        subtitle: (dto.subtitle ?? '').trim(),
        image,
        images,
        category: dto.category,
        badge: badgeFields.badge,
        badgeLabel: badgeFields.badgeLabel,
        badgeColor: badgeFields.badgeColor,
        discountPercent: badgeFields.discountPercent,
        ingredients: sanitizeProductHtml(dto.ingredients),
        description: sanitizeProductHtml(dto.description),
        nutritionProtein: dto.nutritionProtein ?? null,
        nutritionFat: dto.nutritionFat ?? null,
        nutritionCarbs: dto.nutritionCarbs ?? null,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
        variants: {
          create: variants.map((v, index) => ({
            sku: v.sku,
            weight: v.weight,
            price: v.price,
            stock: v.stock,
            sortOrder: v.sortOrder ?? index,
          })),
        },
      },
      include: this.includeVariants,
    });
    return this.map(product);
  }

  async update(id: string, dto: UpsertProductDto) {
    await this.getById(id);
    const variants = parseVariantInputs(dto.variants);
    if (!variants.length) {
      throw new BadRequestException('Добавьте хотя бы один вариант');
    }
    await this.assertSkusAvailable(variants, id);
    const slug = dto.slug ? await this.uniqueSlug(dto.slug, id) : undefined;
    const imageData =
      dto.images !== undefined || dto.image !== undefined
        ? normalizeProductImages(dto.images, dto.image)
        : null;
    const badgeFields = resolveBadgeWrite(dto);

    const product = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.productVariant.findMany({
        where: { productId: id },
      });
      const incomingIds = new Set(
        variants.map((v) => v.id).filter((x): x is string => Boolean(x)),
      );
      const toDelete = existing.filter((e) => !incomingIds.has(e.id));
      if (toDelete.length) {
        await tx.productVariant.deleteMany({
          where: { id: { in: toDelete.map((v) => v.id) } },
        });
      }

      for (const [index, v] of variants.entries()) {
        if (v.id && existing.some((e) => e.id === v.id)) {
          await tx.productVariant.update({
            where: { id: v.id },
            data: {
              sku: v.sku,
              weight: v.weight,
              price: v.price,
              stock: v.stock,
              sortOrder: v.sortOrder ?? index,
            },
          });
        } else {
          await tx.productVariant.create({
            data: {
              productId: id,
              sku: v.sku,
              weight: v.weight,
              price: v.price,
              stock: v.stock,
              sortOrder: v.sortOrder ?? index,
            },
          });
        }
      }

      return tx.product.update({
        where: { id },
        data: {
          ...(slug ? { slug } : {}),
          name: dto.name.trim(),
          subtitle: (dto.subtitle ?? '').trim(),
          ...(imageData
            ? { image: imageData.image, images: imageData.images }
            : {}),
          category: dto.category,
          badge: badgeFields.badge,
          badgeLabel: badgeFields.badgeLabel,
          badgeColor: badgeFields.badgeColor,
          discountPercent: badgeFields.discountPercent,
          ingredients: sanitizeProductHtml(dto.ingredients),
          description: sanitizeProductHtml(dto.description),
          nutritionProtein: dto.nutritionProtein ?? null,
          nutritionFat: dto.nutritionFat ?? null,
          nutritionCarbs: dto.nutritionCarbs ?? null,
          sortOrder: dto.sortOrder ?? 0,
          isActive: dto.isActive ?? true,
        },
        include: this.includeVariants,
      });
    });

    return this.map(product);
  }

  async remove(id: string) {
    await this.getById(id);
    await this.prisma.product.delete({ where: { id } });
    return { ok: true };
  }

  async appendImages(id: string, imagePaths: string[]) {
    const existing = await this.prisma.product.findUnique({
      where: { id },
      include: this.includeVariants,
    });
    if (!existing) throw new NotFoundException('Товар не найден');
    const paths = imagePaths.map((p) => p.trim()).filter(Boolean);
    if (!paths.length) {
      throw new BadRequestException('Файл не получен');
    }
    const current = normalizeProductImages(existing.images, existing.image);
    const images = [...current.images, ...paths];
    const product = await this.prisma.product.update({
      where: { id },
      data: { images, image: images[0] },
      include: this.includeVariants,
    });
    return this.map(product);
  }
}
