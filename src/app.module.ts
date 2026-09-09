import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CdekModule } from './cdek/cdek.module';
import { YandexModule } from './yandex/yandex.module';
import { PochtaModule } from './pochta/pochta.module';
import { CitiesModule } from './cities/cities.module';
import { DeliveryModule } from './delivery/delivery.module';
import { AuthModule } from './auth/auth.module';
import { ProductsModule } from './products/products.module';
import { OrdersModule } from './orders/orders.module';
import { UsersModule } from './users/users.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { CartModule } from './cart/cart.module';
import { PaymentsModule } from './payments/payments.module';
import { HealthModule } from './health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
    }),
    PrismaModule,
    CdekModule,
    YandexModule,
    PochtaModule,
    CitiesModule,
    DeliveryModule,
    AuthModule,
    ProductsModule,
    OrdersModule,
    UsersModule,
    AnalyticsModule,
    CartModule,
    PaymentsModule,
    HealthModule,
  ],
})
export class AppModule {}
