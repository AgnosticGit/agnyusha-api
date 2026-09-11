import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CdekModule } from '../cdek/cdek.module';
import { MailModule } from '../mail/mail.module';
import { PaymentsModule } from '../payments/payments.module';
import { YandexModule } from '../yandex/yandex.module';
import { DeliveryTrackingPoller } from './delivery-tracking.poller';
import { OrdersController, AdminOrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuthModule, YandexModule, CdekModule, PaymentsModule, MailModule],
  controllers: [OrdersController, AdminOrdersController],
  providers: [OrdersService, DeliveryTrackingPoller],
  exports: [DeliveryTrackingPoller],
})
export class OrdersModule {}
