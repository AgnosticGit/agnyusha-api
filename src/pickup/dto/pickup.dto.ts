import {
  IsArray,
  IsBoolean,
  IsInt,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  MinLength,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PickupDayScheduleDto {
  @IsInt()
  @Min(0)
  @Max(6)
  weekday!: number;

  @IsBoolean()
  open!: boolean;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'Время должно быть в формате ЧЧ:ММ',
  })
  startTime!: string;

  @IsString()
  @Matches(/^([01]\d|2[0-3]):([0-5]\d)$/, {
    message: 'Время должно быть в формате ЧЧ:ММ',
  })
  endTime!: string;
}

export class PickupLocationDto {
  @IsString()
  @MinLength(2, { message: 'Укажите город' })
  @MaxLength(120)
  city!: string;

  @IsString()
  @MinLength(2, { message: 'Укажите адрес' })
  @MaxLength(200)
  address!: string;
}

export class UpdatePickupSettingsDto {
  @IsInt()
  @Min(0)
  @Max(30)
  minLeadDays!: number;

  @IsArray()
  @IsString({ each: true })
  @MaxLength(32, { each: true })
  phones!: string[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PickupLocationDto)
  locations!: PickupLocationDto[];

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PickupDayScheduleDto)
  schedule!: PickupDayScheduleDto[];
}
