import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AdminSettingsController,
  PublicSettingsController,
} from './settings.controller';
import { SettingsCoreModule } from './settings-core.module';

@Module({
  imports: [AuthModule, SettingsCoreModule],
  controllers: [PublicSettingsController, AdminSettingsController],
  exports: [SettingsCoreModule],
})
export class SettingsModule {}
