import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DeliveryMethodCode, OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { CartService } from '../cart/cart.service';
import { PaymentsService } from '../payments/payments.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';
import { CdekService, cdekTrackingUrl } from '../cdek/cdek.service';
import { PochtaService, pochtaTrackingUrl } from '../pochta/pochta.service';
import { carrierItemSku } from './carrier-item-sku';
import { OzonDeliveryService } from '../ozon-delivery/ozon-delivery.service';
import { ozonTrackingUrl } from '../ozon-delivery/ozon-delivery.util';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { ListAdminOrdersDto } from './dto/list-admin-orders.dto';
import { resolveWeightGrams } from '../common/weight';
import { resolvePublicWebUrl } from '../common/web-origin';
import { formatPersonName, normalizeEmail } from '../common/person-name';
import { MAIL_SEND, type MailSend } from '../mail/mail.tokens';
import { buildOrderReceiptMail } from '../mail/order-receipt';
import {
  buildOrderDoneMail,
  buildOrderReadyForPickupMail,
} from '../mail/order-done';
import { buildPaidOrderStaffNotifyMail } from '../mail/order-paid-staff';
import { PromosService } from '../promos/promos.service';
import { SettingsService } from '../settings/settings.service';
import { PickupService } from '../pickup/pickup.service';
import { CdekEntityNotFoundError } from '../cdek/cdek.errors';
import { PochtaEntityNotFoundError } from '../pochta/pochta.errors';
import { YandexEntityNotFoundError } from '../yandex/yandex.errors';
import { orderStatusAfterCarrierGone, OPEN_ORDER_STATUSES } from './order-status.util';
import { resolveOrderStatusAfterCarrier } from './carrier-order-status';
import {
  FINAL_DELIVERY_STATUS_CODES,
  isCarrierAbandonedStatus,
} from './delivery-status.util';

const DELIVERY_SYNC_TTL_MS = 3 * 60 * 1000;

type ResolvedLine = {
  productId: string;
  variantId: string;
  sku: string;
  productName: string;
  image: string;
  weight: string;
  weightGrams: number;
  lengthCm: number;
  widthCm: number;
  heightCm: number;
  price: number;
  qty: number;
};

@Injectable()
export class OrdersService {
  private readonly logger = new Logger(OrdersService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly cart: CartService,
    private readonly yandex: YandexDeliveryService,
    private readonly cdek: CdekService,
    private readonly pochta: PochtaService,
    private readonly ozonDelivery: OzonDeliveryService,
    private readonly payments: PaymentsService,
    private readonly promos: PromosService,
    private readonly settings: SettingsService,
    private readonly pickup: PickupService,
    private readonly config: ConfigService,
    @Inject(MAIL_SEND) private readonly sendMail: MailSend,
  ) {}

  private webOrigin(): string {
    return resolvePublicWebUrl(this.config);
  }

  private async notifyOrderReceipt(input: {
    id: string;
    number: number;
    email: string;
    total: number;
    needsLogin: boolean;
    paid: boolean;
    items: Array<{
      productName: string;
      weight: string;
      price: number;
      qty: number;
      image: string;
    }>;
  }) {
    const mail = buildOrderReceiptMail({
      orderNumber: input.number,
      total: input.total,
      items: input.items,
      webOrigin: this.webOrigin(),
      needsLogin: input.needsLogin,
      paid: input.paid,
    });
    try {
      await this.sendMail({
        to: input.email,
        subject: mail.subject,
        text: mail.text,
        html: mail.html,
        attachments: mail.attachments,
      });
    } catch (err) {
      this.logger.warn(
        `Order mail failed for ${input.id}: ${
          err instanceof Error ? err.message : 'unknown'
        }`,
      );
    }
  }

  /** Resolve cart lines from DB — never trust client price/name/image. */
  private async resolveItems(
    items: CreateOrderDto['items'],
    inventoryEnabled?: boolean,
  ): Promise<ResolvedLine[]> {
    const inventoryOn =
      inventoryEnabled ?? (await this.settings.isInventoryEnabled());
    const variantIds = items.map((item) => {
      const id = item.variantId?.trim();
      if (!id) {
        throw new BadRequestException('Укажите вариант товара (variantId)');
      }
      return id;
    });

    const variants = await this.prisma.productVariant.findMany({
      where: { id: { in: [...new Set(variantIds)] } },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            image: true,
            isActive: true,
          },
        },
      },
    });
    const byId = new Map(variants.map((v) => [v.id, v]));

    return items.map((item) => {
      const variantId = item.variantId!.trim();
      const variant = byId.get(variantId);

      if (!variant || !variant.product.isActive) {
        throw new BadRequestException(
          'Товар недоступен для заказа — обновите корзину',
        );
      }
      if (inventoryOn && variant.stock < item.qty) {
        throw new BadRequestException(
          `В наличии только ${variant.stock} шт. — ${variant.product.name} (${variant.weight})`,
        );
      }

      return {
        productId: variant.productId,
        variantId: variant.id,
        sku: variant.sku,
        productName: variant.product.name,
        image: variant.product.image,
        weight: variant.weight,
        weightGrams: resolveWeightGrams(variant.weightGrams, variant.weight),
        lengthCm: variant.lengthCm,
        widthCm: variant.widthCm,
        heightCm: variant.heightCm,
        price: variant.price,
        qty: item.qty,
      };
    });
  }

  async create(
    sessionUserId: string | null,
    dto: CreateOrderDto,
    cartOpts: { guestRawToken?: string } = {},
  ) {
    const deliveryCode = dto.deliveryCode.trim().toUpperCase();
    const pickupCode = dto.pickupCode?.trim() || null;
    const payEnabled = this.payments.isConfigured();

    const lastName = dto.lastName.trim();
    const firstName = dto.firstName.trim();
    const phone = dto.phone.trim();
    if (!lastName || !firstName) {
      throw new BadRequestException('Укажите фамилию и имя');
    }
    if (phone.replace(/\D/g, '').length < 11) {
      throw new BadRequestException('Укажите корректный телефон');
    }

    const sessionUser = sessionUserId
      ? await this.prisma.user.findUnique({
          where: { id: sessionUserId },
          select: {
            id: true,
            email: true,
            emailVerifiedAt: true,
            privacyConsentAt: true,
          },
        })
      : null;
    if (sessionUserId && !sessionUser) {
      throw new BadRequestException('Сессия недействительна — войдите снова');
    }

    const email = sessionUser ? sessionUser.email : normalizeEmail(dto.email);
    if (!email || !email.includes('@')) {
      throw new BadRequestException('Укажите корректный email');
    }

    const recipientName = formatPersonName({
      lastName,
      firstName,
    });

    const consentNow = new Date();
    const owner = sessionUser
      ? sessionUser
      : await (async () => {
          const existing = await this.prisma.user.findUnique({
            where: { email },
          });
          if (existing) {
            if (existing.emailVerifiedAt) {
              throw new BadRequestException(
                'Этот email уже зарегистрирован. Войдите в аккаунт, чтобы оформить заказ.',
              );
            }
            if (!existing.privacyConsentAt && dto.privacyConsent !== true) {
              throw new BadRequestException(
                'Нужно согласие на обработку персональных данных',
              );
            }
            return this.prisma.user.update({
              where: { id: existing.id },
              data: {
                phone,
                lastName,
                firstName,
                ...(existing.privacyConsentAt
                  ? {}
                  : { privacyConsentAt: consentNow }),
              },
            });
          }
          if (dto.privacyConsent !== true) {
            throw new BadRequestException(
              'Нужно согласие на обработку персональных данных',
            );
          }
          return this.prisma.user.create({
            data: {
              email,
              phone,
              lastName,
              firstName,
              privacyConsentAt: consentNow,
            },
          });
        })();

    const establishSessionUserId = sessionUser ? null : owner.id;

    // Logged-in user: keep profile in sync with checkout (+ consent if missing).
    if (sessionUser) {
      if (!sessionUser.privacyConsentAt && dto.privacyConsent !== true) {
        throw new BadRequestException(
          'Нужно согласие на обработку персональных данных',
        );
      }
      await this.prisma.user.update({
        where: { id: sessionUser.id },
        data: {
          phone,
          lastName,
          firstName,
          ...(sessionUser.privacyConsentAt
            ? {}
            : { privacyConsentAt: consentNow }),
        },
      });
    }

    const userId = owner.id;
    const inventoryEnabled = await this.settings.isInventoryEnabled();
    const resolvedItems = await this.resolveItems(dto.items, inventoryEnabled);
    const merchandiseTotal = resolvedItems.reduce(
      (s, i) => s + i.price * i.qty,
      0,
    );
    const promoApplied = await this.promos.resolveForOrder(
      dto.promoCode,
      resolvedItems.map((i) => ({
        productId: i.productId,
        price: i.price,
        qty: i.qty,
      })),
    );
    const subtotal = promoApplied?.subtotal ?? merchandiseTotal;
    const discountAmount = promoApplied?.discountAmount ?? 0;
    const total = promoApplied?.total ?? merchandiseTotal;

    const deliveryMethod = await this.prisma.deliveryMethod.findFirst({
      where: {
        code: deliveryCode as DeliveryMethodCode,
        isActive: true,
      },
      select: { id: true },
    });
    if (!deliveryMethod) {
      throw new BadRequestException('Выбранный способ доставки недоступен');
    }

    if (deliveryCode === DeliveryMethodCode.YANDEX) {
      if (!pickupCode) {
        throw new BadRequestException('Выберите пункт выдачи Яндекс');
      }
      if (!this.yandex.isOrderCreationConfigured()) {
        throw new BadRequestException(
          'Оформление через Яндекс Доставку временно недоступно',
        );
      }
    }

    if (deliveryCode === DeliveryMethodCode.CDEK) {
      if (!pickupCode) {
        throw new BadRequestException('Выберите пункт выдачи СДЭК');
      }
      if (!this.cdek.isOrderCreationConfigured()) {
        throw new BadRequestException(
          'Оформление через СДЭК временно недоступно',
        );
      }
    }

    if (deliveryCode === DeliveryMethodCode.POST) {
      if (!pickupCode) {
        throw new BadRequestException('Выберите отделение Почты России');
      }
      if (!this.pochta.isOrderCreationConfigured()) {
        throw new BadRequestException(
          'Оформление через Почту России временно недоступно',
        );
      }
    }

    let storePickupAt: Date | null = null;
    let storePickupAddress: string | null = null;
    if (deliveryCode === DeliveryMethodCode.PICKUP) {
      const raw = dto.storePickupAt?.trim();
      if (!raw) {
        throw new BadRequestException('Выберите дату и время самовывоза');
      }
      const parsed = new Date(raw);
      if (Number.isNaN(parsed.getTime())) {
        throw new BadRequestException('Некорректная дата самовывоза');
      }
      const settings = await this.pickup.assertValidSlot(parsed);
      storePickupAt = parsed;
      storePickupAddress = settings.address;
    }

    const order = await this.prisma.$transaction(async (tx) => {
      if (promoApplied?.promoCodeId) {
        await this.promos.incrementRedemption(promoApplied.promoCodeId, tx);
      }

      if (inventoryEnabled) {
        for (const item of resolvedItems) {
          const updated = await tx.productVariant.updateMany({
            where: { id: item.variantId, stock: { gte: item.qty } },
            data: { stock: { decrement: item.qty } },
          });
          if (updated.count !== 1) {
            const fresh = await tx.productVariant.findUnique({
              where: { id: item.variantId },
              include: {
                product: { select: { name: true } },
              },
            });
            throw new BadRequestException(
              `В наличии только ${fresh?.stock ?? 0} шт. — ${fresh?.product.name ?? 'товар'} (${fresh?.weight ?? ''})`,
            );
          }
        }
      }

      return tx.order.create({
        data: {
          userId,
          email,
          phone,
          lastName,
          firstName,
          contactChannel: dto.contactChannel.trim(),
          cityLabel: dto.cityLabel.trim(),
          deliveryCode,
          deliveryTitle: dto.deliveryTitle.trim(),
          pickupLabel: dto.pickupLabel?.trim() || null,
          pickupCode,
          storePickupAt,
          storePickupAddress,
          subtotal,
          discountAmount,
          promoCodeId: promoApplied?.promoCodeId ?? null,
          promoCode: promoApplied?.promoCode ?? null,
          total,
          items: {
            create: resolvedItems.map((i) => ({
              productId: i.productId,
              variantId: i.variantId,
              productName: i.productName,
              image: i.image,
              weight: i.weight,
              weightGrams: i.weightGrams,
              lengthCm: i.lengthCm,
              widthCm: i.widthCm,
              heightCm: i.heightCm,
              price: i.price,
              qty: i.qty,
            })),
          },
        },
        include: {
          items: {
            include: {
              product: { select: { slug: true, isActive: true } },
            },
          },
        },
      });
    });

    let externalDeliveryId: string | null = null;
    let deliveryTrackNumber: string | null = null;
    let deliveryTrackingUrl: string | null = null;

    // Without Ozon Pay: create carrier shipment now, using public order number.
    if (!payEnabled && pickupCode) {
      try {
        if (
          deliveryCode === DeliveryMethodCode.YANDEX &&
          this.yandex.isOrderCreationConfigured()
        ) {
          const yandexOrder = await this.yandex.createPickupOrder({
            requestId: String(order.number),
            pickupPointId: pickupCode,
            phone,
            recipientName,
            comment: `Заказ Агнюша · ${dto.cityLabel}`,
            items: resolvedItems.map((item) => ({
              name: item.productName,
              article: carrierItemSku({ sku: item.sku, variantId: item.variantId }),
              price: item.price,
              qty: item.qty,
              weightGrams: item.weightGrams,
              lengthCm: item.lengthCm,
              widthCm: item.widthCm,
              heightCm: item.heightCm,
            })),
          });
          externalDeliveryId = yandexOrder.requestId;
        } else if (
          deliveryCode === DeliveryMethodCode.CDEK &&
          this.cdek.isOrderCreationConfigured()
        ) {
          const cdekOrder = await this.cdek.createPickupOrder({
            orderNumber: String(order.number),
            deliveryPointCode: pickupCode,
            phone,
            recipientName,
            comment: `Заказ Агнюша · ${dto.cityLabel}`,
            items: resolvedItems.map((item) => ({
              name: item.productName,
              wareKey: carrierItemSku({ sku: item.sku, variantId: item.variantId }),
              price: item.price,
              qty: item.qty,
              weightGrams: item.weightGrams,
              lengthCm: item.lengthCm,
              widthCm: item.widthCm,
              heightCm: item.heightCm,
            })),
          });
          externalDeliveryId = cdekOrder.uuid;
          deliveryTrackNumber = cdekOrder.cdekNumber;
          deliveryTrackingUrl = cdekOrder.cdekNumber
            ? cdekTrackingUrl(cdekOrder.cdekNumber)
            : null;
        } else if (
          deliveryCode === DeliveryMethodCode.POST &&
          this.pochta.isOrderCreationConfigured()
        ) {
          const pochtaOrder = await this.pochta.createPickupOrder({
            orderNumber: String(order.number),
            deliveryPointCode: pickupCode,
            phone,
            recipientName,
            lastName,
            firstName,
            comment: `Заказ Агнюша · ${dto.cityLabel}`,
            cityLabel: dto.cityLabel,
            items: resolvedItems.map((item) => ({
              name: item.productName,
              wareKey: carrierItemSku({ sku: item.sku, variantId: item.variantId }),
              price: item.price,
              qty: item.qty,
              weightGrams: item.weightGrams,
              lengthCm: item.lengthCm,
              widthCm: item.widthCm,
              heightCm: item.heightCm,
            })),
          });
          externalDeliveryId = pochtaOrder.orderId;
          deliveryTrackNumber = pochtaOrder.barcode;
          deliveryTrackingUrl = pochtaOrder.barcode
            ? pochtaTrackingUrl(pochtaOrder.barcode)
            : null;
        } else if (
          deliveryCode === DeliveryMethodCode.OZON &&
          this.ozonDelivery.isOrderCreationConfigured()
        ) {
          const ozonOrder = await this.ozonDelivery.createPickupOrder({
            orderNumber: String(order.number),
            deliveryPointCode: pickupCode,
            phone,
            recipientName,
            comment: `Заказ Агнюша · ${dto.cityLabel}`,
            items: resolvedItems.map((item) => ({
              name: item.productName,
              wareKey: carrierItemSku({ sku: item.sku, variantId: item.variantId }),
              price: item.price,
              qty: item.qty,
              weightGrams: item.weightGrams,
              lengthCm: item.lengthCm,
              widthCm: item.widthCm,
              heightCm: item.heightCm,
            })),
          });
          externalDeliveryId = ozonOrder.orderNumber;
          deliveryTrackNumber = ozonOrder.postingNumber || ozonOrder.orderNumber;
          deliveryTrackingUrl =
            ozonOrder.trackingUrl || ozonTrackingUrl(ozonOrder.orderNumber);
        }
      } catch (err) {
        await this.prisma.$transaction(async (tx) => {
          await this.restoreStock(tx, order.items);
          await tx.orderItem.deleteMany({ where: { orderId: order.id } });
          await tx.order.delete({ where: { id: order.id } });
        });
        throw err;
      }

      if (externalDeliveryId) {
        await this.prisma.order.update({
          where: { id: order.id },
          data: {
            externalDeliveryId,
            deliveryTrackNumber,
            deliveryTrackingUrl,
          },
        });
      }
    }

    const orderWithDelivery = {
      ...order,
      externalDeliveryId,
      deliveryTrackNumber,
      deliveryTrackingUrl,
    };
    const clearOrderedFromCart = async () => {
      try {
        await this.cart.removeVariants({
          userId: sessionUserId,
          guestRawToken: cartOpts.guestRawToken,
          variantIds: resolvedItems.map((i) => i.variantId),
        });
      } catch (err) {
        this.logger.warn(
          `Cart cleanup after order ${order.id} failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    };

    if (!payEnabled) {
      await this.notifyOrderReceipt({
        id: order.id,
        number: order.number,
        email,
        total,
        needsLogin: !sessionUser?.emailVerifiedAt,
        paid: false,
        items: order.items.map((i) => ({
          productName: i.productName,
          weight: i.weight,
          price: i.price,
          qty: i.qty,
          image: i.image,
        })),
      });
      await clearOrderedFromCart();
      return {
        order: this.map(orderWithDelivery),
        establishSessionUserId,
      };
    }

    try {
      const payment = await this.payments.createPayment({
        orderId: order.id,
        orderNumber: order.number,
        totalRub: total,
        items: resolvedItems.map((i) => ({
          extId: i.variantId,
          name: `${i.productName} (${i.weight})`,
          priceRub: i.price,
          qty: i.qty,
        })),
      });

      const updated = await this.prisma.order.update({
        where: { id: order.id },
        data: {
          paymentExternalId: payment.paymentExternalId,
          paymentPayLink: payment.payLink,
        },
        include: {
          items: {
            include: {
              product: { select: { slug: true, isActive: true } },
            },
          },
        },
      });

      await clearOrderedFromCart();
      return {
        order: { ...this.map(updated), payUrl: payment.payLink },
        establishSessionUserId,
      };
    } catch (err) {
      await this.prisma.order
        .delete({ where: { id: order.id } })
        .catch(() => undefined);
      throw err;
    }
  }

  async listForUser(
    userId: string,
    query: { page?: number; limit?: number; openOnly?: boolean } = {},
  ) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 10;
    const where = {
      userId,
      ...(query.openOnly
        ? { status: { in: OPEN_ORDER_STATUSES } }
        : {}),
    };

    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        include: {
          items: {
            include: {
              product: { select: { slug: true, isActive: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.count({ where }),
    ]);

    // List stays DB-only — carrier sync runs on get/reconcile + delivery poller.
    return {
      items: orders.map((order) => this.map(order)),
      total,
      page,
      limit,
    };
  }

  /**
   * After list is shown: sync a few unpaid NEW orders with Ozon (TTL-limited).
   * Returns only orders that changed to paid (for UI merge).
   */
  async reconcilePaymentsForUser(userId: string) {
    const paidIds = await this.payments.reconcileUnpaidOrdersForUser(userId);
    if (paidIds.length === 0) {
      return { items: [] as Array<ReturnType<OrdersService['map']>> };
    }

    const orders = await this.prisma.order.findMany({
      where: { userId, id: { in: paidIds } },
      include: {
        items: {
          include: {
            product: { select: { slug: true, isActive: true } },
          },
        },
      },
    });

    const items: Array<ReturnType<OrdersService['map']>> = [];
    for (const order of orders) {
      items.push(this.map(await this.syncDeliveryTracking(order)));
    }
    return { items };
  }

  async getForUser(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: {
        items: {
          include: {
            product: { select: { slug: true, isActive: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Заказ не найден');
    return this.map(await this.syncDeliveryTracking(order));
  }

  /** Resume Ozon Pay for an unpaid order owned by the user. */
  async getPayUrlForUser(userId: string, orderId: string) {
    const order = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
    });
    if (!order) throw new NotFoundException('Заказ не найден');

    if (order.paidAt || order.status !== OrderStatus.NEW) {
      throw new BadRequestException('Этот заказ уже нельзя оплатить');
    }

    if (order.paymentPayLink) {
      return { payUrl: order.paymentPayLink };
    }

    if (!this.payments.isConfigured()) {
      throw new BadRequestException('Оплата временно недоступна');
    }

    const fresh = await this.payments.resolvePayLink(order);
    if (!fresh) {
      throw new BadRequestException(
        'Ссылка на оплату недоступна. Оформите заказ заново.',
      );
    }

    await this.prisma.order.update({
      where: { id: order.id },
      data: { paymentPayLink: fresh },
    });

    return { payUrl: fresh };
  }

  async listAdmin(query: ListAdminOrdersDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const q = query.q?.trim() || '';

    const searchWhere: Prisma.OrderWhereInput = {};
    if (q) {
      const asNumber = /^\d+$/.test(q) ? Number.parseInt(q, 10) : NaN;
      searchWhere.OR = [
        { id: { contains: q, mode: 'insensitive' } },
        ...(Number.isFinite(asNumber) ? [{ number: asNumber }] : []),
        { phone: { contains: q, mode: 'insensitive' } },
        { cityLabel: { contains: q, mode: 'insensitive' } },
        { pickupLabel: { contains: q, mode: 'insensitive' } },
        { deliveryTrackNumber: { contains: q, mode: 'insensitive' } },
        { externalDeliveryId: { contains: q, mode: 'insensitive' } },
        { email: { contains: q, mode: 'insensitive' } },
        { user: { email: { contains: q, mode: 'insensitive' } } },
      ];
    }

    const where: Prisma.OrderWhereInput = {
      ...searchWhere,
      ...(query.status ? { status: query.status } : {}),
    };

    const [total, orders, statusGroups] = await this.prisma.$transaction([
      this.prisma.order.count({ where }),
      this.prisma.order.findMany({
        where,
        include: {
          user: { select: { email: true } },
          items: {
            include: {
              product: { select: { slug: true, isActive: true } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.order.groupBy({
        by: ['status'],
        where: searchWhere,
        _count: { _all: true },
        orderBy: { status: 'asc' },
      }),
    ]);

    const counts: Record<string, number> = {
      NEW: 0,
      PAID: 0,
      CONFIRMED: 0,
      SHIPPED: 0,
      READY_FOR_PICKUP: 0,
      DONE: 0,
      CANCELLED: 0,
      ARCHIVED: 0,
    };
    for (const row of statusGroups) {
      const all =
        typeof row._count === 'object' && row._count != null
          ? row._count._all
          : undefined;
      counts[row.status] = all ?? 0;
    }

    // Admin list uses stored tracking; detail/get + poller refresh carriers.
    return {
      items: orders.map((o) => this.mapAdmin(o)),
      total,
      page,
      limit,
      counts,
    };
  }

  async updateStatus(orderId: string, status: OrderStatus) {
    const existing = await this.prisma.order.findUnique({
      where: { id: orderId },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('Заказ не найден');

    const order = await this.prisma.$transaction(async (tx) => {
      if (
        status === OrderStatus.CANCELLED &&
        existing.status !== OrderStatus.CANCELLED
      ) {
        await this.restoreStock(tx, existing.items);
      }

      return tx.order.update({
        where: { id: orderId },
        data: {
          status,
          ...(status === OrderStatus.PAID && !existing.paidAt
            ? { paidAt: new Date() }
            : {}),
        },
        include: {
          user: { select: { email: true } },
          items: {
            include: {
              product: { select: { slug: true, isActive: true } },
            },
          },
        },
      });
    });

    this.maybeNotifyStatusMail(existing.status, order);
    if (status === OrderStatus.PAID && !existing.paidAt) {
      void this.notifyStaffPaidOrder(order).catch((err) => {
        this.logger.warn(
          `Paid order staff mail failed for ${order.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }

    return this.mapAdmin(order);
  }

  private async notifyStaffPaidOrder(order: {
    id: string;
    number: number;
    email: string;
    phone: string;
    lastName: string;
    firstName: string;
    deliveryTitle: string;
    cityLabel: string;
    total: number;
    items: Array<{
      productName: string;
      weight: string;
      price: number;
      qty: number;
    }>;
  }) {
    const recipients = await this.settings.getPaidOrderNotifyEmails();
    if (!recipients.length) return;

    const mail = buildPaidOrderStaffNotifyMail({
      orderNumber: order.number,
      total: order.total,
      customerEmail: order.email,
      customerName: formatPersonName({
        lastName: order.lastName,
        firstName: order.firstName,
      }),
      phone: order.phone,
      deliveryTitle: order.deliveryTitle,
      cityLabel: order.cityLabel,
      webOrigin: this.webOrigin(),
      items: order.items.map((i) => ({
        productName: i.productName,
        weight: i.weight,
        qty: i.qty,
        price: i.price,
      })),
    });

    for (const to of recipients) {
      try {
        await this.sendMail({
          to,
          subject: mail.subject,
          text: mail.text,
          html: mail.html,
        });
      } catch (err) {
        this.logger.warn(
          `Paid order staff mail failed for ${order.id} → ${to}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
  }

  private maybeNotifyStatusMail(
    previous: OrderStatus,
    order: {
      id: string;
      number: number;
      email: string;
      status: OrderStatus;
      pickupLabel: string | null;
      deliveryTitle: string;
      cityLabel: string;
    },
  ) {
    if (
      order.status === OrderStatus.READY_FOR_PICKUP &&
      previous !== OrderStatus.READY_FOR_PICKUP
    ) {
      void this.notifyOrderReadyForPickup(order).catch((err) => {
        this.logger.warn(
          `Order ready-for-pickup mail failed for ${order.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }
    if (
      order.status === OrderStatus.DONE &&
      previous !== OrderStatus.DONE
    ) {
      void this.notifyOrderDone(order).catch((err) => {
        this.logger.warn(
          `Order done mail failed for ${order.id}: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      });
    }
  }

  private async notifyOrderReadyForPickup(order: {
    id: string;
    number: number;
    email: string;
    pickupLabel: string | null;
    deliveryTitle: string;
    cityLabel: string;
  }) {
    const mail = buildOrderReadyForPickupMail({
      orderNumber: order.number,
      webOrigin: this.webOrigin(),
      pickupLabel: order.pickupLabel,
      deliveryTitle: order.deliveryTitle,
      cityLabel: order.cityLabel,
    });
    await this.sendMail({
      to: order.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  }

  private async notifyOrderDone(order: {
    id: string;
    number: number;
    email: string;
    pickupLabel: string | null;
    deliveryTitle: string;
    cityLabel: string;
  }) {
    const mail = buildOrderDoneMail({
      orderNumber: order.number,
      webOrigin: this.webOrigin(),
      pickupLabel: order.pickupLabel,
      deliveryTitle: order.deliveryTitle,
      cityLabel: order.cityLabel,
    });
    await this.sendMail({
      to: order.email,
      subject: mail.subject,
      html: mail.html,
      text: mail.text,
    });
  }

  /** Buyer may cancel only unpaid NEW orders. */
  async cancelForUser(userId: string, orderId: string) {
    const existing = await this.prisma.order.findFirst({
      where: { id: orderId, userId },
      include: { items: true },
    });
    if (!existing) throw new NotFoundException('Заказ не найден');
    if (existing.paidAt || existing.status !== OrderStatus.NEW) {
      throw new BadRequestException('Отменить можно только неоплаченный заказ');
    }

    const order = await this.prisma.$transaction(async (tx) => {
      await this.restoreStock(tx, existing.items);
      return tx.order.update({
        where: { id: orderId },
        data: { status: OrderStatus.CANCELLED },
        include: {
          items: {
            include: {
              product: { select: { slug: true, isActive: true } },
            },
          },
        },
      });
    });

    return this.map(order);
  }

  private async restoreStock(
    tx: Prisma.TransactionClient,
    items: Array<{ variantId: string | null; qty: number }>,
  ) {
    if (!(await this.settings.isInventoryEnabled())) return;
    const byVariant = new Map<string, number>();
    for (const item of items) {
      if (!item.variantId || item.qty <= 0) continue;
      byVariant.set(
        item.variantId,
        (byVariant.get(item.variantId) ?? 0) + item.qty,
      );
    }
    for (const [variantId, qty] of byVariant) {
      await tx.productVariant.update({
        where: { id: variantId },
        data: { stock: { increment: qty } },
      });
    }
  }

  /**
   * Poll CDEK/Yandex/Pochta for tracking when TTL expired.
   * Used on order detail / reconcile / background poller — not on list endpoints.
   */
  async syncDeliveryTracking<
    T extends {
      id: string;
      status: OrderStatus;
      deliveryCode: string;
      externalDeliveryId: string | null;
      deliveryTrackNumber: string | null;
      deliveryStatusCode: string | null;
      deliveryStatusLabel: string | null;
      deliveryTrackingUrl: string | null;
      deliveryStatusAt: Date | null;
    },
  >(order: T): Promise<T> {
    if (
      order.deliveryCode !== DeliveryMethodCode.CDEK &&
      order.deliveryCode !== DeliveryMethodCode.YANDEX &&
      order.deliveryCode !== DeliveryMethodCode.POST
    ) {
      return order;
    }
    const carrierLabel =
      order.deliveryCode === DeliveryMethodCode.CDEK
        ? 'СДЭК'
        : order.deliveryCode === DeliveryMethodCode.YANDEX
          ? 'Яндекс Доставка'
          : order.deliveryCode === DeliveryMethodCode.POST
            ? 'Почта России'
            : 'перевозчик';

    if (order.status === OrderStatus.ARCHIVED) {
      return order;
    }

    // Shipment create-after-pay may still be retrying (confirmPaid polls markOrderPaid).
    // Keep PAID+ visible for staff — do not archive just because the id is missing yet.
    if (!order.externalDeliveryId) {
      return order;
    }

    // CDEK may keep a deleted/rejected shipment as INVALID instead of 404.
    // Heal stuck PAID+INVALID rows without waiting for another carrier call.
    if (
      isCarrierAbandonedStatus(order.deliveryStatusCode) &&
      orderStatusAfterCarrierGone(order.status) !== order.status
    ) {
      return this.markCarrierShipmentGone(order, carrierLabel);
    }

    if (
      order.deliveryStatusCode &&
      FINAL_DELIVERY_STATUS_CODES.has(order.deliveryStatusCode)
    ) {
      // Heal Order.status if tracking already finished before auto-mapping existed.
      return this.applyCarrierOrderStatusUpgrade(
        order,
        order.deliveryCode as DeliveryMethodCode,
        order.deliveryStatusCode,
      );
    }
    if (
      order.deliveryStatusAt &&
      Date.now() - order.deliveryStatusAt.getTime() < DELIVERY_SYNC_TTL_MS
    ) {
      return order;
    }

    try {
      if (order.deliveryCode === DeliveryMethodCode.CDEK) {
        const info = await this.cdek.getOrder(order.externalDeliveryId);
        if (isCarrierAbandonedStatus(info.statusCode)) {
          return this.markCarrierShipmentGone(order, 'СДЭК');
        }
        const trackNumber = info.cdekNumber || order.deliveryTrackNumber;
        return this.persistDeliveryTrackingUpdate(order, {
          deliveryCode: DeliveryMethodCode.CDEK,
          deliveryTrackNumber: trackNumber,
          deliveryStatusCode: info.statusCode,
          deliveryStatusLabel: info.statusLabel,
          deliveryTrackingUrl: trackNumber
            ? cdekTrackingUrl(trackNumber)
            : order.deliveryTrackingUrl,
        });
      }

      if (order.deliveryCode === DeliveryMethodCode.POST) {
        const info = await this.pochta.getOrder(order.externalDeliveryId);
        if (isCarrierAbandonedStatus(info.statusCode)) {
          return this.markCarrierShipmentGone(order, 'Почта России');
        }
        const trackNumber = info.barcode || order.deliveryTrackNumber;
        return this.persistDeliveryTrackingUpdate(order, {
          deliveryCode: DeliveryMethodCode.POST,
          deliveryTrackNumber: trackNumber,
          deliveryStatusCode: info.statusCode,
          deliveryStatusLabel: info.statusLabel,
          deliveryTrackingUrl: trackNumber
            ? pochtaTrackingUrl(trackNumber)
            : order.deliveryTrackingUrl,
        });
      }

      const info = await this.yandex.getRequestInfo(order.externalDeliveryId);
      if (isCarrierAbandonedStatus(info.statusCode)) {
        return this.markCarrierShipmentGone(order, 'Яндекс Доставка');
      }
      return this.persistDeliveryTrackingUpdate(order, {
        deliveryCode: DeliveryMethodCode.YANDEX,
        deliveryTrackNumber:
          order.deliveryTrackNumber || order.externalDeliveryId,
        deliveryStatusCode: info.statusCode,
        deliveryStatusLabel: info.statusLabel || info.statusCode,
        deliveryTrackingUrl: info.sharingUrl || order.deliveryTrackingUrl,
      });
    } catch (err) {
      if (err instanceof CdekEntityNotFoundError) {
        return this.markCarrierShipmentGone(order, 'СДЭК');
      }
      if (err instanceof YandexEntityNotFoundError) {
        return this.markCarrierShipmentGone(order, 'Яндекс Доставка');
      }
      if (err instanceof PochtaEntityNotFoundError) {
        return this.markCarrierShipmentGone(order, 'Почта России');
      }
      this.logger.warn(
        `Delivery tracking sync failed for order ${order.id}: ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      return order;
    }
  }

  private async persistDeliveryTrackingUpdate<
    T extends {
      id: string;
      status: OrderStatus;
      number?: number;
      email?: string;
      pickupLabel?: string | null;
      deliveryTitle?: string;
      cityLabel?: string;
      deliveryTrackNumber: string | null;
      deliveryStatusCode: string | null;
      deliveryStatusLabel: string | null;
      deliveryTrackingUrl: string | null;
      deliveryStatusAt: Date | null;
    },
  >(
    order: T,
    input: {
      deliveryCode: DeliveryMethodCode;
      deliveryTrackNumber: string | null;
      deliveryStatusCode: string | null;
      deliveryStatusLabel: string | null;
      deliveryTrackingUrl: string | null;
    },
  ): Promise<T> {
    const nextStatus = resolveOrderStatusAfterCarrier(
      order.status,
      input.deliveryCode,
      input.deliveryStatusCode,
    );
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        deliveryTrackNumber: input.deliveryTrackNumber,
        deliveryStatusCode: input.deliveryStatusCode,
        deliveryStatusLabel: input.deliveryStatusLabel,
        deliveryTrackingUrl: input.deliveryTrackingUrl,
        deliveryStatusAt: new Date(),
        ...(nextStatus ? { status: nextStatus } : {}),
      },
    });
    const merged = { ...order, ...updated };
    if (nextStatus && typeof order.email === 'string' && order.email) {
      this.maybeNotifyStatusMail(order.status, {
        id: merged.id,
        number: merged.number ?? 0,
        email: order.email,
        status: merged.status,
        pickupLabel: merged.pickupLabel ?? null,
        deliveryTitle: merged.deliveryTitle ?? '',
        cityLabel: merged.cityLabel ?? '',
      });
    } else if (nextStatus) {
      this.logger.log(
        `Order ${order.id}: status ${order.status} → ${nextStatus} ` +
          `(carrier ${input.deliveryStatusCode})`,
      );
    }
    return merged;
  }

  /** Upgrade Order.status from an already-stored carrier code (no API call). */
  private async applyCarrierOrderStatusUpgrade<
    T extends {
      id: string;
      status: OrderStatus;
      number?: number;
      email?: string;
      pickupLabel?: string | null;
      deliveryTitle?: string;
      cityLabel?: string;
      deliveryTrackNumber: string | null;
      deliveryStatusCode: string | null;
      deliveryStatusLabel: string | null;
      deliveryTrackingUrl: string | null;
      deliveryStatusAt: Date | null;
    },
  >(
    order: T,
    deliveryCode: DeliveryMethodCode,
    carrierStatusCode: string | null,
  ): Promise<T> {
    const nextStatus = resolveOrderStatusAfterCarrier(
      order.status,
      deliveryCode,
      carrierStatusCode,
    );
    if (!nextStatus) return order;
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: { status: nextStatus },
    });
    const merged = { ...order, ...updated };
    if (typeof order.email === 'string' && order.email) {
      this.maybeNotifyStatusMail(order.status, {
        id: merged.id,
        number: merged.number ?? 0,
        email: order.email,
        status: merged.status,
        pickupLabel: merged.pickupLabel ?? null,
        deliveryTitle: merged.deliveryTitle ?? '',
        cityLabel: merged.cityLabel ?? '',
      });
    }
    return merged;
  }

  /**
   * Carrier no longer has the shipment (manual delete in ЛК or purged).
   * Stop polling; move to ARCHIVED unless already DONE/CANCELLED/ARCHIVED.
   */
  private async markCarrierShipmentGone<
    T extends {
      id: string;
      status: OrderStatus;
      deliveryTrackNumber: string | null;
      deliveryStatusCode: string | null;
      deliveryStatusLabel: string | null;
      deliveryTrackingUrl: string | null;
      deliveryStatusAt: Date | null;
    },
  >(order: T, carrierLabel: string): Promise<T> {
    const nextStatus = orderStatusAfterCarrierGone(order.status);
    const updated = await this.prisma.order.update({
      where: { id: order.id },
      data: {
        status: nextStatus,
        deliveryStatusCode: 'REMOVED',
        deliveryStatusLabel: `Отправление недоступно в ${carrierLabel}`,
        deliveryStatusAt: new Date(),
      },
    });
    this.logger.log(
      `Order ${order.id}: carrier shipment gone (${carrierLabel}) → ` +
        `delivery=REMOVED status=${nextStatus}`,
    );
    return { ...order, ...updated };
  }

  private mapAdmin(
    order: Parameters<OrdersService['map']>[0] & {
      user?: { email: string } | null;
      email?: string;
    },
  ) {
    return {
      ...this.map(order),
      customerEmail: order.email || order.user?.email || null,
    };
  }

  private map(order: {
    id: string;
    number: number;
    status: string;
    email?: string;
    phone: string;
    lastName?: string;
    firstName?: string;
    contactChannel: string;
    cityLabel: string;
    deliveryCode: string;
    deliveryTitle: string;
    pickupLabel: string | null;
    pickupCode?: string | null;
    storePickupAt?: Date | null;
    storePickupAddress?: string | null;
    externalDeliveryId?: string | null;
    deliveryTrackNumber?: string | null;
    deliveryStatusCode?: string | null;
    deliveryStatusLabel?: string | null;
    deliveryTrackingUrl?: string | null;
    deliveryStatusAt?: Date | null;
    paymentExternalId?: string | null;
    paymentPayLink?: string | null;
    paidAt?: Date | null;
    total: number;
    createdAt: Date;
    items: Array<{
      id: string;
      productId: string | null;
      variantId?: string | null;
      productName: string;
      image: string;
      weight: string;
      price: number;
      qty: number;
      product?: { slug: string; isActive: boolean } | null;
    }>;
  }) {
    const hasTracking =
      Boolean(order.externalDeliveryId) ||
      Boolean(order.deliveryTrackNumber) ||
      Boolean(order.deliveryStatusLabel) ||
      Boolean(order.deliveryTrackingUrl);

    return {
      id: order.id,
      number: order.number,
      status: order.status,
      email: order.email ?? '',
      phone: order.phone,
      lastName: order.lastName ?? '',
      firstName: order.firstName ?? '',
      contactChannel: order.contactChannel,
      cityLabel: order.cityLabel,
      deliveryCode: order.deliveryCode,
      deliveryTitle: order.deliveryTitle,
      pickupLabel: order.pickupLabel,
      pickupCode: order.pickupCode ?? null,
      storePickupAt: order.storePickupAt?.toISOString() ?? null,
      storePickupAddress: order.storePickupAddress ?? null,
      externalDeliveryId: order.externalDeliveryId ?? null,
      deliveryTracking: hasTracking
        ? {
            trackNumber: order.deliveryTrackNumber ?? null,
            statusCode: order.deliveryStatusCode ?? null,
            statusLabel: order.deliveryStatusLabel ?? null,
            trackingUrl: order.deliveryTrackingUrl ?? null,
            syncedAt: order.deliveryStatusAt?.toISOString() ?? null,
          }
        : null,
      paymentExternalId: order.paymentExternalId ?? null,
      paidAt: order.paidAt ?? null,
      payUrl:
        !order.paidAt &&
        order.status === OrderStatus.NEW &&
        order.paymentPayLink
          ? order.paymentPayLink
          : null,
      total: order.total,
      createdAt: order.createdAt,
      items: order.items.map((i) => ({
        id: i.id,
        productId: i.productId,
        variantId: i.variantId ?? null,
        productSlug:
          i.product?.isActive && i.product.slug ? i.product.slug : null,
        name: i.productName,
        image: i.image,
        weight: i.weight,
        price: i.price,
        qty: i.qty,
      })),
    };
  }
}
