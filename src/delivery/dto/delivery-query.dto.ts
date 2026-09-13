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

  /** CDEK city code — enables ETA for СДЭК. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  cdekCode?: number;

  /** Yandex geo_id — enables ETA for Яндекс. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  yandexGeoId?: number;

  /** Settlement name for Почта (defaults to city from label). */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  settlement?: string;

  /** Package weight for calculators (grams). Default 1000. */
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(100)
  @Max(30000)
  weightGrams?: number;
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
