import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Max,
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

export class PochtaPointsQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lon?: number;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  settlement?: string;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  region?: string;
}
