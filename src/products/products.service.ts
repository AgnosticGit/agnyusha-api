import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  type Product,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpsertProductDto } from './dto/product.dto';
import {
  minPrice,
  normalizeProductImages,
  normalizeSlug,
  parseVariants,
  slugify,
} from './product.util';
import { sanitizeProductHtml } from './sanitize-description';
import { resolveBadgeRead, resolveBadgeWrite } from './badge.util';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private map(product: Product) {
    const variants = parseVariants(product.variants);
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

  async listPublic() {
    const items = await this.prisma.product.findMany({
      where: { isActive: true },
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return items.map((p) => this.map(p));
  }

  async listAdmin() {
    const items = await this.prisma.product.findMany({
      orderBy: [{ sortOrder: 'asc' }, { createdAt: 'asc' }],
    });
    return items.map((p) => this.map(p));
  }

  async getById(id: string) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Товар не найден');
    return this.map(product);
  }

  async getPublicBySlug(slug: string) {
    const normalized = normalizeSlug(slug);
    const product = await this.prisma.product.findFirst({
      where: { slug: normalized, isActive: true },
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

  async create(dto: UpsertProductDto) {
    const variants = parseVariants(dto.variants);
    if (!variants.length) {
      throw new BadRequestException('Добавьте хотя бы один вариант');
    }
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
        variants: variants as unknown as Prisma.InputJsonValue,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    return this.map(product);
  }

  async update(id: string, dto: UpsertProductDto) {
    await this.getById(id);
    const variants = parseVariants(dto.variants);
    if (!variants.length) {
      throw new BadRequestException('Добавьте хотя бы один вариант');
    }
    const slug = dto.slug
      ? await this.uniqueSlug(dto.slug, id)
      : undefined;
    const imageData =
      dto.images !== undefined || dto.image !== undefined
        ? normalizeProductImages(dto.images, dto.image)
        : null;
    const badgeFields = resolveBadgeWrite(dto);
    const product = await this.prisma.product.update({
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
        variants: variants as unknown as Prisma.InputJsonValue,
        sortOrder: dto.sortOrder ?? 0,
        isActive: dto.isActive ?? true,
      },
    });
    return this.map(product);
  }

  async remove(id: string) {
    await this.getById(id);
    await this.prisma.product.delete({ where: { id } });
    return { ok: true };
  }

  async appendImages(id: string, imagePaths: string[]) {
    const existing = await this.prisma.product.findUnique({ where: { id } });
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
    });
    return this.map(product);
  }
}
