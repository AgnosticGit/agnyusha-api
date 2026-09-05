import { Controller, Get, Query } from '@nestjs/common';
import { DeliveryService } from './delivery.service';
import { CdekService } from '../cdek/cdek.service';
import { YandexDeliveryService } from '../yandex/yandex-delivery.service';
import {
  DeliveryMethodsQueryDto,
  DeliveryPointsQueryDto,
  YandexPointsQueryDto,
} from './dto/delivery-query.dto';

@Controller()
export class DeliveryController {
  constructor(
    private readonly deliveryService: DeliveryService,
    private readonly cdek: CdekService,
    private readonly yandex: YandexDeliveryService,
  ) {}

  @Get('delivery-methods')
  list(@Query() query: DeliveryMethodsQueryDto) {
    return this.deliveryService.forLocation(query.region, query.label);
  }

  @Get('cdek/delivery-points')
  cdekPoints(@Query() query: DeliveryPointsQueryDto) {
    return this.cdek.deliveryPoints(query.cityCode, query.type);
  }

  @Get('yandex/delivery-points')
  yandexPoints(@Query() query: YandexPointsQueryDto) {
    return this.yandex.deliveryPoints(query.geoId, query.type);
  }
}
