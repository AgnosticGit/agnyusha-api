import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import {
  AuthGuard,
  OptionalAuthGuard,
  OrdersAccessGuard,
  type AuthedRequest,
} from '../auth/auth.guard';
import { CreateOrderDto } from './dto/create-order.dto';
import { ListAdminOrdersDto } from './dto/list-admin-orders.dto';
import { ListMyOrdersDto } from './dto/list-my-orders.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

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
  create(@Req() req: AuthedRequest, @Body() body: CreateOrderDto) {
    return this.orders.create(req.user?.id ?? null, body);
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
