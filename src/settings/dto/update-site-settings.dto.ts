import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateSiteSettingsDto {
  @IsOptional()
  @IsBoolean()
  freeDeliveryDisplayEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  reviewsEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  articlesEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  promosEnabled?: boolean;

  @IsOptional()
  @IsBoolean()
  inventoryEnabled?: boolean;
}
