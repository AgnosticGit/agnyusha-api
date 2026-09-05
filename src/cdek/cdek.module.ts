import { Global, Module } from '@nestjs/common';
import { CdekService } from './cdek.service';
import { CDEK_FETCH } from './cdek.tokens';

@Global()
@Module({
  providers: [
    {
      provide: CDEK_FETCH,
      useValue: globalThis.fetch.bind(globalThis),
    },
    CdekService,
  ],
  exports: [CdekService, CDEK_FETCH],
})
export class CdekModule {}
