import { Global, Module } from '@nestjs/common';
import { YandexDeliveryService } from './yandex-delivery.service';
import { YANDEX_FETCH } from './yandex.tokens';

@Global()
@Module({
  providers: [
    {
      provide: YANDEX_FETCH,
      useValue: globalThis.fetch.bind(globalThis),
    },
    YandexDeliveryService,
  ],
  exports: [YandexDeliveryService, YANDEX_FETCH],
})
export class YandexModule {}
