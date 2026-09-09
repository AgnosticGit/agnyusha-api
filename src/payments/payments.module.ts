import { Module } from '@nestjs/common';
import { CdekModule } from '../cdek/cdek.module';
import { MailModule } from '../mail/mail.module';
import { YandexModule } from '../yandex/yandex.module';
import { PaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Module({
  imports: [YandexModule, CdekModule, MailModule],
  controllers: [PaymentsController],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
