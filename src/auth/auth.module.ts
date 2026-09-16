import { Module, forwardRef } from '@nestjs/common';
import { MailModule } from '../mail/mail.module';
import { CartModule } from '../cart/cart.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import {
  AdminOnlyGuard,
  AnalyticsAccessGuard,
  AuthGuard,
  ManageUsersGuard,
  OptionalAuthGuard,
  OrdersAccessGuard,
  PermissionsGuard,
  ProductsAccessGuard,
  ReviewsAccessGuard,
  SettingsAccessGuard,
} from './auth.guard';
import { GOOGLE_FETCH } from './google.tokens';

@Module({
  imports: [MailModule, forwardRef(() => CartModule)],
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthGuard,
    OptionalAuthGuard,
    ManageUsersGuard,
    PermissionsGuard,
    ProductsAccessGuard,
    AnalyticsAccessGuard,
    OrdersAccessGuard,
    AdminOnlyGuard,
    SettingsAccessGuard,
    ReviewsAccessGuard,
    {
      provide: GOOGLE_FETCH,
      useValue: fetch,
    },
  ],
  exports: [
    AuthService,
    AuthGuard,
    OptionalAuthGuard,
    ManageUsersGuard,
    PermissionsGuard,
    ProductsAccessGuard,
    AnalyticsAccessGuard,
    OrdersAccessGuard,
    AdminOnlyGuard,
    SettingsAccessGuard,
    ReviewsAccessGuard,
  ],
})
export class AuthModule {}
