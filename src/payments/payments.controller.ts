import {
  Body,
  Controller,
  Headers,
  HttpCode,
  Post,
  Req,
} from '@nestjs/common';
import type { Request } from 'express';
import { resolveClientIp } from '../common/client-ip';
import { ConfirmOzonPaymentDto } from './dto/confirm-ozon-payment.dto';
import { PaymentsService } from './payments.service';

@Controller('payments')
export class PaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** Ozon Pay notificationUrl — public, no session cookie. */
  @Post('ozon/webhook')
  @HttpCode(200)
  ozonWebhook(
    @Req() req: Request,
    @Headers() headers: Record<string, string | string[] | undefined>,
  ) {
    return this.payments.handleOzonNotification(req.body, headers);
  }

  /**
   * Called from /payment/success after redirect.
   * Confirms PAID via Ozon getOrderDetails (covers missed webhooks).
   */
  @Post('ozon/confirm')
  @HttpCode(200)
  confirm(@Body() body: ConfirmOzonPaymentDto, @Req() req: Request) {
    return this.payments.confirmPaidByOrderId(
      body.orderId,
      resolveClientIp(req),
    );
  }
}
