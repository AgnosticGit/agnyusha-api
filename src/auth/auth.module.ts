import { Module } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { AdminGuard, AuthGuard } from './auth.guard';
import { GOOGLE_FETCH } from './google.tokens';

@Module({
  imports: [MailModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    AdminGuard,
    {
      provide: GOOGLE_FETCH,
      useValue: fetch,
    },
  ],
  exports: [AuthService, AuthGuard, AdminGuard],
})
export class AuthModule {}
