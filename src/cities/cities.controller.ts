import { Controller, Get, Query } from '@nestjs/common';
import { CitiesService } from './cities.service';
import { SearchCitiesDto } from './dto/search-cities.dto';

@Controller('cities')
export class CitiesController {
  constructor(private readonly citiesService: CitiesService) {}

  @Get('search')
  search(@Query() dto: SearchCitiesDto) {
    return this.citiesService.search(dto.q, dto.limit ?? 12);
  }
}
