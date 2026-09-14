import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsCoreModule } from '../settings/settings-core.module';
import { AnalyticsController } from './analytics.controller';
import { AnalyticsService } from './analytics.service';

@Module({
  imports: [AuthModule, SettingsCoreModule],
  controllers: [AnalyticsController],
  providers: [AnalyticsService],
})
export class AnalyticsModule {}
