import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AdminSettingsController,
  PublicSettingsController,
} from './settings.controller';
import {
  AdminSitePagesController,
  PublicSitePagesController,
} from './site-pages.controller';
import { SitePagesService } from './site-pages.service';
import { SettingsCoreModule } from './settings-core.module';

@Module({
  imports: [AuthModule, SettingsCoreModule],
  controllers: [
    PublicSettingsController,
    AdminSettingsController,
    PublicSitePagesController,
    AdminSitePagesController,
  ],
  providers: [SitePagesService],
  exports: [SettingsCoreModule],
})
export class SettingsModule {}
