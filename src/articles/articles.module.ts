import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import {
  AdminArticlesController,
  PublicArticlesController,
} from './articles.controller';
import { ArticlesService } from './articles.service';
import { ArticlesAccessGuard } from '../auth/auth.guard';

@Module({
  imports: [AuthModule],
  controllers: [PublicArticlesController, AdminArticlesController],
  providers: [ArticlesService, ArticlesAccessGuard],
  exports: [ArticlesService],
})
export class ArticlesModule {}
