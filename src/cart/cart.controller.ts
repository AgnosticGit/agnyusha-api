import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Put,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import type { Response } from 'express';
import { CART_COOKIE } from '../auth/auth.crypto';
import { OptionalAuthGuard, type AuthedRequest } from '../auth/auth.guard';
import { CartService } from './cart.service';
import { UpsertCartItemDto } from './dto/cart.dto';

@Controller('cart')
@UseGuards(OptionalAuthGuard)
export class CartController {
  constructor(private readonly cart: CartService) {}

  @Get()
  async getCart(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cart.getOrResolveCart({
      userId: req.user?.id,
      guestRawToken: req.cookies?.[CART_COOKIE],
      res,
    });
  }

  @Put('items')
  @HttpCode(200)
  async upsertItem(
    @Body() body: UpsertCartItemDto,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cart.upsertItem({
      userId: req.user?.id,
      guestRawToken: req.cookies?.[CART_COOKIE],
      variantId: body.variantId,
      qty: body.qty,
      res,
    });
  }

  @Delete('items/:variantId')
  @HttpCode(200)
  async removeItem(
    @Param('variantId') variantId: string,
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cart.removeItem({
      userId: req.user?.id,
      guestRawToken: req.cookies?.[CART_COOKIE],
      variantId,
      res,
    });
  }

  @Delete()
  @HttpCode(200)
  async clear(
    @Req() req: AuthedRequest,
    @Res({ passthrough: true }) res: Response,
  ) {
    return this.cart.clearCart({
      userId: req.user?.id,
      guestRawToken: req.cookies?.[CART_COOKIE],
      res,
    });
  }
}
