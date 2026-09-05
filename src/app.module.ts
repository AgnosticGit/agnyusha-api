import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './prisma/prisma.module';
import { CdekModule } from './cdek/cdek.module';
import { YandexModule } from './yandex/yandex.module';
import { CitiesModule } from './cities/cities.module';
import { DeliveryModule } from './delivery/delivery.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [`.env.${process.env.NODE_ENV ?? 'development'}`, '.env'],
    }),
    PrismaModule,
    CdekModule,
    YandexModule,
    CitiesModule,
    DeliveryModule,
  ],
})
export class AppModule {}
