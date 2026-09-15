import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER } from '@nestjs/core';
import { SentryGlobalFilter, SentryModule } from '@sentry/nestjs/setup';
import { PrismaModule } from './prisma/prisma.module';
import { CdekModule } from './cdek/cdek.module';
import { YandexModule } from './yandex/yandex.module';
import { PochtaModule } from './pochta/pochta.module';
import { OzonDeliveryModule } from './ozon-delivery/ozon-delivery.module';
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
import { SettingsModule } from './settings/settings.module';
import { ReviewsModule } from './reviews/reviews.module';
import { PromosModule } from './promos/promos.module';
import { ArticlesModule } from './articles/articles.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`],
    }),
    PrismaModule,
    CdekModule,
    YandexModule,
    PochtaModule,
    OzonDeliveryModule,
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
    SettingsModule,
    ReviewsModule,
    PromosModule,
    ArticlesModule,
  ],
  providers: [
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
  ],
})
export class AppModule {}
