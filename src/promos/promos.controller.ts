import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { PromosAccessGuard } from '../auth/auth.guard';
import { UpsertPromoDto, ValidatePromoDto } from './dto/promo.dto';
import { PromosService } from './promos.service';

@Controller('promos')
export class PublicPromosController {
  constructor(private readonly promos: PromosService) {}

  @Post('validate')
  validate(@Body() body: ValidatePromoDto) {
    return this.promos.validatePublic(body);
  }
}

@Controller('admin/promos')
@UseGuards(PromosAccessGuard)
export class AdminPromosController {
  constructor(private readonly promos: PromosService) {}

  @Get()
  list() {
    return this.promos.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.promos.get(id);
  }

  @Post()
  create(@Body() body: UpsertPromoDto) {
    return this.promos.create(body);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() body: UpsertPromoDto) {
    return this.promos.update(id, body);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.promos.remove(id);
  }
}
