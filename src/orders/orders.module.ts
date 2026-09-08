import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CdekModule } from '../cdek/cdek.module';
import { PaymentsModule } from '../payments/payments.module';
import { YandexModule } from '../yandex/yandex.module';
import { OrdersController, AdminOrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuthModule, YandexModule, CdekModule, PaymentsModule],
  controllers: [OrdersController, AdminOrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
