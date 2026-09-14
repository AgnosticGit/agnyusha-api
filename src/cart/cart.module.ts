import { Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsCoreModule } from '../settings/settings-core.module';
import { CartController } from './cart.controller';
import { CartService } from './cart.service';

@Module({
  imports: [forwardRef(() => AuthModule), SettingsCoreModule],
  controllers: [CartController],
  providers: [CartService],
  exports: [CartService],
})
export class CartModule {}
