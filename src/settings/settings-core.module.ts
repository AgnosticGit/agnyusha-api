import { Module } from '@nestjs/common';
import { SettingsService } from './settings.service';

/** Settings data access without Auth — safe for Cart/Orders to import. */
@Module({
  providers: [SettingsService],
  exports: [SettingsService],
})
export class SettingsCoreModule {}
