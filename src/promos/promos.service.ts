import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma, PromoType } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import {
  assertPromoUsable,
  computePromoDiscount,
  normalizePromoCode,
  type PromoLineInput,
} from './promo.util';
import type { UpsertPromoDto, ValidatePromoDto } from './dto/promo.dto';

@Injectable()
export class PromosService {
  constructor(private readonly prisma: PrismaService) {}

  private map(
    row: {
      id: string;
      code: string;
      type: PromoType;
      value: number;
      isActive: boolean;
      startsAt: Date | null;
      endsAt: Date | null;
      maxRedemptions: number | null;
      redemptionCount: number;
      appliesToAllProducts: boolean;
      createdAt: Date;
      updatedAt: Date;
      products?: Array<{ productId: string; product?: { id: string; name: string; slug: string } }>;
    },
  ) {
    return {
      id: row.id,
      code: row.code,
      type: row.type,
      value: row.value,
      isActive: row.isActive,
      startsAt: row.startsAt?.toISOString() ?? null,
      endsAt: row.endsAt?.toISOString() ?? null,
      maxRedemptions: row.maxRedemptions,
      redemptionCount: row.redemptionCount,
      appliesToAllProducts: row.appliesToAllProducts,
      productIds: row.products?.map((p) => p.productId) ?? [],
      products:
        row.products
          ?.map((p) => p.product)
          .filter(Boolean)
          .map((p) => ({ id: p!.id, name: p!.name, slug: p!.slug })) ?? [],
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list() {
    const rows = await this.prisma.promoCode.findMany({
      include: {
        products: { include: { product: { select: { id: true, name: true, slug: true } } } },
      },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((r) => this.map(r));
  }

  async get(id: string) {
    const row = await this.prisma.promoCode.findUnique({
      where: { id },
      include: {
        products: { include: { product: { select: { id: true, name: true, slug: true } } } },
      },
    });
    if (!row) throw new NotFoundException('Промокод не найден');
    return this.map(row);
  }

  private assertValue(type: PromoType, value: number) {
    if (type === PromoType.PERCENT && (value <= 0 || value > 100)) {
      throw new BadRequestException('Процент должен быть от 0.01 до 100');
    }
    if (type === PromoType.FIXED && value <= 0) {
      throw new BadRequestException('Сумма скидки должна быть больше 0');
    }
  }

  async create(dto: UpsertPromoDto) {
    const code = normalizePromoCode(dto.code);
    this.assertValue(dto.type, dto.value);
    const appliesToAll = dto.appliesToAllProducts !== false;
    const productIds = appliesToAll ? [] : [...new Set(dto.productIds ?? [])];
    if (!appliesToAll && !productIds.length) {
      throw new BadRequestException('Укажите товары или включите весь каталог');
    }

    try {
      const row = await this.prisma.promoCode.create({
        data: {
          code,
          type: dto.type,
          value: dto.value,
          isActive: dto.isActive ?? true,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
          endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
          maxRedemptions: dto.maxRedemptions ?? null,
          appliesToAllProducts: appliesToAll,
          products: productIds.length
            ? { create: productIds.map((productId) => ({ productId })) }
            : undefined,
        },
        include: {
          products: { include: { product: { select: { id: true, name: true, slug: true } } } },
        },
      });
      return this.map(row);
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        throw new ConflictException('Такой промокод уже есть');
      }
      throw e;
    }
  }

  async update(id: string, dto: UpsertPromoDto) {
    await this.get(id);
    const code = normalizePromoCode(dto.code);
    this.assertValue(dto.type, dto.value);
    const appliesToAll = dto.appliesToAllProducts !== false;
    const productIds = appliesToAll ? [] : [...new Set(dto.productIds ?? [])];
    if (!appliesToAll && !productIds.length) {
      throw new BadRequestException('Укажите товары или включите весь каталог');
    }

    const row = await this.prisma.$transaction(async (tx) => {
      await tx.promoCodeProduct.deleteMany({ where: { promoCodeId: id } });
      return tx.promoCode.update({
        where: { id },
        data: {
          code,
          type: dto.type,
          value: dto.value,
          isActive: dto.isActive ?? true,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : null,
          endsAt: dto.endsAt ? new Date(dto.endsAt) : null,
          maxRedemptions: dto.maxRedemptions ?? null,
          appliesToAllProducts: appliesToAll,
          products: productIds.length
            ? { create: productIds.map((productId) => ({ productId })) }
            : undefined,
        },
        include: {
          products: { include: { product: { select: { id: true, name: true, slug: true } } } },
        },
      });
    });
    return this.map(row);
  }

  async remove(id: string) {
    await this.get(id);
    await this.prisma.promoCode.delete({ where: { id } });
    return { ok: true as const };
  }

  private assertUsable(
    row: {
      isActive: boolean;
      startsAt: Date | null;
      endsAt: Date | null;
      maxRedemptions: number | null;
      redemptionCount: number;
    },
    now = new Date(),
  ) {
    try {
      assertPromoUsable(row, now);
    } catch (err) {
      throw new BadRequestException(
        err instanceof Error ? err.message : 'Промокод недоступен',
      );
    }
  }

  async validatePublic(dto: ValidatePromoDto) {
    const code = normalizePromoCode(dto.code);
    const row = await this.prisma.promoCode.findUnique({
      where: { code },
      include: { products: true },
    });
    if (!row) throw new NotFoundException('Промокод не найден');
    this.assertUsable(row);

    const lines: PromoLineInput[] = dto.items.map((i) => ({
      productId: i.productId,
      price: i.price,
      qty: i.qty,
    }));
    const calc = computePromoDiscount(
      {
        type: row.type,
        value: row.value,
        appliesToAllProducts: row.appliesToAllProducts,
        productIds: row.products.map((p) => p.productId),
      },
      lines,
    );
    if (calc.discountAmount <= 0) {
      throw new BadRequestException('Промокод не применяется к этим товарам');
    }
    return {
      code: row.code,
      type: row.type,
      value: row.value,
      ...calc,
      total: Math.round((calc.subtotal - calc.discountAmount) * 100) / 100,
    };
  }

  /** Server-side resolve for order create — uses DB prices from lines. */
  async resolveForOrder(codeRaw: string | undefined | null, lines: PromoLineInput[]) {
    if (!codeRaw?.trim()) return null;
    const code = normalizePromoCode(codeRaw);
    const row = await this.prisma.promoCode.findUnique({
      where: { code },
      include: { products: true },
    });
    if (!row) throw new BadRequestException('Промокод не найден');
    this.assertUsable(row);
    const calc = computePromoDiscount(
      {
        type: row.type,
        value: row.value,
        appliesToAllProducts: row.appliesToAllProducts,
        productIds: row.products.map((p) => p.productId),
      },
      lines,
    );
    if (calc.discountAmount <= 0) {
      throw new BadRequestException('Промокод не применяется к этим товарам');
    }
    return {
      promoCodeId: row.id,
      promoCode: row.code,
      discountAmount: calc.discountAmount,
      subtotal: calc.subtotal,
      total: Math.round((calc.subtotal - calc.discountAmount) * 100) / 100,
    };
  }

  async incrementRedemption(promoCodeId: string, tx: Prisma.TransactionClient) {
    // Atomic: only increment when under the limit (or unlimited).
    const updated = await tx.$executeRaw`
      UPDATE promo_codes
      SET redemption_count = redemption_count + 1,
          updated_at = NOW()
      WHERE id = ${promoCodeId}
        AND (
          max_redemptions IS NULL
          OR redemption_count < max_redemptions
        )
    `;
    if (Number(updated) !== 1) {
      throw new BadRequestException('Лимит использований исчерпан');
    }
  }
}
