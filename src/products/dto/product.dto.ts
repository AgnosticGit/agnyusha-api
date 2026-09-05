import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { ProductBadge, ProductCategory } from '@prisma/client';

export class ProductVariantInput {
  @IsString()
  @MinLength(1)
  weight!: string;

  @IsInt()
  @Min(0)
  price!: number;
}

export class UpsertProductDto {
  @IsOptional()
  @IsString()
  slug?: string;

  @IsString()
  @MinLength(2)
  name!: string;

  @IsOptional()
  @IsString()
  subtitle?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsEnum(ProductCategory)
  category!: ProductCategory;

  @IsOptional()
  @IsEnum(ProductBadge)
  badge?: ProductBadge;

  @IsOptional()
  @IsInt()
  @Min(1)
  discountPercent?: number | null;

  @IsOptional()
  @IsString()
  ingredients?: string;

  @IsOptional()
  @IsString()
  additives?: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductVariantInput)
  variants!: ProductVariantInput[];

  @IsOptional()
  @IsInt()
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
