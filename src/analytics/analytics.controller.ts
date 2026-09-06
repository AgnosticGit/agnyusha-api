import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString } from 'class-validator';
import { AnalyticsAccessGuard } from '../auth/auth.guard';
import { AnalyticsService } from './analytics.service';

class AnalyticsQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;
}

@Controller('admin/analytics')
@UseGuards(AnalyticsAccessGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@Query() query: AnalyticsQueryDto) {
    return this.analytics.overview(query.from, query.to);
  }
}
