import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service';
import {
  CART_COOKIE,
  CART_TTL_MS,
  clearCookieOptions,
  cookieSameSite,
  cookieSecure,
  createRawToken,
  hashToken,
  sessionCookieOptions,
} from '../auth/auth.crypto';
import {
  emptyAdjustments,
  type CartAdjustments,
  type CartLineView,
  type CartResponse,
} from './cart.types';
import { isInventoryEnabled } from '../common/inventory';

type CartRow = {
  id: string;
  userId: string | null;
  guestTokenHash: string | null;
  expiresAt: Date | null;
  items: Array<{ variantId: string; qty: number }>;
};

type VariantWithProduct = {
  id: string;
  weight: string;
  price: number;
  stock: number;
  productId: string;
  product: {
    id: string;
    name: string;
    image: string;
    slug: string;
    isActive: boolean;
  };
};

@Injectable()
export class CartService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService,
  ) {}

  private inventoryOn() {
    return isInventoryEnabled(this.config);
  }

  private secureCookies() {
    return cookieSecure(this.config);
  }

  private sameSite() {
    return cookieSameSite(this.config);
  }

  setGuestCookie(res: Response, rawToken: string) {
    res.cookie(
      CART_COOKIE,
      rawToken,
      sessionCookieOptions(this.secureCookies(), CART_TTL_MS, this.sameSite()),
    );
  }

  clearGuestCookie(res: Response) {
    res.clearCookie(
      CART_COOKIE,
      clearCookieOptions(this.secureCookies(), this.sameSite()),
    );
  }

  private async loadVariants(
    variantIds: string[],
  ): Promise<Map<string, VariantWithProduct>> {
    if (!variantIds.length) return new Map();
    const rows = await this.prisma.productVariant.findMany({
      where: { id: { in: variantIds } },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            image: true,
            slug: true,
            isActive: true,
          },
        },
      },
    });
    return new Map(rows.map((r) => [r.id, r]));
  }

  /**
   * Revalidate stored lines against live catalog/stock.
   * Returns view lines + adjustments; does not persist.
   */
  sanitizeLines(
    raw: Array<{ variantId: string; qty: number }>,
    variants: Map<string, VariantWithProduct>,
  ): { items: CartLineView[]; adjustments: CartAdjustments } {
    const adjustments = emptyAdjustments();
    const items: CartLineView[] = [];

    for (const line of raw) {
      const qty = Math.max(0, Math.floor(line.qty));
      if (qty <= 0) continue;

      const variant = variants.get(line.variantId);
      if (!variant) {
        adjustments.removed.push({
          variantId: line.variantId,
          reason: 'missing',
        });
        continue;
      }
      if (!variant.product.isActive) {
        adjustments.removed.push({
          variantId: line.variantId,
          reason: 'inactive',
        });
        continue;
      }
      if (this.inventoryOn() && variant.stock <= 0) {
        adjustments.removed.push({
          variantId: line.variantId,
          reason: 'out_of_stock',
        });
        continue;
      }

      let lineQty = qty;
      if (this.inventoryOn()) {
        const capped = Math.min(qty, variant.stock);
        if (capped < qty) {
          adjustments.capped.push({
            variantId: line.variantId,
            from: qty,
            to: capped,
          });
        }
        lineQty = capped;
      }

      items.push({
        productId: variant.product.id,
        variantId: variant.id,
        productSlug: variant.product.slug,
        name: variant.product.name,
        image: variant.product.image,
        weight: variant.weight,
        price: variant.price,
        qty: lineQty,
        stock: variant.stock,
      });
    }

    return { items, adjustments };
  }

  private mergeAdjustments(
    a: CartAdjustments,
    b: CartAdjustments,
  ): CartAdjustments {
    return {
      removed: [...a.removed, ...b.removed],
      capped: [...a.capped, ...b.capped],
    };
  }

  private async persistSanitized(
    cartId: string,
    items: CartLineView[],
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.cartItem.deleteMany({ where: { cartId } });
      if (items.length) {
        await tx.cartItem.createMany({
          data: items.map((i) => ({
            cartId,
            variantId: i.variantId,
            qty: i.qty,
          })),
        });
      }
      await tx.cart.update({
        where: { id: cartId },
        data: { updatedAt: new Date() },
      });
    });
  }

  private async findGuestCart(rawToken?: string): Promise<CartRow | null> {
    if (!rawToken?.trim()) return null;
    const tokenHash = hashToken(rawToken);
    const cart = await this.prisma.cart.findUnique({
      where: { guestTokenHash: tokenHash },
      include: { items: { select: { variantId: true, qty: true } } },
    });
    if (!cart) return null;
    if (cart.expiresAt && cart.expiresAt.getTime() < Date.now()) {
      await this.prisma.cart
        .delete({ where: { id: cart.id } })
        .catch(() => undefined);
      return null;
    }
    return cart;
  }

  private async findUserCart(userId: string): Promise<CartRow | null> {
    return this.prisma.cart.findUnique({
      where: { userId },
      include: { items: { select: { variantId: true, qty: true } } },
    });
  }

  private async ensureUserCart(userId: string): Promise<CartRow> {
    const existing = await this.findUserCart(userId);
    if (existing) return existing;
    return this.prisma.cart.create({
      data: { userId },
      include: { items: { select: { variantId: true, qty: true } } },
    });
  }

  private async ensureGuestCart(rawToken?: string): Promise<{
    cart: CartRow;
    rawToken: string;
    created: boolean;
  }> {
    const existing = await this.findGuestCart(rawToken);
    if (existing && rawToken) {
      await this.prisma.cart.update({
        where: { id: existing.id },
        data: { expiresAt: new Date(Date.now() + CART_TTL_MS) },
      });
      return { cart: existing, rawToken, created: false };
    }

    const token = createRawToken();
    const cart = await this.prisma.cart.create({
      data: {
        guestTokenHash: hashToken(token),
        expiresAt: new Date(Date.now() + CART_TTL_MS),
      },
      include: { items: { select: { variantId: true, qty: true } } },
    });
    return { cart, rawToken: token, created: true };
  }

  /**
   * Merge guest lines into user cart: sum qtys, then sanitize (drop/cap).
   * Deletes guest cart. Returns sanitized user cart + adjustments.
   */
  async mergeGuestIntoUser(
    userId: string,
    guestRawToken: string | undefined,
    res?: Response,
  ): Promise<CartResponse> {
    const guest = await this.findGuestCart(guestRawToken);
    const userCart = await this.ensureUserCart(userId);

    if (!guest || guest.id === userCart.id) {
      return this.getCartForUser(userId);
    }

    const combined = new Map<string, number>();
    for (const line of userCart.items) {
      combined.set(
        line.variantId,
        (combined.get(line.variantId) ?? 0) + line.qty,
      );
    }
    for (const line of guest.items) {
      combined.set(
        line.variantId,
        (combined.get(line.variantId) ?? 0) + line.qty,
      );
    }

    const raw = [...combined.entries()].map(([variantId, qty]) => ({
      variantId,
      qty,
    }));
    const variants = await this.loadVariants(raw.map((r) => r.variantId));
    const { items, adjustments } = this.sanitizeLines(raw, variants);
    await this.persistSanitized(userCart.id, items);
    await this.prisma.cart
      .delete({ where: { id: guest.id } })
      .catch(() => undefined);
    if (res) this.clearGuestCookie(res);

    return { items, adjustments };
  }

  async getCartForUser(userId: string): Promise<CartResponse> {
    const cart = await this.ensureUserCart(userId);
    const variants = await this.loadVariants(
      cart.items.map((i) => i.variantId),
    );
    const { items, adjustments } = this.sanitizeLines(cart.items, variants);
    if (adjustments.removed.length || adjustments.capped.length) {
      await this.persistSanitized(cart.id, items);
    }
    return { items, adjustments };
  }

  async getOrResolveCart(opts: {
    userId?: string;
    guestRawToken?: string;
    res: Response;
  }): Promise<CartResponse> {
    const { userId, guestRawToken, res } = opts;

    if (userId && guestRawToken) {
      return this.mergeGuestIntoUser(userId, guestRawToken, res);
    }
    if (userId) {
      return this.getCartForUser(userId);
    }

    const guest = await this.findGuestCart(guestRawToken);
    if (!guest) {
      return { items: [], adjustments: emptyAdjustments() };
    }

    const variants = await this.loadVariants(
      guest.items.map((i) => i.variantId),
    );
    const { items, adjustments } = this.sanitizeLines(guest.items, variants);
    if (adjustments.removed.length || adjustments.capped.length) {
      await this.persistSanitized(guest.id, items);
    }
    // Refresh cookie TTL
    if (guestRawToken) this.setGuestCookie(res, guestRawToken);
    return { items, adjustments };
  }

  async upsertItem(opts: {
    userId?: string;
    guestRawToken?: string;
    variantId: string;
    qty: number;
    res: Response;
  }): Promise<CartResponse & { guestToken?: string }> {
    const qty = Math.floor(opts.qty);
    if (qty < 0) {
      throw new BadRequestException('Количество не может быть отрицательным');
    }

    let cart: CartRow;
    let guestToken: string | undefined;

    if (opts.userId) {
      if (opts.guestRawToken) {
        await this.mergeGuestIntoUser(
          opts.userId,
          opts.guestRawToken,
          opts.res,
        );
      }
      cart = await this.ensureUserCart(opts.userId);
    } else {
      const ensured = await this.ensureGuestCart(opts.guestRawToken);
      cart = ensured.cart;
      guestToken = ensured.rawToken;
      this.setGuestCookie(opts.res, ensured.rawToken);
    }

    if (qty === 0) {
      await this.prisma.cartItem.deleteMany({
        where: { cartId: cart.id, variantId: opts.variantId },
      });
      return {
        ...(opts.userId
          ? await this.getCartForUser(opts.userId)
          : await this.getOrResolveCart({
              guestRawToken: guestToken ?? opts.guestRawToken,
              res: opts.res,
            })),
        guestToken,
      };
    }

    const variants = await this.loadVariants([opts.variantId]);
    const variant = variants.get(opts.variantId);
    if (!variant) {
      throw new NotFoundException('Вариант товара не найден');
    }
    if (!variant.product.isActive) {
      throw new BadRequestException('Товар снят с продажи');
    }
    if (this.inventoryOn() && variant.stock <= 0) {
      throw new BadRequestException('Товара нет в наличии');
    }

    const existing = await this.prisma.cartItem.findUnique({
      where: {
        cartId_variantId: { cartId: cart.id, variantId: opts.variantId },
      },
    });
    const requested = qty;
    const capped = this.inventoryOn()
      ? Math.min(requested, variant.stock)
      : requested;
    const adjustments = emptyAdjustments();
    if (this.inventoryOn() && capped < requested) {
      adjustments.capped.push({
        variantId: opts.variantId,
        from: requested,
        to: capped,
      });
    }

    if (existing) {
      await this.prisma.cartItem.update({
        where: { id: existing.id },
        data: { qty: capped },
      });
    } else {
      await this.prisma.cartItem.create({
        data: {
          cartId: cart.id,
          variantId: opts.variantId,
          qty: capped,
        },
      });
    }

    const refreshed = opts.userId
      ? await this.getCartForUser(opts.userId)
      : await this.getOrResolveCart({
          guestRawToken: guestToken ?? opts.guestRawToken,
          res: opts.res,
        });

    return {
      items: refreshed.items,
      adjustments: this.mergeAdjustments(adjustments, refreshed.adjustments),
      guestToken,
    };
  }

  async removeItem(opts: {
    userId?: string;
    guestRawToken?: string;
    variantId: string;
    res: Response;
  }): Promise<CartResponse> {
    return this.upsertItem({ ...opts, qty: 0 });
  }

  /** Drop ordered lines from user and/or guest cart (best-effort after checkout). */
  async removeVariants(opts: {
    userId?: string | null;
    guestRawToken?: string | null;
    variantIds: string[];
  }): Promise<void> {
    const variantIds = [
      ...new Set(opts.variantIds.filter((id) => Boolean(id))),
    ];
    if (!variantIds.length) return;

    if (opts.userId) {
      const cart = await this.findUserCart(opts.userId);
      if (cart) {
        await this.prisma.cartItem.deleteMany({
          where: { cartId: cart.id, variantId: { in: variantIds } },
        });
      }
    }

    if (opts.guestRawToken) {
      const guest = await this.findGuestCart(opts.guestRawToken);
      if (guest) {
        await this.prisma.cartItem.deleteMany({
          where: { cartId: guest.id, variantId: { in: variantIds } },
        });
      }
    }
  }

  async clearCart(opts: {
    userId?: string;
    guestRawToken?: string;
    res: Response;
  }): Promise<CartResponse> {
    if (opts.userId) {
      const cart = await this.findUserCart(opts.userId);
      if (cart) {
        await this.prisma.cartItem.deleteMany({ where: { cartId: cart.id } });
      }
      if (opts.guestRawToken) {
        const guest = await this.findGuestCart(opts.guestRawToken);
        if (guest) {
          await this.prisma.cart
            .delete({ where: { id: guest.id } })
            .catch(() => undefined);
        }
        this.clearGuestCookie(opts.res);
      }
      return { items: [], adjustments: emptyAdjustments() };
    }

    const guest = await this.findGuestCart(opts.guestRawToken);
    if (guest) {
      await this.prisma.cartItem.deleteMany({ where: { cartId: guest.id } });
    }
    return { items: [], adjustments: emptyAdjustments() };
  }
}
