import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PromoType } from '@prisma/client';

export class UpsertPromoDto {
  @IsString()
  @MinLength(2)
  code!: string;

  @IsEnum(PromoType)
  type!: PromoType;

  @Type(() => Number)
  @IsNumber()
  @Min(0.01)
  value!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsDateString()
  startsAt?: string | null;

  @IsOptional()
  @IsDateString()
  endsAt?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  maxRedemptions?: number | null;

  @IsOptional()
  @IsBoolean()
  appliesToAllProducts?: boolean;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsString({ each: true })
  productIds?: string[];
}

export class ValidatePromoItemDto {
  @IsString()
  productId!: string;

  @Type(() => Number)
  @IsNumber()
  @Min(0)
  price!: number;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  qty!: number;
}

export class ValidatePromoDto {
  @IsString()
  @MinLength(1)
  code!: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ValidatePromoItemDto)
  items!: ValidatePromoItemDto[];
}
