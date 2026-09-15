import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import type { Response } from 'express';
import { ConfigService } from '@nestjs/config';
import {
  AuthGuard,
  OptionalAuthGuard,
  OrdersAccessGuard,
  type AuthedRequest,
} from '../auth/auth.guard';
import { AuthService } from '../auth/auth.service';
import {
  CART_COOKIE,
  SESSION_COOKIE,
  cookieSameSite,
  cookieSecure,
  sessionCookieOptions,
} from '../auth/auth.crypto';
import { CartService } from '../cart/cart.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListAdminOrdersDto } from './dto/list-admin-orders.dto';
import { ListMyOrdersDto } from './dto/list-my-orders.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly auth: AuthService,
    private readonly cart: CartService,
    private readonly config: ConfigService,
  ) {}

  @Get()
  @UseGuards(AuthGuard)
  list(@Req() req: AuthedRequest, @Query() query: ListMyOrdersDto) {
    return this.orders.listForUser(req.user!.id, query);
  }

  /** Pull Ozon status for unpaid NEW orders (TTL + max 3). Non-blocking for list. */
  @Post('reconcile-payments')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  reconcilePayments(@Req() req: AuthedRequest) {
    return this.orders.reconcilePaymentsForUser(req.user!.id);
  }

  @Post(':id/pay')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  pay(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.orders.getPayUrlForUser(req.user!.id, id);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @UseGuards(AuthGuard)
  cancel(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.orders.cancelForUser(req.user!.id, id);
  }

  @Get(':id')
  @UseGuards(AuthGuard)
  getOne(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.orders.getForUser(req.user!.id, id);
  }

  @Post()
  @HttpCode(201)
  @UseGuards(OptionalAuthGuard)
  async create(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
    @Body() body: CreateOrderDto,
  ) {
    const { order, establishSessionUserId } = await this.orders.create(
      req.user?.id ?? null,
      body,
      {
        guestRawToken: req.cookies?.[CART_COOKIE],
      },
    );

    if (!establishSessionUserId) {
      return order;
    }

    const session = await this.auth.createCheckoutSession(
      establishSessionUserId,
    );
    res.cookie(
      SESSION_COOKIE,
      session.sessionToken,
      sessionCookieOptions(
        cookieSecure(this.config),
        session.maxAgeMs,
        cookieSameSite(this.config),
      ),
    );
    await this.cart.mergeGuestIntoUser(
      establishSessionUserId,
      req.cookies?.[CART_COOKIE],
      res,
    );

    return { ...order, sessionCreated: true };
  }
}

@Controller('admin/orders')
@UseGuards(OrdersAccessGuard)
export class AdminOrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query() query: ListAdminOrdersDto) {
    return this.orders.listAdmin(query);
  }

  @Patch(':id/status')
  updateStatus(@Param('id') id: string, @Body() body: UpdateOrderStatusDto) {
    return this.orders.updateStatus(id, body.status);
  }
}
