import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { PickupModule } from '../pickup/pickup.module';
import { DeliveryController } from './delivery.controller';
import { DeliveryService } from './delivery.service';

@Module({
  imports: [AuthModule, PickupModule],
  controllers: [DeliveryController],
  providers: [DeliveryService],
  exports: [DeliveryService],
})
export class DeliveryModule {}
