import { Module } from '@nestjs/common';
import { MAIL_SEND } from './mail.tokens';
import { ResendMailService } from './resend-mail.service';

@Module({
  providers: [
    ResendMailService,
    {
      provide: MAIL_SEND,
      useFactory: (mail: ResendMailService) => mail.send.bind(mail),
      inject: [ResendMailService],
    },
  ],
  exports: [MAIL_SEND, ResendMailService],
})
export class MailModule {}
