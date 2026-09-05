import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

export class DeliveryMethodsQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(200)
  region?: string;

  @IsOptional()
  @IsString()
  @MaxLength(300)
  label?: string;
}

export class DeliveryPointsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cityCode!: number;

  @IsOptional()
  @IsIn(['PVZ', 'POSTAMAT'])
  type?: 'PVZ' | 'POSTAMAT';
}

export class YandexPointsQueryDto {
  @Type(() => Number)
  @IsInt()
  @Min(1)
  geoId!: number;

  @IsOptional()
  @IsIn(['pickup_point', 'terminal', 'warehouse'])
  type?: 'pickup_point' | 'terminal' | 'warehouse';
}
