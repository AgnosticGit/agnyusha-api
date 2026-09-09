import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { Transform } from 'class-transformer';
import { AnalyticsAccessGuard } from '../auth/auth.guard';
import { AnalyticsService } from './analytics.service';

class AnalyticsQueryDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.replace(/[\u0000-\u001F\u007F]/g, '').trim()
      : value,
  )
  @IsString()
  @MaxLength(64)
  productId?: string;
}

@Controller('admin/analytics')
@UseGuards(AnalyticsAccessGuard)
export class AnalyticsController {
  constructor(private readonly analytics: AnalyticsService) {}

  @Get('overview')
  overview(@Query() query: AnalyticsQueryDto) {
    return this.analytics.overview(query.from, query.to, query.productId);
  }
}
