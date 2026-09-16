import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SettingsCoreModule } from '../settings/settings-core.module';
import { ReviewsController } from './reviews.controller';
import { ReviewsService } from './reviews.service';

@Module({
  imports: [AuthModule, SettingsCoreModule],
  controllers: [ReviewsController],
  providers: [ReviewsService],
  exports: [ReviewsService],
})
export class ReviewsModule {}
