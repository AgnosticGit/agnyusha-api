import { Global, Module } from '@nestjs/common';
import { OzonDeliveryService } from './ozon-delivery.service';
import { OZON_DELIVERY_FETCH } from './ozon-delivery.tokens';

@Global()
@Module({
  providers: [
    {
      provide: OZON_DELIVERY_FETCH,
      useValue: globalThis.fetch.bind(globalThis),
    },
    OzonDeliveryService,
  ],
  exports: [OzonDeliveryService, OZON_DELIVERY_FETCH],
})
export class OzonDeliveryModule {}
