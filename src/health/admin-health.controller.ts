import { Controller, Get, UseGuards } from '@nestjs/common';
import { AdminOnlyGuard } from '../auth/auth.guard';
import { HealthService } from './health.service';

@Controller('admin/health')
@UseGuards(AdminOnlyGuard)
export class AdminHealthController {
  constructor(private readonly health: HealthService) {}

  /** Full dependency report — ADMIN only. */
  @Get()
  overview() {
    return this.health.fullReport();
  }
}
