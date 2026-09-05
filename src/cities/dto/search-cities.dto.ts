import {
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

export class SearchCitiesDto {
  @Transform(({ value }) =>
    typeof value === 'string'
      ? value.replace(/[\u0000-\u001F\u007F]/g, '').trim()
      : value,
  )
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  q!: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(50)
  limit?: number = 12;
}
