import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { SettingsAccessGuard } from '../auth/auth.guard';
import { UpdateSiteSettingsDto } from './dto/update-site-settings.dto';
import { SettingsService } from './settings.service';

@Controller('settings')
export class PublicSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  getPublic() {
    return this.settings.getPublic();
  }
}

@Controller('admin/settings')
@UseGuards(SettingsAccessGuard)
export class AdminSettingsController {
  constructor(private readonly settings: SettingsService) {}

  @Get()
  getAdmin() {
    return this.settings.getAll();
  }

  @Patch()
  update(@Body() body: UpdateSiteSettingsDto) {
    return this.settings.update(body);
  }
}
