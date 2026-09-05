import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
  HttpCode,
} from '@nestjs/common';
import { AuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(AuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Req() req: AuthedRequest) {
    return this.orders.listForUser(req.user!.id);
  }

  @Get(':id')
  getOne(@Req() req: AuthedRequest, @Param('id') id: string) {
    return this.orders.getForUser(req.user!.id, id);
  }

  @Post()
  @HttpCode(201)
  create(@Req() req: AuthedRequest, @Body() body: CreateOrderDto) {
    return this.orders.create(req.user!.id, body);
  }
}
