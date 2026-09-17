import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SettingsService } from '../settings/settings.service';
import {
  REVIEW_ELIGIBLE_STATUSES,
  averageFromAggregate,
  clampRating,
} from './review.util';
import type { CreateReviewDto, UpdateAdminReviewDto } from './dto/review.dto';
import { formatPublicDisplayName } from '../common/person-name';

@Injectable()
export class ReviewsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly settings: SettingsService,
  ) {}

  private async assertReviewsEnabled() {
    if (!(await this.settings.isReviewsEnabled())) {
      throw new ServiceUnavailableException('Отзывы временно отключены');
    }
  }

  private async refreshProductRating(productId: string, tx?: Prisma.TransactionClient) {
    const db = tx ?? this.prisma;
    const agg = await db.productReview.aggregate({
      where: { productId, isHidden: false },
      _avg: { rating: true },
      _count: { _all: true },
    });
    const { average, count } = averageFromAggregate(
      agg._avg.rating,
      agg._count._all,
    );
    await db.product.update({
      where: { id: productId },
      data: { ratingAverage: average, ratingCount: count },
    });
  }

  private mapReview(
    r: {
      id: string;
      productId: string;
      userId: string;
      orderId: string | null;
      rating: number;
      body: string;
      isHidden: boolean;
      createdAt: Date;
      updatedAt: Date;
      user?: { email: string; firstName: string; lastName: string };
      product?: { id: string; name: string; slug: string };
    },
  ) {
    return {
      id: r.id,
      productId: r.productId,
      userId: r.userId,
      orderId: r.orderId,
      rating: r.rating,
      body: r.body,
      isHidden: r.isHidden,
      createdAt: r.createdAt.toISOString(),
      updatedAt: r.updatedAt.toISOString(),
      authorName: formatPublicDisplayName(r.user) ?? 'Покупатель',
      product: r.product
        ? { id: r.product.id, name: r.product.name, slug: r.product.slug }
        : undefined,
    };
  }

  async listForProduct(productIdOrSlug: string) {
    const product = await this.prisma.product.findFirst({
      where: {
        OR: [{ id: productIdOrSlug }, { slug: productIdOrSlug }],
      },
      select: { id: true, ratingAverage: true, ratingCount: true },
    });
    if (!product) throw new NotFoundException('Товар не найден');

    if (!(await this.settings.isReviewsEnabled())) {
      return {
        productId: product.id,
        average: 0,
        count: 0,
        items: [],
      };
    }

    if (product.ratingCount <= 0) {
      return {
        productId: product.id,
        average: product.ratingAverage,
        count: 0,
        items: [],
      };
    }

    const reviews = await this.prisma.productReview.findMany({
      where: { productId: product.id, isHidden: false },
      include: {
        user: { select: { email: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      productId: product.id,
      average: product.ratingAverage,
      count: product.ratingCount,
      items: reviews.map((r) => this.mapReview(r)),
    };
  }

  async canUserReview(userId: string, productId: string): Promise<boolean> {
    if (!(await this.settings.isReviewsEnabled())) return false;
    const existing = await this.prisma.productReview.findUnique({
      where: { userId_productId: { userId, productId } },
    });
    if (existing) return false;

    const purchased = await this.prisma.orderItem.findFirst({
      where: {
        productId,
        order: {
          userId,
          status: { in: [...REVIEW_ELIGIBLE_STATUSES] as OrderStatus[] },
        },
      },
      select: { id: true, orderId: true },
    });
    return Boolean(purchased);
  }

  /** Products the user bought and may still review (account UI). */
  async listEligibleForUser(userId: string) {
    await this.assertReviewsEnabled();

    const purchased = await this.prisma.orderItem.findMany({
      where: {
        productId: { not: null },
        product: {
          isActive: true,
          reviews: { none: { userId } },
        },
        order: {
          userId,
          status: { in: [...REVIEW_ELIGIBLE_STATUSES] as OrderStatus[] },
        },
      },
      select: {
        productId: true,
        orderId: true,
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            image: true,
          },
        },
      },
      orderBy: { order: { createdAt: 'desc' } },
    });

    const seen = new Set<string>();
    const items: Array<{
      productId: string;
      orderId: string;
      name: string;
      slug: string;
      image: string;
    }> = [];
    for (const row of purchased) {
      const productId = row.productId;
      if (!productId || !row.product || seen.has(productId)) continue;
      seen.add(productId);
      items.push({
        productId,
        orderId: row.orderId,
        name: row.product.name,
        slug: row.product.slug,
        image: row.product.image,
      });
    }
    return { items };
  }

  async listMine(userId: string) {
    await this.assertReviewsEnabled();
    const reviews = await this.prisma.productReview.findMany({
      where: { userId },
      include: {
        product: { select: { id: true, name: true, slug: true, image: true } },
        user: { select: { email: true, firstName: true, lastName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return {
      items: reviews.map((r) => ({
        ...this.mapReview(r),
        product: r.product
          ? {
              id: r.product.id,
              name: r.product.name,
              slug: r.product.slug,
              image: r.product.image,
            }
          : undefined,
      })),
    };
  }

  async create(userId: string, productIdOrSlug: string, dto: CreateReviewDto) {
    await this.assertReviewsEnabled();
    const rating = clampRating(dto.rating);
    if (rating == null) throw new BadRequestException('Оценка от 1 до 5');
    const body = dto.body.trim();
    if (body.length < 3) throw new BadRequestException('Слишком короткий отзыв');

    const product = await this.prisma.product.findFirst({
      where: {
        OR: [{ id: productIdOrSlug }, { slug: productIdOrSlug }],
        isActive: true,
      },
    });
    if (!product) throw new NotFoundException('Товар не найден');

    const existing = await this.prisma.productReview.findUnique({
      where: { userId_productId: { userId, productId: product.id } },
    });
    if (existing) {
      throw new ConflictException('Вы уже оставили отзыв на этот товар');
    }

    const purchase = await this.prisma.orderItem.findFirst({
      where: {
        productId: product.id,
        order: {
          userId,
          status: { in: [...REVIEW_ELIGIBLE_STATUSES] as OrderStatus[] },
        },
      },
      select: { orderId: true },
      orderBy: { order: { createdAt: 'desc' } },
    });
    if (!purchase) {
      throw new ForbiddenException('Отзыв могут оставить только купившие товар');
    }

    const review = await this.prisma.$transaction(async (tx) => {
      const created = await tx.productReview.create({
        data: {
          productId: product.id,
          userId,
          orderId: purchase.orderId,
          rating,
          body,
        },
        include: {
          user: { select: { email: true, firstName: true, lastName: true } },
        },
      });
      await this.refreshProductRating(product.id, tx);
      return created;
    });

    return this.mapReview(review);
  }

  async adminList(params: { page?: number; limit?: number; q?: string }) {
    const page = Math.max(1, params.page ?? 1);
    const limit = Math.min(100, Math.max(1, params.limit ?? 20));
    const q = params.q?.trim();
    const where: Prisma.ProductReviewWhereInput = q
      ? {
          OR: [
            { body: { contains: q, mode: 'insensitive' } },
            { product: { name: { contains: q, mode: 'insensitive' } } },
            { user: { email: { contains: q, mode: 'insensitive' } } },
          ],
        }
      : {};

    const [total, rows] = await this.prisma.$transaction([
      this.prisma.productReview.count({ where }),
      this.prisma.productReview.findMany({
        where,
        include: {
          user: { select: { email: true, firstName: true, lastName: true } },
          product: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);

    return {
      items: rows.map((r) => this.mapReview(r)),
      page,
      limit,
      total,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async adminUpdate(id: string, dto: UpdateAdminReviewDto) {
    const existing = await this.prisma.productReview.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Отзыв не найден');

    const data: Prisma.ProductReviewUpdateInput = {};
    if (dto.rating != null) {
      const rating = clampRating(dto.rating);
      if (rating == null) throw new BadRequestException('Оценка от 1 до 5');
      data.rating = rating;
    }
    if (dto.body != null) data.body = dto.body.trim();
    if (dto.isHidden != null) data.isHidden = dto.isHidden;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.productReview.update({
        where: { id },
        data,
        include: {
          user: { select: { email: true, firstName: true, lastName: true } },
          product: { select: { id: true, name: true, slug: true } },
        },
      });
      await this.refreshProductRating(existing.productId, tx);
      return row;
    });
    return this.mapReview(updated);
  }

  async adminDelete(id: string) {
    const existing = await this.prisma.productReview.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Отзыв не найден');
    await this.prisma.$transaction(async (tx) => {
      await tx.productReview.delete({ where: { id } });
      await this.refreshProductRating(existing.productId, tx);
    });
    return { ok: true as const };
  }
}
