import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsString,
  ValidateNested,
} from 'class-validator';

export class AdminDeliveryMethodActiveDto {
  @IsString()
  id!: string;

  @IsBoolean()
  isActive!: boolean;
}

export class UpdateAdminDeliveryMethodsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => AdminDeliveryMethodActiveDto)
  methods!: AdminDeliveryMethodActiveDto[];
}
