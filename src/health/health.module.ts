import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MailModule } from '../mail/mail.module';
import { OrdersModule } from '../orders/orders.module';
import { PaymentsModule } from '../payments/payments.module';
import { AdminHealthController } from './admin-health.controller';
import { HealthController } from './health.controller';
import { HealthService } from './health.service';

@Module({
  imports: [AuthModule, MailModule, PaymentsModule, OrdersModule],
  controllers: [HealthController, AdminHealthController],
  providers: [HealthService],
})
export class HealthModule {}
