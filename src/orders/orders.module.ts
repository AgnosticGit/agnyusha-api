import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { YandexModule } from '../yandex/yandex.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [AuthModule, YandexModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
