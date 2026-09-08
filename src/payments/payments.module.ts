import { Module } from '@nestjs/common';
import { CdekModule } from '../cdek/cdek.module';
import { YandexModule } from '../yandex/yandex.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [YandexModule, CdekModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
