import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsCoreModule } from '../settings/settings-core.module';
import { ProductsController } from './products.controller';
import { ProductsService } from './products.service';

@Module({
  imports: [AuthModule, SettingsCoreModule],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductsModule {}
