import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminOnlyGuard } from '../auth/auth.guard';
import { HealthService } from './health.service';
import { HostMetricsService } from './host-metrics.service';

@Controller('admin/health')
@UseGuards(AdminOnlyGuard)
export class AdminHealthController {
  constructor(
    private readonly health: HealthService,
    private readonly hostMetrics: HostMetricsService,
  ) {}

  /** Full dependency report — ADMIN only. */
  @Get()
  overview() {
    return this.health.fullReport();
  }

  /** Live + hourly host resource series — ADMIN only. */
  @Get('metrics')
  metrics() {
    return this.hostMetrics.getDashboard();
  }
}
