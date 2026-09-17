import { Body, Controller, Get, Put, UseGuards } from '@nestjs/common';
import { PickupAccessGuard } from '../auth/auth.guard';
import { UpdatePickupSettingsDto } from './dto/pickup.dto';
import { PickupService } from './pickup.service';

@Controller()
export class PickupController {
  constructor(private readonly pickup: PickupService) {}

  /** Public checkout settings + bookable slots. */
  @Get('pickup')
  publicView() {
    return this.pickup.publicView();
  }

  @Get('admin/pickup')
  @UseGuards(PickupAccessGuard)
  adminGet() {
    return this.pickup.getSettings();
  }

  @Put('admin/pickup')
  @UseGuards(PickupAccessGuard)
  adminUpdate(@Body() body: UpdatePickupSettingsDto) {
    return this.pickup.updateSettings(body);
  }
}
