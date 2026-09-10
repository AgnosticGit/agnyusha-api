import {
  IsArray,
  IsBoolean,
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
import { ProductBadge, ProductCategory } from '@prisma/client';

export class ProductVariantInput {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  @MinLength(1)
  sku!: string;

  @IsString()
  @MinLength(1)
  weight!: string;

  /** Real shipping weight in grams. */
  @Type(() => Number)
  @IsInt()
  @Min(1)
  weightGrams!: number;

  @IsNumber()
  @Min(0)
  price!: number;

  @IsInt()
  @Min(0)
  stock!: number;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;
}

export class ProductSectionInput {
  @IsString()
  @MinLength(1)
  title!: string;

  @IsOptional()
  @IsString()
  body?: string;
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

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  images?: string[];

  @IsEnum(ProductCategory)
  category!: ProductCategory;

  @IsOptional()
  @IsEnum(ProductBadge)
  badge?: ProductBadge;

  @IsOptional()
  @IsString()
  badgeLabel?: string;

  @IsOptional()
  @IsString()
  badgeColor?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  discountPercent?: number | null;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProductSectionInput)
  sections?: ProductSectionInput[];

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  nutritionProtein?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  nutritionFat?: number | null;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  nutritionCarbs?: number | null;

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

  @IsOptional()
  @IsBoolean()
  isPopular?: boolean;
}

export class UpdateStockDto {
  @IsInt()
  @Min(0)
  stock!: number;
}
