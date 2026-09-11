import {
  ArrayMinSize,
  IsArray,
  IsEmail,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateOrderItemDto {
  @IsOptional()
  @IsString()
  productId?: string;

  /** Required — price/name/image are taken from the catalog, not the client. */
  @IsString()
  @MinLength(1)
  variantId!: string;

  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  image?: string;

  @IsOptional()
  @IsString()
  weight?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  price?: number;

  @IsInt()
  @Min(1)
  qty!: number;
}

export class CreateOrderDto {
  @IsEmail({}, { message: 'Укажите корректный email' })
  email!: string;

  @IsString()
  @MinLength(5)
  phone!: string;

  @IsString()
  @MinLength(1, { message: 'Укажите фамилию' })
  @MaxLength(80)
  lastName!: string;

  @IsString()
  @MinLength(1, { message: 'Укажите имя' })
  @MaxLength(80)
  firstName!: string;

  @IsString()
  @MinLength(1)
  contactChannel!: string;

  @IsString()
  @MinLength(1)
  cityLabel!: string;

  @IsString()
  @MinLength(1)
  deliveryCode!: string;

  @IsString()
  @MinLength(1)
  deliveryTitle!: string;

  @IsOptional()
  @IsString()
  pickupLabel?: string;

  @IsOptional()
  @IsString()
  pickupCode?: string;

  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => CreateOrderItemDto)
  items!: CreateOrderItemDto[];
}
