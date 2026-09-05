import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  ProductBadge,
  ProductCategory,
  type Product,
  type Prisma,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import type { UpsertProductDto } from './dto/product.dto';
import { minPrice, parseVariants, slugify } from './product.util';

@Injectable()
export class ProductsService {
  constructor(private readonly prisma: PrismaService) {}

  private map(product: Product) {
    const variants = parseVariants(product.variants);
    return {
      id: product.id,
      slug: product.slug,
      name: product.name,
      subtitle: product.subtitle,
      image: product.image,
      category: product.category,
      badge: product.badge,
      discountPercent: product.discountPercent,
      ingredients: product.ingredients,
      additives: product.additives,
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
    const slug = await this.uniqueSlug(dto.slug || dto.name);
    const product = await this.prisma.product.create({
      data: {
        slug,
        name: dto.name.trim(),
        subtitle: (dto.subtitle ?? '').trim(),
        image: (dto.image ?? '/assets/product-turkey.png').trim(),
        category: dto.category,
        badge: dto.badge ?? ProductBadge.NONE,
        discountPercent:
          dto.badge === ProductBadge.SALE
            ? (dto.discountPercent ?? null)
            : null,
        ingredients: (dto.ingredients ?? '').trim(),
        additives: (dto.additives ?? '').trim(),
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
    const product = await this.prisma.product.update({
      where: { id },
      data: {
        ...(slug ? { slug } : {}),
        name: dto.name.trim(),
        subtitle: (dto.subtitle ?? '').trim(),
        ...(dto.image !== undefined ? { image: dto.image.trim() } : {}),
        category: dto.category,
        badge: dto.badge ?? ProductBadge.NONE,
        discountPercent:
          (dto.badge ?? ProductBadge.NONE) === ProductBadge.SALE
            ? (dto.discountPercent ?? null)
            : null,
        ingredients: (dto.ingredients ?? '').trim(),
        additives: (dto.additives ?? '').trim(),
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

  async setImage(id: string, imagePath: string) {
    await this.getById(id);
    const product = await this.prisma.product.update({
      where: { id },
      data: { image: imagePath },
    });
    return this.map(product);
  }

  async assertCategory(value: string): Promise<ProductCategory> {
    if (value === ProductCategory.DOGS || value === ProductCategory.CATS) {
      return value;
    }
    throw new BadRequestException('Некорректная категория');
  }
}
