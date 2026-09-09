import { Global, Module } from '@nestjs/common';
import { PochtaService } from './pochta.service';
import { POCHTA_FETCH } from './pochta.tokens';

@Global()
@Module({
  providers: [
    {
      provide: POCHTA_FETCH,
      useValue: globalThis.fetch.bind(globalThis),
    },
    PochtaService,
  ],
  exports: [PochtaService, POCHTA_FETCH],
})
export class PochtaModule {}
