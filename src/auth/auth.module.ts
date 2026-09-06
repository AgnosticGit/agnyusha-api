import { Module, forwardRef } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { CartModule } from '../cart/cart.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  AdminGuard,
  AnalyticsAccessGuard,
  AuthGuard,
  ManageUsersGuard,
  OptionalAuthGuard,
  PermissionsGuard,
  ProductsAccessGuard,
  StaffGuard,
} from './auth.guard';
import { GOOGLE_FETCH } from './google.tokens';

@Module({
  imports: [MailModule, forwardRef(() => CartModule)],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    OptionalAuthGuard,
    AdminGuard,
    StaffGuard,
    ManageUsersGuard,
    PermissionsGuard,
    ProductsAccessGuard,
    AnalyticsAccessGuard,
    {
      provide: GOOGLE_FETCH,
      useValue: fetch,
    },
  ],
  exports: [
    AuthService,
    AuthGuard,
    OptionalAuthGuard,
    AdminGuard,
    StaffGuard,
    ManageUsersGuard,
    PermissionsGuard,
    ProductsAccessGuard,
    AnalyticsAccessGuard,
  ],
})
export class AuthModule {}
